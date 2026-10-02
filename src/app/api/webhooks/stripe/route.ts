import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { recordSubscriptionEvent } from "@/lib/subscription";

/**
 * Webhook Stripe (WP7b).
 *
 * Vérifie la signature puis synchronise la base : création d'abonnement,
 * enregistrement des paiements, mise à jour des statuts et du drapeau premium.
 *
 * Le corps brut est obtenu via `await request.text()` : en App Router, Next.js
 * ne parse pas le corps des route handlers, donc la chaîne est exactement celle
 * signée par Stripe (le paquet `micro` ne sert qu'aux API routes Pages Router,
 * il n'est pas nécessaire ici).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SubscriptionStatus = "ACTIVE" | "TRIALING" | "PAST_DUE" | "CANCELED" | "EXPIRED";

const PREMIUM_STATUSES: SubscriptionStatus[] = ["ACTIVE", "TRIALING"];

function mapStripeStatus(status: unknown): SubscriptionStatus {
  switch (String(status)) {
    case "active":
      return "ACTIVE";
    case "trialing":
      return "TRIALING";
    case "past_due":
    case "unpaid":
      return "PAST_DUE";
    case "canceled":
      return "CANCELED";
    case "incomplete":
    case "incomplete_expired":
      return "EXPIRED";
    default:
      return "CANCELED";
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- les objets Stripe varient selon la version d'API */

/** Identifiant client, quelle que soit la forme (chaîne ou objet développé). */
function extractCustomerId(source: any): string | null {
  const customer = source?.customer ?? source?.customer_id;
  if (typeof customer === "string") return customer;
  if (customer && typeof customer.id === "string") return customer.id;
  return null;
}

/** Identifiant d'abonnement Stripe, quelle que soit la forme. */
function extractSubscriptionId(source: any): string | null {
  const subscription = source?.subscription;
  if (typeof subscription === "string") return subscription;
  if (subscription && typeof subscription.id === "string") return subscription.id;
  // API récentes : l'abonnement se trouve sous invoice.parent.subscription_details
  const nested = source?.parent?.subscription_details?.subscription;
  if (typeof nested === "string") return nested;
  if (nested && typeof nested.id === "string") return nested.id;
  return null;
}

/**
 * Période de facturation. Selon la version d'API, `current_period_*` est porté
 * par l'abonnement ou par son premier élément.
 */
function extractPeriods(subscription: any): { start: Date; end: Date } {
  const item = subscription?.items?.data?.[0];
  const startSeconds = subscription?.current_period_start ?? item?.current_period_start;
  const endSeconds = subscription?.current_period_end ?? item?.current_period_end;
  const now = Date.now();
  return {
    start: typeof startSeconds === "number" ? new Date(startSeconds * 1000) : new Date(now),
    end: typeof endSeconds === "number" ? new Date(endSeconds * 1000) : new Date(now + 30 * 864e5),
  };
}

function toDate(seconds: unknown): Date | null {
  return typeof seconds === "number" ? new Date(seconds * 1000) : null;
}

/**
 * Violation de contrainte d'unicité Prisma.
 *
 * Stripe livre en parallèle `checkout.session.completed`,
 * `customer.subscription.created` et `invoice.paid` : deux handlers peuvent
 * tenter de créer la même ligne en même temps. Sans cette tolérance, le second
 * échoue en 500 et Stripe relivre l'événement.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** Lien vers la facture hébergée par Stripe, si la charge utile l'expose (WP7d). */
function extractInvoiceUrl(source: any): string | null {
  const url = source?.hosted_invoice_url;
  return typeof url === "string" && url.length > 0 ? url : null;
}

/** Identifiant d'intent de paiement porté par un objet (chaîne ou développé). */
function extractPaymentIntentId(source: any): string | null {
  const candidates = [
    source?.payment_intent,
    // API 2025-03-31+ : `payment_intent` a migré sous `payments`.
    source?.payments?.data?.[0]?.payment?.payment_intent,
    // Conservé pour les anciennes versions d'API.
    source?.charge,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.startsWith("pi_")) return candidate;
    if (candidate && typeof candidate.id === "string" && candidate.id.startsWith("pi_")) {
      return candidate.id;
    }
  }
  return null;
}

