import type { Prisma } from "@/generated/prisma/client";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  deleteCampaign,
  duplicateCampaign,
  processScheduledCampaignsAction,
} from "@/app/backoffice/newsletter/campaigns/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { auth } from "@/lib/auth";
import { formatDate } from "@/lib/formatDate";
import {
  CAMPAIGN_STATUSES,
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_STATUS_TONES,
  isCampaignStatus,
  percent,
} from "@/lib/newsletter";
import { prisma } from "@/lib/prisma";

/**
 * Liste des campagnes (WP11d).
 *
 * Filtres (statut, liste, recherche par sujet), tri du plus récent au plus
 * ancien, pagination de 20. Aucune création ici : le formulaire vit sur
 * `/new`, et les actions de ligne renvoient vers le détail (Voir) ou exécutent
 * une Server Action (Dupliquer, Supprimer).
 *
 * « Envoyer » n'existe pas comme action de tableau : il ouvre la page de détail
 * avec la confirmation modale déjà affichée (`?envoyer=1`). Un envoi ne doit
 * jamais partir d'un simple clic dans une liste.
 */

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const BASE_PATH = "/backoffice/newsletter/campaigns";

/** Messages transmis par les Server Actions via l'URL (POST/Redirect/GET). */
const MESSAGES: Record<string, string> = {
  cree: "Campagne créée en brouillon.",
  maj: "Campagne mise à jour.",
  dupliquee: "Campagne dupliquée en brouillon.",
  supprimee: "Campagne supprimée.",
  "suppression-refusee": "Une campagne envoyée ne peut pas être supprimée.",
  introuvable: "Cette campagne n'existe plus.",
  "non-modifiable": "Une campagne déjà partie ne peut plus être modifiée.",
  "date-invalide": "La date de planification est invalide.",
  planifiee: "Campagne planifiée.",
  deplanifiee: "Planification retirée : la campagne est repassée en brouillon.",
};

