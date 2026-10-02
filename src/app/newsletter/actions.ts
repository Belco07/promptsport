"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import {
  confirmUnsubscribeByToken,
  sendConfirmationEmail,
  updateSubscriberPreferences,
} from "@/lib/newsletter-send";
import { prisma } from "@/lib/prisma";
import {
  NEWSLETTER_RATE_LIMIT,
  clientIpFromHeaders,
  consumeRateLimit,
  newsletterRateLimitMessage,
} from "@/lib/rate-limit";

/**
 * Server Actions publiques de la newsletter (WP11c).
 *
 * Trois actions, toutes accessibles sans compte :
 *
 *  - `subscribeToNewsletter` : gère le formulaire d'inscription, avec limitation
 *    de débit par adresse IP (3 par heure) et double opt-in obligatoire ;
 *  - `confirmUnsubscribe` : le bouton de la page de désabonnement — le GET de
 *    cette page ne change rien, seule cette action modifie le statut ;
 *  - `updatePreferences` : les listes suivies, depuis la page de préférences.
 *
 * Aucune de ces actions ne renvoie de jeton : le jeton public n'est transmis que
 * par e-mail. Le renvoyer dans la réponse d'un formulaire permettrait à
 * n'importe qui de saisir l'adresse d'un tiers pour obtenir ses liens de gestion.
 */

/** Longueur maximale d'un nom d'abonné (garde-fou, pas une règle métier). */
const MAX_NAME_LENGTH = 80;

/** Validation d'adresse volontairement simple : un `@`, un domaine, pas d'espace. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type SubscribeState = {
  code: "ok" | "already" | "invalid-email" | "invalid-name" | "consent" | "rate-limited" | "bounced";
  message: string;
};

function rateLimitKey(ip: string): string {
  return `newsletter:${ip}`;
}

/**
 * Inscription depuis le formulaire public.
 *
 * Le compteur d'inscriptions n'est consommé que pour une demande valide
 * (consentement donné, adresse plausible) : une faute de frappe ne doit pas
 * rapprocher un visiteur de la limite.
 */