/**
 * Intent de paiement d'une facture. Avec les versions d'API récentes la
 * relation n'est présente que si `payments` est développé : on retente alors
 * une lecture ciblée, sans jamais faire échouer le webhook.
 */
async function resolveInvoicePaymentIntentId(invoice: any): Promise<string | null> {
  const direct = extractPaymentIntentId(invoice);
  if (direct) return direct;

  const invoiceId = typeof invoice?.id === "string" ? invoice.id : null;
  if (!invoiceId) return null;

  try {
    const expanded = await getStripe().invoices.retrieve(invoiceId, { expand: ["payments"] });
    return extractPaymentIntentId(expanded);
  } catch {
    return null;
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/** Retrouve l'abonnement en base à partir de l'identifiant Stripe ou du client. */
async function findSubscription(subscriptionId: string | null, customerId: string | null) {
  if (subscriptionId) {
    const byStripeId = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subscriptionId },
    });
    if (byStripeId) return byStripeId;
  }
  if (customerId) {
    const user = await prisma.author.findUnique({ where: { stripeCustomerId: customerId } });
    if (user) {
      return prisma.subscription.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      });
    }
  }
  return null;
}

/**
 * Retrouve l'abonnement correspondant à un objet Stripe, ou le crée à partir
 * des métadonnées (`planId` / `userId`) posées par le tunnel de souscription.
 *
 * Indispensable quand un webhook arrive avant `checkout.session.completed` :
 * `customer.subscription.created` et `invoice.paid` sont émis au même instant
 * et peuvent être livrés dans n'importe quel ordre.
 */
/** Forme minimale d'un abonnement Stripe exploité par le webhook. */
type StripeSubscriptionLike = {
  id?: string | null;
  status?: string | null;
  metadata?: Record<string, string> | null;
  cancel_at_period_end?: boolean | null;
  canceled_at?: number | null;
  customer?: unknown;
  current_period_start?: number | null;
  current_period_end?: number | null;
  items?: {
    data?: Array<{ current_period_start?: number | null; current_period_end?: number | null }>;
  } | null;
};

async function resolveSubscription(
  stripeSubscription: StripeSubscriptionLike,
  status: SubscriptionStatus = mapStripeStatus(stripeSubscription?.status),
) {
  const stripeSubscriptionId =
    typeof stripeSubscription?.id === "string" ? stripeSubscription.id : null;
  if (!stripeSubscriptionId) return null;

  const existing = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId },
  });
  if (existing) return existing;

  const metadata = (stripeSubscription.metadata ?? {}) as Record<string, string>;
  if (!metadata.userId || !metadata.planId) return null;

  const periods = extractPeriods(stripeSubscription);
  try {
    const created = await prisma.subscription.create({
      data: {
        userId: metadata.userId,
        planId: metadata.planId,
        status,
        stripeSubscriptionId,
        stripeCustomerId: extractCustomerId(stripeSubscription),
        currentPeriodStart: periods.start,
        currentPeriodEnd: periods.end,
        cancelAtPeriodEnd: Boolean(stripeSubscription.cancel_at_period_end),
        canceledAt: toDate(stripeSubscription.canceled_at),
      },
    });
    await recordSubscriptionEvent(created.id, "CREATED", {
      source: "customer.subscription.created",
      status,
      stripeSubscriptionId,
    });
    return created;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Créée entre-temps par un autre webhook : on récupère la ligne existante.
    return prisma.subscription.findUnique({ where: { stripeSubscriptionId } });
  }
}