function parsePage(value: string | undefined): number {
  const page = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{
    statut?: string;
    liste?: string;
    q?: string;
    page?: string;
    message?: string;
    campagne?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.role !== "ADMIN") {
    redirect("/studio");
  }

  const params = await searchParams;
  const page = parsePage(params.page);

  const where: Prisma.NewsletterCampaignWhereInput = {};
  if (params.statut && isCampaignStatus(params.statut)) {
    where.status = params.statut;
  }
  if (params.liste) {
    where.listId = params.liste;
  }
  if (params.q) {
    where.subject = { contains: params.q };
  }

  const [campaigns, total, lists, scheduled] = await Promise.all([
    prisma.newsletterCampaign.findMany({
      where,
      // Le plus récent d'abord : la campagne qu'on vient de créer est en tête.
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        subject: true,
        status: true,
        sentAt: true,
        scheduledAt: true,
        recipientCount: true,
        deliveredCount: true,
        openCount: true,
        clickCount: true,
        bounceCount: true,
        createdAt: true,
        list: { select: { name: true } },
        createdBy: { select: { name: true } },
        _count: { select: { sends: true } },
      },
    }),
    prisma.newsletterCampaign.count({ where }),
    prisma.newsletterList.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.newsletterCampaign.count({ where: { status: "SCHEDULED" } }),
  ]);

  // Compte rendu d'un envoi : « envoi-<envoyés>-<échecs> ».
  const directMessage = params.message ? (MESSAGES[params.message] ?? null) : null;
  const envoiMatch = params.message?.match(/^envoi-(\d+)-(\d+)$/);
  const notice = envoiMatch
    ? `Envoi terminé : ${envoiMatch[1]} message(s) expédié(s), ${envoiMatch[2]} échec(s).`
    : params.message?.startsWith("relance-")
      ? `Relance créée en brouillon pour ${params.message.split("-")[1]} non-ouvreur(s).`
      : params.message?.startsWith("planifiees-")
        ? `Envois planifiés traités : ${params.message.split("-")[1]} campagne(s), ${params.message.split("-")[2]} erreur(s).`
        : directMessage;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    if (params.statut) query.set("statut", params.statut);
    if (params.liste) query.set("liste", params.liste);
    if (params.q) query.set("q", params.q);
    query.set("page", String(target));
    return `${BASE_PATH}?${query.toString()}`;
  };

  return (
    <div className="px-8 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary-900">Campagnes</h1>
          <p className="mt-2 text-sm text-neutral-600">
            {total} campagne{total > 1 ? "s" : ""}
            {scheduled > 0 ? ` · ${scheduled} planifiée${scheduled > 1 ? "s" : ""}` : ""} · configuration
            de l&apos;envoi dans{" "}
            <Link
              href="/backoffice/newsletter"
              className="font-semibold text-primary-700 underline transition-colors hover:text-primary-900"
            >
              abonnés et listes
            </Link>
            .
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <form action={processScheduledCampaignsAction}>
            <Button type="submit" variant="secondary">
              Traiter les envois planifiés
            </Button>
          </form>
          <Link href={`${BASE_PATH}/new`} className="inline-block rounded-lg bg-primary-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800">
            Nouvelle campagne
          </Link>
        </div>
      </div>

      {notice ? (
        <p
          role="status"
          className="mt-6 rounded-lg border border-success-200 bg-success-50 px-4 py-3 text-sm font-medium text-success-800"
        >
          {notice}
        </p>
      ) : null}

      {/* Filtres : un simple GET, sans JavaScript. */}
      <Card className="mt-6">
        <CardBody className="p-4">
          <form className="flex flex-wrap items-end gap-3">
            <div className="min-w-[12rem] flex-1">
              <label htmlFor="q" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Recherche par sujet
              </label>
              <input
                id="q"
                name="q"
                type="search"
                defaultValue={params.q ?? ""}
                placeholder="mots du sujet"
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="statut" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Statut
              </label>
              <select
                id="statut"
                name="statut"
                defaultValue={params.statut ?? ""}
                className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">Tous</option>
                {CAMPAIGN_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {CAMPAIGN_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="liste" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Liste
              </label>
              <select
                id="liste"
                name="liste"
                defaultValue={params.liste ?? ""}
                className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">Toutes</option>
                {lists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" variant="secondary">
              Filtrer
            </Button>
            {params.statut || params.liste || params.q ? (
              <Link href={BASE_PATH} className="text-sm font-semibold text-neutral-600 underline">
                Réinitialiser
              </Link>
            ) : null}
          </form>
        </CardBody>
      </Card>

      <div className="mt-6 overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Campagnes de newsletter</caption>
          <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th scope="col" className="px-3 py-3 font-semibold">Sujet</th>
              <th scope="col" className="px-3 py-3 font-semibold">Liste</th>
              <th scope="col" className="px-3 py-3 font-semibold">Statut</th>
              <th scope="col" className="px-3 py-3 font-semibold">Envoi</th>
              <th scope="col" className="px-3 py-3 font-semibold">Destinataires</th>
              <th scope="col" className="px-3 py-3 font-semibold">Ouverture</th>
              <th scope="col" className="px-3 py-3 font-semibold">Clic</th>
              <th scope="col" className="px-3 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {campaigns.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-sm text-neutral-500">
                  Aucune campagne ne correspond à ces filtres.{" "}
                  <Link href={`${BASE_PATH}/new`} className="font-semibold text-primary-700 underline">
                    Créer la première campagne
                  </Link>
                  .
                </td>
              </tr>
            ) : (
              campaigns.map((campaign) => (
                <tr key={campaign.id} className="align-top hover:bg-neutral-50">
                  <td className="px-3 py-3">
                    <Link
                      href={`${BASE_PATH}/${campaign.id}`}
                      className="font-medium text-neutral-900 underline transition-colors hover:text-primary-800"
                    >
                      {campaign.subject}
                    </Link>
                    <span className="block text-xs text-neutral-500">
                      créée le {formatDate(campaign.createdAt)} par {campaign.createdBy.name}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <Badge variant="category" tone="primary">
                      {campaign.list.name}
                    </Badge>
                  </td>
                  <td className="px-3 py-3">
                    <Badge variant="status" tone={CAMPAIGN_STATUS_TONES[campaign.status]}>
                      {CAMPAIGN_STATUS_LABELS[campaign.status]}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-neutral-700">
                    {campaign.sentAt
                      ? formatDate(campaign.sentAt)
                      : campaign.scheduledAt
                        ? formatDate(campaign.scheduledAt)
                        : "—"}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-neutral-700">
                    {campaign.recipientCount}
                    <span className="block text-xs text-neutral-500">
                      {campaign._count.sends} envoi{campaign._count.sends > 1 ? "s" : ""}
                    </span>
                  </td>
                  <td className="px-3 py-3 tabular-nums text-neutral-700">
                    {percent(campaign.openCount, campaign.deliveredCount)}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-neutral-700">
                    {percent(campaign.clickCount, campaign.deliveredCount)}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <Link
                        href={`${BASE_PATH}/${campaign.id}`}
                        className="text-sm font-semibold text-primary-700 underline"
                      >
                        Voir
                      </Link>
                      {campaign.status === "DRAFT" || campaign.status === "SCHEDULED" ? (
                        <Link
                          href={`${BASE_PATH}/${campaign.id}/edit`}
                          className="text-sm font-semibold text-neutral-600 underline"
                        >
                          Éditer
                        </Link>
                      ) : null}
                      <form action={duplicateCampaign.bind(null, campaign.id)}>
                        <button type="submit" className="text-sm font-semibold text-neutral-600 underline">
                          Dupliquer
                        </button>
                      </form>
                      {campaign.status === "DRAFT" || campaign.status === "SCHEDULED" ? (
                        <Link
                          href={`${BASE_PATH}/${campaign.id}?envoyer=1`}
                          className="text-sm font-semibold text-primary-700 underline"
                        >
                          Envoyer
                        </Link>
                      ) : null}
                      {campaign.status !== "SENT" && campaign.status !== "SENDING" ? (
                        <form action={deleteCampaign.bind(null, campaign.id)}>
                          <button type="submit" className="text-sm font-semibold text-danger-700 underline">
                            Supprimer
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <nav aria-label="Pagination des campagnes" className="mt-4 flex items-center justify-between text-sm">
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
    </div>
  );
}