export async function subscribeToNewsletter(
  _previousState: SubscribeState | undefined,
  formData: FormData,
): Promise<SubscribeState> {
  const rawEmail = String(formData.get("email") ?? "").trim().toLowerCase();
  const rawName = String(formData.get("name") ?? "").trim();
  const consent = formData.get("consentement");
  const listIds = formData
    .getAll("listes")
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  if (consent !== "on" && consent !== "true") {
    return {
      code: "consent",
      message:
        "Merci de cocher la case d'acceptation : nous avons besoin de votre accord pour vous écrire.",
    };
  }
  if (!EMAIL_PATTERN.test(rawEmail)) {
    return { code: "invalid-email", message: "Cette adresse e-mail ne semble pas valide." };
  }
  if (rawName.length > MAX_NAME_LENGTH) {
    return { code: "invalid-name", message: `Le nom ne peut pas dépasser ${MAX_NAME_LENGTH} caractères.` };
  }

  const ip = clientIpFromHeaders(await headers());
  const limit = consumeRateLimit(rateLimitKey(ip), NEWSLETTER_RATE_LIMIT);
  if (!limit.allowed) {
    return { code: "rate-limited", message: newsletterRateLimitMessage(limit.retryAfterMs) };
  }

  const existing = await prisma.newsletterSubscriber.findUnique({
    where: { email: rawEmail },
    select: { id: true, email: true, name: true, status: true, confirmationToken: true },
  });

  // Seules les listes actives peuvent être rejointes.
  const activeLists = await prisma.newsletterList.findMany({
    where: { id: { in: listIds }, active: true },
    select: { id: true },
  });

  if (existing?.status === "BOUNCED") {
    // Le fournisseur a constaté que l'adresse n'existe pas : la réinscrire
    // abîmerait la réputation d'envoi sans bénéfice pour personne.
    return {
      code: "bounced",
      message:
        "Cette adresse a été rejetée par notre service d'envoi : elle ne peut pas recevoir la newsletter.",
    };
  }

  if (existing) {
    // Déjà inscrit : on ne crée pas de doublon. Le jeton n'est jamais renvoyé
    // dans la page (sinon n'importe qui obtiendrait les liens de gestion d'un
    // tiers en saisissant son adresse) : il repart par e-mail.
    const token = existing.confirmationToken ?? randomUUID();
    const name = existing.name ?? (rawName || null);

    if (existing.status === "CONFIRMED") {
      // Un abonné confirmé le reste : le renvoyer en PENDING le priverait des
      // campagnes en cours tant qu'il n'a pas recliqué. On se contente de
      // garantir un jeton valide et de renvoyer l'e-mail de gestion.
      if (token !== existing.confirmationToken || existing.name !== name) {
        await prisma.newsletterSubscriber.update({
          where: { id: existing.id },
          data: { confirmationToken: token, name },
        });
      }

      await sendConfirmationEmail({
        id: existing.id,
        email: existing.email,
        name,
        confirmationToken: token,
      });

      return {
        code: "already",
        message:
          "Vous êtes déjà inscrit. Nous venons de vous renvoyer un e-mail : le lien qu'il contient permet de gérer vos préférences ou de vous désabonner.",
      };
    }

    // Inscription en attente ou adresse désabonnée : double opt-in, donc retour
    // en PENDING et nouvel e-mail de confirmation. Une adresse désabonnée qui
    // resouscrit donne bien son accord de nouveau.
    await prisma.newsletterSubscriber.update({
      where: { id: existing.id },
      data: {
        confirmationToken: token,
        status: "PENDING",
        name,
        unsubscribedAt: null,
        ...(activeLists.length > 0
          ? { lists: { set: activeLists.map((list) => ({ id: list.id })) } }
          : {}),
      },
    });

    const resumed = await sendConfirmationEmail({
      id: existing.id,
      email: existing.email,
      name,
      confirmationToken: token,
    });
    if (!resumed.success) {
      console.warn(`[newsletter] confirmation non envoyée à ${existing.email} : ${resumed.error}`);
    }

    return {
      code: "ok",
      message: "Vérifiez votre boîte mail pour confirmer votre inscription.",
    };
  }

  const token = randomUUID();
  const created = await prisma.newsletterSubscriber.create({
    data: {
      email: rawEmail,
      name: rawName || null,
      status: "PENDING",
      confirmationToken: token,
      source: "site",
      lists: { connect: activeLists.map((list) => ({ id: list.id })) },
    },
    select: { id: true },
  });

  const email = await sendConfirmationEmail({
    id: created.id,
    email: rawEmail,
    name: rawName || null,
    confirmationToken: token,
  });
  if (!email.success) {
    console.warn(`[newsletter] confirmation non envoyée à ${rawEmail} : ${email.error}`);
  }

  return {
    code: "ok",
    message:
      "Vérifiez votre boîte mail pour confirmer votre inscription. Le lien qu'elle contient est valable sans limite de temps.",
  };
}

/**
 * Confirme le désabonnement (bouton de la page dédiée).
 *
 * Redirection après action (POST/Redirect/GET) : recharger la page de succès ne
 * rejoue pas l'action, et le compte rendu survit à un rafraîchissement.
 */
export async function confirmUnsubscribe(token: string): Promise<void> {
  const outcome = await confirmUnsubscribeByToken(token);
  revalidatePath(`/newsletter/unsubscribe/${token}`);
  redirect(`/newsletter/unsubscribe/${token}?confirme=1${outcome.status === "invalid" ? "&invalide=1" : ""}`);
}

/** Enregistre les listes suivies depuis la page de préférences. */
export async function updatePreferences(token: string, formData: FormData): Promise<void> {
  const listIds = formData
    .getAll("listes")
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  const outcome = await updateSubscriberPreferences(token, listIds);
  revalidatePath(`/newsletter/preferences/${token}`);

  const result =
    outcome.status === "saved" ? "ok" : outcome.status === "empty" ? "vide" : outcome.status === "bounced" ? "invalide" : "inconnu";
  redirect(`/newsletter/preferences/${token}?enregistre=${result}`);
}