/**
 * Recalcule le droit premium d'un auteur : il reste acquis tant qu'il lui
 * reste AU MOINS un abonnement actif.
 *
 * Indispensable dès qu'un utilisateur cumule plusieurs abonnements (par
 * exemple un plan à vie + un ancien abonnement annuel) : la résiliation de
 * l'un ne doit pas couper l'accès procuré par l'autre.
 */
async function syncPremiumFlag(userId: string): Promise<boolean> {
  const active = await prisma.subscription.count({
    where: { userId, status: { in: PREMIUM_STATUSES } },
  });
  await prisma.author.update({ where: { id: userId }, data: { isPremium: active > 0 } });
  return active > 0;
}

/**
 * Résilie les abonnements récurrents d'un utilisateur, sauf la ligne indiquée.
 *
 * Appelé lors d'un achat à vie : sans cela, un client déjà abonné au mois ou à
 * l'année continuerait d'être prélevé alors qu'il possède un accès permanent.
 */
async function cancelOtherSubscriptions(userId: string, keepSubscriptionId: string): Promise<number> {
  const others = await prisma.subscription.findMany({
    where: {
      userId,
      id: { not: keepSubscriptionId },
      status: { in: PREMIUM_STATUSES },
      stripeSubscriptionId: { not: null },
    },
    select: { id: true, stripeSubscriptionId: true },
  });

  for (const other of others) {
    if (other.stripeSubscriptionId) {
      try {
        await getStripe().subscriptions.cancel(other.stripeSubscriptionId);
      } catch {
        // Déjà résilié côté Stripe : on aligne malgré tout la base.
      }
    }
    await prisma.subscription.update({
      where: { id: other.id },
      data: { status: "CANCELED", canceledAt: new Date() },
    });
  }
  return others.length;
}

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json(
      { error: "STRIPE_WEBHOOK_SECRET n'est pas configurée." },
      { status: 500 },
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "En-tête stripe-signature manquant." }, { status: 400 });
  }

  const rawBody = await request.text();

  let event: import("stripe").Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    return NextResponse.json(
      {
        error: `Signature Stripe invalide : ${
          error instanceof Error ? error.message : "erreur inconnue"
        }`,
      },
      { status: 400 },
    );
  }

  try {
    switch (event.type) {
      /* ---------------------------------------------------------------- */
      /* Paiement de souscription terminé                                  */
      /* ---------------------------------------------------------------- */
      case "checkout.session.completed": {
        const session = event.data.object as unknown as Record<string, unknown>;
        const metadata = (session.metadata ?? {}) as Record<string, string>;
        const userId = metadata.userId;
        const planId = metadata.planId;
        const customerId = extractCustomerId(session);
        const subscriptionId = extractSubscriptionId(session);
        const sessionId = typeof session.id === "string" ? session.id : null;

        if (!userId || !planId) {
          break;
        }

        // Idempotence : Stripe livre « au moins une fois » ses événements. Un
        // abonnement est identifié par son identifiant Stripe, un paiement
        // unique (plan LIFETIME) par la session Checkout qui l'a produit.
        const existing =
          (subscriptionId
            ? await prisma.subscription.findUnique({
                where: { stripeSubscriptionId: subscriptionId },
              })
            : null) ??
          (sessionId
            ? await prisma.subscription.findUnique({ where: { stripeSessionId: sessionId } })
            : null);

        let periods = { start: new Date(), end: new Date(Date.now() + 30 * 864e5) };
        let cancelAtPeriodEnd = false;

        if (subscriptionId) {
          const stripeSubscription = await getStripe().subscriptions.retrieve(subscriptionId);
          periods = extractPeriods(stripeSubscription);
          cancelAtPeriodEnd = Boolean(stripeSubscription.cancel_at_period_end);
        } else {
          // Achat unique : aucun terme de renouvellement à attendre.
          periods = { start: new Date(), end: new Date(Date.now() + 100 * 365 * 864e5) };
        }

        let subscription = existing;
        if (existing) {
          subscription = await prisma.subscription.update({
            where: { id: existing.id },
            data: {
              status: "ACTIVE",
              currentPeriodStart: periods.start,
              currentPeriodEnd: periods.end,
              cancelAtPeriodEnd,
              ...(subscriptionId && !existing.stripeSubscriptionId
                ? { stripeSubscriptionId: subscriptionId }
                : {}),
              ...(sessionId && !existing.stripeSessionId ? { stripeSessionId: sessionId } : {}),
              ...(customerId ? { stripeCustomerId: customerId } : {}),
            },
          });
        } else {
          try {
            const created = await prisma.subscription.create({
              data: {
                userId,
                planId,
                status: "ACTIVE",
                stripeSubscriptionId: subscriptionId,
                stripeSessionId: sessionId,
                stripeCustomerId: customerId,
                currentPeriodStart: periods.start,
                currentPeriodEnd: periods.end,
                cancelAtPeriodEnd,
              },
            });
            await recordSubscriptionEvent(created.id, "CREATED", {
              source: "checkout.session.completed",
              planId,
              mode: subscriptionId ? "subscription" : "payment",
              amount: Number(session.amount_total ?? 0),
              checkoutSessionId: sessionId,
            });
            subscription = created;
          } catch (error) {
            if (!isUniqueViolation(error)) throw error;
            // `customer.subscription.created` a créé la ligne en parallèle : on
            // la relit et on la complète (session Checkout, période, client).
            subscription = await prisma.subscription.findFirst({
              where: {
                OR: [
                  ...(subscriptionId ? [{ stripeSubscriptionId: subscriptionId }] : []),
                  ...(sessionId ? [{ stripeSessionId: sessionId }] : []),
                ],
              },
            });
            if (!subscription) throw error;
            subscription = await prisma.subscription.update({
              where: { id: subscription.id },
              data: {
                status: "ACTIVE",
                currentPeriodStart: periods.start,
                currentPeriodEnd: periods.end,
                cancelAtPeriodEnd,
                ...(sessionId && !subscription.stripeSessionId
                  ? { stripeSessionId: sessionId }
                  : {}),
                ...(customerId ? { stripeCustomerId: customerId } : {}),
              },
            });
          }
        }

        await prisma.author.update({
          where: { id: userId },
          data: {
            ...(customerId ? { stripeCustomerId: customerId } : {}),
          },
        });

        // Achat unique : aucune facture (donc aucun `invoice.paid`) ne suivra,
        // le règlement est donc enregistré ici — une seule fois, grâce à
        // l'idempotence ci-dessus.
        if (!subscriptionId && !existing && subscription) {
          const amount = Number(session.amount_total ?? 0);
          if (amount > 0) {
            const paymentIntentId = extractPaymentIntentId(session);
            const paymentData = {
              subscriptionId: subscription.id,
              userId,
              amount,
              currency: String(session.currency ?? "eur").toUpperCase(),
              status: "SUCCEEDED" as const,
              paidAt: new Date(),
            };
            if (paymentIntentId) {
              await prisma.payment.upsert({
                where: { stripePaymentIntentId: paymentIntentId },
                update: paymentData,
                create: { ...paymentData, stripePaymentIntentId: paymentIntentId },
              });
            } else {
              await prisma.payment.create({ data: paymentData });
            }
          }
        }

        // Achat à vie : les prélèvements récurrents n'ont plus lieu d'être, on
        // annule les autres abonnements Stripe de ce client.
        if (!subscriptionId && subscription) {
          await cancelOtherSubscriptions(userId, subscription.id);
        }

        // Recalcul à partir de la base : le plan à vie maintient l'accès même
        // si un abonnement récurrent vient d'être annulé.
        await syncPremiumFlag(userId);
        break;
      }

      /* ---------------------------------------------------------------- */
      /* Facture payée → enregistrer le paiement                           */
      /* ---------------------------------------------------------------- */
      case "invoice.paid": {
        const invoice = event.data.object as unknown as Record<string, unknown>;
        const subscriptionId = extractSubscriptionId(invoice);
        const customerId = extractCustomerId(invoice);

        // Une facture d'abonnement porte son identifiant d'abonnement : c'est
        // lui qui fait foi. Le repli sur le client Stripe (« dernière ligne
        // créée ») attribuerait le paiement à la mauvaise ligne quand
        // `invoice.paid` est livré avant `customer.subscription.created`.
        let subscription = subscriptionId
          ? await prisma.subscription.findUnique({
              where: { stripeSubscriptionId: subscriptionId },
            })
          : await findSubscription(null, customerId);

        if (!subscription && subscriptionId) {
          // Facture livrée avant la création de l'abonnement : on recrée la
          // ligne à partir de l'objet Stripe (métadonnées planId / userId).
          subscription = await resolveSubscription(
            await getStripe().subscriptions.retrieve(subscriptionId),
          );
        }

        if (!subscription) {
          break;
        }

        const amount = Number(invoice.amount_paid ?? invoice.total ?? 0);
        const currency = String(invoice.currency ?? "eur").toUpperCase();
        const paymentIntentId = await resolveInvoicePaymentIntentId(invoice);
        const paidAt =
          toDate(invoice.status_transitions
            ? (invoice.status_transitions as { paid_at?: number }).paid_at
            : null) ?? new Date();

        // Renouvellement : on ne journalise que les factures de cycle (la
        // première facture accompagne déjà la création de l'abonnement), pour
        // ne pas noyer le journal sous le bruit.
        const billingReason = typeof invoice.billing_reason === "string" ? invoice.billing_reason : null;
        if (billingReason === "subscription_cycle" || billingReason === "subscription_update") {
          await recordSubscriptionEvent(subscription.id, "RENEWED", {
            source: "invoice.paid",
            invoiceId: typeof invoice.id === "string" ? invoice.id : null,
            amount,
            currency,
            billingReason,
          });
        }

        // Une facture Stripe est unique : c'est la clé d'idempotence naturelle
        // des paiements d'abonnement (l'identifiant d'intent de paiement n'est
        // plus exposé directement par les versions d'API récentes).
        const paymentData = { amount, currency, status: "SUCCEEDED" as const, paidAt };
        const invoiceId = typeof invoice.id === "string" ? invoice.id : null;
        // Lien vers la facture hébergée (WP7d) : affiché dans l'espace abonné.
        const invoiceUrl = extractInvoiceUrl(invoice);

        if (invoiceId) {
          await prisma.payment.upsert({
            where: { stripeInvoiceId: invoiceId },
            update: {
              ...paymentData,
              ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
              ...(invoiceUrl ? { invoiceUrl } : {}),
            },
            create: {
              subscriptionId: subscription.id,
              userId: subscription.userId,
              ...paymentData,
              stripeInvoiceId: invoiceId,
              stripePaymentIntentId: paymentIntentId,
              invoiceUrl,
            },
          });
        } else if (paymentIntentId) {
          await prisma.payment.upsert({
            where: { stripePaymentIntentId: paymentIntentId },
            update: {
              ...paymentData,
              ...(invoiceUrl ? { invoiceUrl } : {}),
            },
            create: {
              subscriptionId: subscription.id,
              userId: subscription.userId,
              ...paymentData,
              stripePaymentIntentId: paymentIntentId,
              invoiceUrl,
            },
          });
        } else {
          // Ni facture ni intent exploitables (virement, etc.) : on évite les
          // doublons sur les relivraisons du webhook.
          const already = await prisma.payment.findFirst({
            where: { subscriptionId: subscription.id, amount, paidAt },
          });
          if (!already) {
            await prisma.payment.create({
              data: {
                subscriptionId: subscription.id,
                userId: subscription.userId,
                ...paymentData,
              },
            });
          }
        }
        break;
      }

      /* ---------------------------------------------------------------- */
      /* Changement de statut d'abonnement                                 */
      /* ---------------------------------------------------------------- */
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const stripeSubscription = event.data.object as unknown as Record<string, unknown>;
        const stripeSubscriptionId =
          typeof stripeSubscription.id === "string" ? stripeSubscription.id : null;
        const customerId = extractCustomerId(stripeSubscription);
        const isDeleted = event.type === "customer.subscription.deleted";
        const isCreated = event.type === "customer.subscription.created";

        const status: SubscriptionStatus = isDeleted
          ? "CANCELED"
          : mapStripeStatus(stripeSubscription.status);
        const periods = extractPeriods(stripeSubscription);
        const cancelAtPeriodEnd = Boolean(stripeSubscription.cancel_at_period_end);
        const canceledAt = toDate(stripeSubscription.canceled_at);

        // Résolution de la ligne en base.
        // - `created` : identifiant Stripe, puis création depuis les métadonnées.
        //   On ne retombe PAS sur le client Stripe ici, sinon un nouvel
        //   abonnement ressusciterait une ligne résiliée.
        // - `updated` / `deleted` : identifiant Stripe, puis client (lignes
        //   historiques sans identifiant), puis métadonnées.
        let subscription: Awaited<ReturnType<typeof resolveSubscription>> = null;
        if (isCreated) {
          subscription = await resolveSubscription(stripeSubscription, status);
        } else {
          subscription = await findSubscription(stripeSubscriptionId, customerId);
          if (!subscription && !isDeleted) {
            subscription = await resolveSubscription(stripeSubscription, status);
          }
        }

        if (!subscription) {
          break;
        }

        // État précédent, pour ne journaliser que les vraies transitions.
        const previousStatus = subscription.status;
        const previousCancelAtPeriodEnd = subscription.cancelAtPeriodEnd;

        await prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            status,
            currentPeriodStart: periods.start,
            currentPeriodEnd: periods.end,
            cancelAtPeriodEnd,
            canceledAt: canceledAt ?? (isDeleted ? new Date() : subscription.canceledAt),
            // Abonnement retrouvé par le client Stripe (webhook arrivé avant
            // `checkout.session.completed`) : on mémorise son identifiant.
            ...(stripeSubscriptionId && !subscription.stripeSubscriptionId
              ? { stripeSubscriptionId }
              : {}),
          },
        });

        // Journal des transitions (WP7e). Les actions de l'espace abonné
        // mettent déjà la base à jour : elles journalisent l'événement et le
        // webhook ne voit alors plus de changement (pas de doublon).
        if (isDeleted) {
          await recordSubscriptionEvent(subscription.id, "CANCELED", {
            source: "customer.subscription.deleted",
            periodEnd: periods.end.toISOString(),
          });
        } else if (status !== previousStatus) {
          const statusEvents: Record<SubscriptionStatus, Parameters<typeof recordSubscriptionEvent>[1]> = {
            ACTIVE: "ACTIVATED",
            TRIALING: "ACTIVATED",
            PAST_DUE: "PAST_DUE",
            CANCELED: "CANCELED",
            EXPIRED: "EXPIRED",
          };
          await recordSubscriptionEvent(subscription.id, statusEvents[status], {
            source: "customer.subscription.updated",
            previousStatus,
            status,
          });
        } else if (cancelAtPeriodEnd !== previousCancelAtPeriodEnd) {
          await recordSubscriptionEvent(
            subscription.id,
            cancelAtPeriodEnd ? "CANCELED" : "REACTIVATED",
            {
              source: "stripe",
              scheduled: cancelAtPeriodEnd,
              periodEnd: periods.end.toISOString(),
            },
          );
        }

        // Recalcul global : un utilisateur peut cumuler plusieurs abonnements,
        // la résiliation de l'un ne doit pas couper l'accès procuré par l'autre.
        await syncPremiumFlag(subscription.userId);
        break;
      }

      default:
        break;
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: `Échec du traitement de l'événement ${event.type} : ${
          error instanceof Error ? error.message : "erreur inconnue"
        }`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true, type: event.type });
}
