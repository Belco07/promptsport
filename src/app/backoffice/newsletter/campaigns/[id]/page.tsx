import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  deleteCampaign,
  duplicateCampaign,
  resendToNonOpeners,
  scheduleCampaign,
} from "@/app/backoffice/newsletter/campaigns/actions";
import { SendCampaignButton } from "@/app/backoffice/newsletter/campaigns/components/SendCampaignButton";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { auth } from "@/lib/auth";
import { formatDate, formatMatchDate } from "@/lib/formatDate";
import {
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_STATUS_TONES,
  SEND_STATUS_LABELS,
  SEND_STATUS_TONES,
  percent,
} from "@/lib/newsletter";
import { countCampaignRecipients } from "@/lib/newsletter-send";
import { prisma } from "@/lib/prisma";

/**
 * Détail d'une campagne (WP11d).
 *
 * Métriques et taux, tableau des destinataires paginé (50), et les actions qui
 * dépendent de l'état : envoyer (brouillon ou planifiée), planifier, relancer les
 * non-ouvreurs (campagne envoyée), dupliquer, supprimer.
 *
 * « Désabonnés » compte les destinataires de **cette** campagne qui sont
 * aujourd'hui désabonnés : le schéma du WP11a ne stocke pas de compteur par
 * campagne, et une approximation annoncée vaut mieux qu'un chiffre inventé.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Détail d'une campagne", robots: { index: false } };

const PAGE_SIZE = 50;
const BASE_PATH = "/backoffice/newsletter/campaigns";

const MESSAGES: Record<string, string> = {
  cree: "Campagne créée en brouillon.",
  maj: "Campagne mise à jour.",
  dupliquee: "Copie créée en brouillon.",
  planifiee: "Campagne planifiée : elle partira à l'échéance via l'endpoint de cron.",
  deplanifiee: "Planification retirée : la campagne est repassée en brouillon.",
  "non-modifiable": "Une campagne déjà partie ne peut plus être modifiée.",
  "suppression-refusee": "Une campagne envoyée ne peut pas être supprimée.",
  "envoi-erreur": "L'envoi s'est interrompu : consultez les journaux du serveur.",
  "envoi-refuse": "Envoi refusé : la campagne n'est plus dans un état expédiable.",
  "aucun-non-ouvreur": "Aucun non-ouvreur à relancer : tous les destinataires ont ouvert la campagne.",
};

function parsePage(value: string | undefined): number {
  const page = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

/** Valeur d'`<input type="datetime-local">` à partir d'une date (heure locale). */
function toLocalInputValue(date: Date | null): string {
  if (!date) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** Bloc de métrique : libellé, valeur, précision éventuelle. */
function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-primary-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-neutral-500">{hint}</p> : null}
    </div>
  );
}

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; message?: string; envoyer?: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.role !== "ADMIN") {
    redirect("/studio");
  }

  const [{ id }, query] = await Promise.all([params, searchParams]);
  const page = parsePage(query.page);

  const campaign = await prisma.newsletterCampaign.findUnique({
    where: { id },
    select: {
      id: true,
      subject: true,
      previewText: true,
      status: true,
      scheduledAt: true,
      sentAt: true,
      recipientCount: true,
      deliveredCount: true,
      openCount: true,
      clickCount: true,
      bounceCount: true,
      createdAt: true,
      updatedAt: true,
      listId: true,
      list: { select: { id: true, name: true, active: true } },
      createdBy: { select: { name: true } },
      _count: { select: { sends: true } },
    },
  });

  if (!campaign) {
    notFound();
  }

  const [sends, sendTotal, unsubscribed, recipients] = await Promise.all([
    prisma.newsletterSend.findMany({
      where: { campaignId: campaign.id },
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        status: true,
        sentAt: true,
        openedAt: true,
        clickedAt: true,
        errorMessage: true,
        subscriber: { select: { email: true, name: true, status: true } },
      },
    }),
    prisma.newsletterSend.count({ where: { campaignId: campaign.id } }),
    prisma.newsletterSend.count({
      where: { campaignId: campaign.id, subscriber: { status: "UNSUBSCRIBED" } },
    }),
    countCampaignRecipients(campaign.listId),
  ]);

  const totalPages = Math.max(1, Math.ceil(sendTotal / PAGE_SIZE));
  const pageHref = (target: number) => `${BASE_PATH}/${campaign.id}?page=${target}`;

  const envoiMatch = query.message?.match(/^envoi-(\d+)-(\d+)$/);
  const notice = envoiMatch
    ? `Envoi terminé : ${envoiMatch[1]} message(s) expédié(s), ${envoiMatch[2]} échec(s).`
    : query.message?.startsWith("relance-")
      ? `Relance créée en brouillon pour ${query.message.split("-")[1]} non-ouvreur(s).`
      : query.message
        ? (MESSAGES[query.message] ?? null)
        : null;
  const noticeTone =
    query.message === "envoi-refuse" ||
    query.message === "envoi-erreur" ||
    query.message === "suppression-refusee" ||
    query.message === "aucun-non-ouvreur"
      ? "danger"
      : envoiMatch && envoiMatch[2] !== "0"
        ? "danger"
        : "success";

  const canSend = campaign.status === "DRAFT" || campaign.status === "SCHEDULED";
  const canEdit = canSend;
  const canRetarget = campaign.status === "SENT";
  const canDelete = campaign.status !== "SENT" && campaign.status !== "SENDING";

  return (
    <div className="px-8 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-neutral-500">
            <Link href={BASE_PATH} className="font-semibold text-primary-700 underline">
              Campagnes
            </Link>{" "}
            / détail
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-primary-900">
            {campaign.subject}
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-neutral-600">
            <Badge variant="status" tone={CAMPAIGN_STATUS_TONES[campaign.status]}>
              {CAMPAIGN_STATUS_LABELS[campaign.status]}
            </Badge>
            <span>
              liste <strong>{campaign.list.name}</strong>
              {campaign.list.active ? "" : " (inactive)"}
            </span>
            <span>· créée le {formatDate(campaign.createdAt)} par {campaign.createdBy.name}</span>
            {campaign.sentAt ? <span>· envoyée le {formatDate(campaign.sentAt)}</span> : null}
            {campaign.scheduledAt ? (
              <span>· prévue le {formatMatchDate(campaign.scheduledAt)}</span>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`${BASE_PATH}/${campaign.id}/preview`}
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-800 transition-colors hover:border-primary-300 hover:bg-primary-50"
          >
            Prévisualiser
          </Link>
          {canEdit ? (
            <Link
              href={`${BASE_PATH}/${campaign.id}/edit`}
              className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-800 transition-colors hover:border-primary-300 hover:bg-primary-50"
            >
              Modifier
            </Link>
          ) : null}
          {canSend ? (
            <SendCampaignButton
              campaignId={campaign.id}
              subject={campaign.subject}
              recipients={recipients}
              defaultOpen={query.envoyer === "1"}
            />
          ) : null}
        </div>
      </div>

      {notice ? (
        <p
          role="status"
          className={`mt-6 rounded-lg border px-4 py-3 text-sm font-medium ${
            noticeTone === "success"
              ? "border-success-200 bg-success-50 text-success-800"
              : "border-danger-200 bg-danger-50 text-danger-700"
          }`}
        >
          {notice}
        </p>
      ) : null}

      {/* Métriques et taux. */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Destinataires" value={String(campaign.recipientCount)} hint={`${recipients} confirmé(s) aujourd'hui`} />
        <Metric label="Délivrés" value={String(campaign.deliveredCount)} />
        <Metric
          label="Ouverts"
          value={String(campaign.openCount)}
          hint={`taux ${percent(campaign.openCount, campaign.deliveredCount)}`}
        />
        <Metric
          label="Cliqués"
          value={String(campaign.clickCount)}
          hint={`taux ${percent(campaign.clickCount, campaign.deliveredCount)}`}
        />
        <Metric
          label="Rejets"
          value={String(campaign.bounceCount)}
          hint={`taux ${percent(campaign.bounceCount, campaign.recipientCount)}`}
        />
        <Metric label="Désabonnés" value={String(unsubscribed)} hint="parmi les destinataires, depuis" />
      </div>

      {/* Planification. */}
      {canSend ? (
        <Card className="mt-6">
          <CardBody>
            <h2 className="text-sm font-bold text-neutral-800">Planification</h2>
            <form action={scheduleCampaign.bind(null, campaign.id)} className="mt-3 flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="scheduledAt" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Date et heure d&apos;envoi
                </label>
                <input
                  id="scheduledAt"
                  name="scheduledAt"
                  type="datetime-local"
                  defaultValue={toLocalInputValue(campaign.scheduledAt)}
                  className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
                />
              </div>
              <Button type="submit" variant="secondary">
                {campaign.scheduledAt ? "Modifier la planification" : "Planifier l'envoi"}
              </Button>
              {campaign.scheduledAt ? (
                <Button type="submit" name="scheduledAt" value="" variant="ghost">
                  Retirer la planification
                </Button>
              ) : null}
            </form>
            <p className="mt-2 text-xs text-neutral-500">
              Les campagnes planifiées partent à l&apos;échéance via{" "}
              <code className="font-mono">/api/cron/newsletter</code> (voir le README), ou
              immédiatement avec le bouton « Traiter les envois planifiés » de la liste.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {/* Destinataires. */}
      <section className="mt-8">
        <h2 className="text-lg font-bold tracking-tight text-primary-900">
          Destinataires ({sendTotal})
        </h2>

        <div className="mt-4 overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Envois individuels de la campagne</caption>
            <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th scope="col" className="px-3 py-3 font-semibold">Destinataire</th>
                <th scope="col" className="px-3 py-3 font-semibold">Statut</th>
                <th scope="col" className="px-3 py-3 font-semibold">Envoi</th>
                <th scope="col" className="px-3 py-3 font-semibold">Ouverture</th>
                <th scope="col" className="px-3 py-3 font-semibold">Clic</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {sends.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-neutral-500">
                    Aucun envoi : la campagne n&apos;a pas encore été expédiée.
                  </td>
                </tr>
              ) : (
                sends.map((send) => (
                  <tr key={send.id} className="align-top hover:bg-neutral-50">
                    <td className="px-3 py-3">
                      <span className="font-medium text-neutral-900">{send.subscriber.email}</span>
                      {send.subscriber.name ? (
                        <span className="block text-xs text-neutral-500">{send.subscriber.name}</span>
                      ) : null}
                      {send.subscriber.status === "UNSUBSCRIBED" ? (
                        <span className="block text-xs text-neutral-500">désabonné depuis</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <Badge variant="status" tone={SEND_STATUS_TONES[send.status]}>
                        {SEND_STATUS_LABELS[send.status]}
                      </Badge>
                      {send.errorMessage ? (
                        <span className="mt-1 block max-w-xs text-xs text-danger-700">
                          {send.errorMessage.slice(0, 120)}
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-neutral-700">
                      {send.sentAt ? formatDate(send.sentAt) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-neutral-700">
                      {send.openedAt ? formatDate(send.openedAt) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-neutral-700">
                      {send.clickedAt ? formatDate(send.clickedAt) : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 ? (
          <nav aria-label="Pagination des destinataires" className="mt-4 flex items-center justify-between text-sm">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="font-semibold text-primary-700 underline">
                ← Page précédente
              </Link>
            ) : (
              <span className="text-neutral-400">← Page précédente</span>
            )}
            <span className="text-neutral-600">
              Page {page} sur {totalPages}
            </span>
            {page < totalPages ? (
              <Link href={pageHref(page + 1)} className="font-semibold text-primary-700 underline">
                Page suivante →
              </Link>
            ) : (
              <span className="text-neutral-400">Page suivante →</span>
            )}
          </nav>
        ) : null}
      </section>

      {/* Actions secondaires. */}
      <section className="mt-8 border-t border-neutral-200 pt-6">
        <h2 className="text-sm font-bold text-neutral-800">Actions</h2>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          {canRetarget ? (
            <form action={resendToNonOpeners.bind(null, campaign.id)}>
              <Button type="submit" variant="secondary">
                Renvoyer aux non-ouvreurs
              </Button>
            </form>
          ) : null}
          <form action={duplicateCampaign.bind(null, campaign.id)}>
            <Button type="submit" variant="secondary">
              Dupliquer
            </Button>
          </form>
          {canDelete ? (
            <form action={deleteCampaign.bind(null, campaign.id)}>
              <Button type="submit" variant="danger">
                Supprimer
              </Button>
            </form>
          ) : (
            <span className="text-sm text-neutral-500">
              Une campagne envoyée ne peut pas être supprimée (dupliquez-la pour repartir).
            </span>
          )}
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          « Renvoyer aux non-ouvreurs » crée une liste composée des destinataires qui n&apos;ont pas
          ouvert, puis une campagne en brouillon visant cette liste : rien n&apos;est expédié sans
          votre validation.
        </p>
      </section>
    </div>
  );
}
