import { Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { sendCampaignAction } from "@/app/backoffice/newsletter/actions";
import { CampaignsTab, type CampaignRow } from "@/app/backoffice/newsletter/components/CampaignsTab";
import {
  CampaignDetail,
  type CampaignDetailData,
} from "@/app/backoffice/newsletter/components/CampaignDetail";
import {
  SubscriberDetail,
  type SubscriberDetailData,
} from "@/app/backoffice/newsletter/components/SubscriberDetail";
import { ListForm } from "@/app/backoffice/newsletter/components/ListForm";
import { ListsTab, type NewsletterListRow } from "@/app/backoffice/newsletter/components/ListsTab";
import {
  SubscribersTab,
  type SubscriberRow,
} from "@/app/backoffice/newsletter/components/SubscribersTab";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { auth } from "@/lib/auth";
import {
  NEWSLETTER_PAGE_SIZE,
  isCampaignStatus,
  isSendStatus,
  isSubscriberStatus,
  monthStart,
  unsubscribeRate,
} from "@/lib/newsletter";
import { prisma } from "@/lib/prisma";

/**
 * Administration de la newsletter (WP11a).
 *
 * Deux onglets dans une seule page : abonnés et campagnes. Aucune création ni
 * modification ici — les données se saisissent dans Prisma Studio — mais deux
 * actions réelles : désabonner un abonné et dupliquer une campagne en
 * brouillon. Aucun e-mail n'est envoyé dans ce lot (WP11b).
 *
 * Choix de conception : pas de page de détail dédiée (le périmètre d'écriture du
 * WP11a s'arrête à ce dossier). « Voir » ouvre donc un panneau rendu par la page
 * à partir des paramètres `?abonne=` et `?campagne=`, sur le modèle du
 * formulaire de bannissement du WP10c.
 *
 * La page est réservée aux ADMIN ; la vérification est refaite dans les Server
 * Actions, qui sont des points d'entrée HTTP à part entière.
 */

const BASE_PATH = "/backoffice/newsletter";

const TABS = [
  { key: "subscribers", label: "Abonnés" },
  { key: "lists", label: "Listes" },
  { key: "campaigns", label: "Campagnes" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function resolveTab(value: string | undefined): TabKey {
  return TABS.some((tab) => tab.key === value) ? (value as TabKey) : "subscribers";
}

function parsePage(value: string | undefined): number {
  const page = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

/** Bloc de statistique, sur les jetons du design system. */
function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardBody className="p-4">
        <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-primary-900">{value}</p>
        {hint ? <p className="mt-1 text-xs text-neutral-500">{hint}</p> : null}
      </CardBody>
    </Card>
  );
}

export default async function BackofficeNewsletterPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    page?: string;
    abonne?: string;
    campagne?: string;
    /** Liste ouverte en édition dans l'onglet Listes (WP11f). */
    liste?: string;
    /** Compte rendu d'envoi : « <envoyés>-<échecs> » ou « erreur » (WP11b). */
    envoi?: string;
    message?: string;
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
  const tab = resolveTab(params.tab);
  const page = parsePage(params.page);
  const skip = (page - 1) * NEWSLETTER_PAGE_SIZE;

  /* ------------------------------------------------------------ statistiques */
  const [
    subscriberCount,
    confirmedCount,
    unsubscribedCount,
    bouncedCount,
    campaignCount,
    sentThisMonth,
    listCount,
  ] = await Promise.all([
    prisma.newsletterSubscriber.count(),
    prisma.newsletterSubscriber.count({ where: { status: "CONFIRMED" } }),
    prisma.newsletterSubscriber.count({ where: { status: "UNSUBSCRIBED" } }),
    prisma.newsletterSubscriber.count({ where: { status: "BOUNCED" } }),
    prisma.newsletterCampaign.count(),
    prisma.newsletterCampaign.count({
      where: { status: "SENT", sentAt: { gte: monthStart() } },
    }),
    prisma.newsletterList.count(),
  ]);

  /* -------------------------------------------------------- données de l'onglet */
  const query: Record<string, string> = {};

  let body: React.ReactNode = null;
  let total = 0;

  if (tab === "subscribers") {
    const [rows, count] = await Promise.all([
      prisma.newsletterSubscriber.findMany({
        orderBy: { createdAt: "desc" },
        skip,
        take: NEWSLETTER_PAGE_SIZE,
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          source: true,
          createdAt: true,
          lists: { select: { id: true, name: true }, orderBy: { name: "asc" } },
        },
      }),
      prisma.newsletterSubscriber.count(),
    ]);
    total = count;

    // Le statut vient de la base : on ne fait pas confiance à la colonne texte
    // sans la valider, comme pour les statuts de commentaire (WP10c).
    const subscriberRows: SubscriberRow[] = rows
      .filter((row) => isSubscriberStatus(row.status))
      .map((row) => ({ ...row, status: row.status }));

    body = (
      <SubscribersTab
        rows={subscriberRows}
        total={total}
        page={page}
        basePath={BASE_PATH}
        query={query}
        detailId={params.abonne}
      />
    );
  } else {
    const [rows, count] = await Promise.all([
      prisma.newsletterCampaign.findMany({
        orderBy: { createdAt: "desc" },
        skip,
        take: NEWSLETTER_PAGE_SIZE,
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
      prisma.newsletterCampaign.count(),
    ]);
    total = count;

    const campaignRows: CampaignRow[] = rows
      .filter((row) => isCampaignStatus(row.status))
      .map((row) => ({
        id: row.id,
        subject: row.subject,
        status: row.status,
        listName: row.list.name,
        sentAt: row.sentAt,
        scheduledAt: row.scheduledAt,
        recipientCount: row.recipientCount,
        deliveredCount: row.deliveredCount,
        openCount: row.openCount,
        clickCount: row.clickCount,
        bounceCount: row.bounceCount,
        createdAt: row.createdAt,
        createdByName: row.createdBy.name,
        sendCount: row._count.sends,
      }));

    body = (
      <CampaignsTab
        rows={campaignRows}
        total={total}
        page={page}
        basePath={BASE_PATH}
        query={query}
        detailId={params.campagne}
      />
    );
  }

  /* ------------------------------------------------- onglet Listes (WP11f) */
  // Les listes ne sont pas paginées : il y en a peu, et les voir toutes d'un coup
  // est plus utile que de les feuilleter (créer, activer, renommer).
  const listRows: NewsletterListRow[] =
    tab === "lists"
      ? (
          await prisma.newsletterList.findMany({
            orderBy: [{ active: "desc" }, { name: "asc" }],
            select: {
              id: true,
              name: true,
              slug: true,
              description: true,
              active: true,
              _count: { select: { subscribers: true, campaigns: true } },
            },
          })
        ).map((list) => ({
          id: list.id,
          name: list.name,
          slug: list.slug,
          description: list.description,
          active: list.active,
          subscriberCount: list._count.subscribers,
          // Renseigné plus bas, en une requête pour toutes les listes.
          confirmedCount: 0,
          campaignCount: list._count.campaigns,
        }))
      : [];

  if (tab === "lists" && listRows.length > 0) {
    // Le nombre d'abonnés CONFIRMÉS par liste ne s'obtient pas directement : une
    // relation plusieurs-à-plusieurs n'expose qu'un total. Une seule requête
    // ramène les appartenances des abonnés confirmés, qu'on répartit ensuite.
    const confirmedByList = new Map<string, number>(listRows.map((row) => [row.id, 0]));
    const memberships = await prisma.newsletterSubscriber.findMany({
      where: {
        status: "CONFIRMED",
        lists: { some: { id: { in: listRows.map((row) => row.id) } } },
      },
      select: { lists: { select: { id: true } } },
    });
    for (const membership of memberships) {
      for (const list of membership.lists) {
        if (confirmedByList.has(list.id)) {
          confirmedByList.set(list.id, (confirmedByList.get(list.id) ?? 0) + 1);
        }
      }
    }
    for (const row of listRows) {
      row.confirmedCount = confirmedByList.get(row.id) ?? 0;
    }
  }

  const openList = tab === "lists" && params.liste ? listRows.find((row) => row.id === params.liste) : undefined;

  if (tab === "lists") {
    total = listRows.length;
    body = (
      <ListsTab
        rows={listRows}
        detailId={openList?.id}
        createForm={<ListForm mode="create" />}
        detailForm={
          openList ? (
            <ListForm
              mode="edit"
              listId={openList.id}
              defaultValues={{
                name: openList.name,
                description: openList.description ?? "",
                active: openList.active,
              }}
            />
          ) : undefined
        }
      />
    );
  }

  /* ------------------------------------------------------------- panneaux */
  const closeQuery = new URLSearchParams({ tab, page: String(page) }).toString();

  // Les deux panneaux ne sont chargés que pour leur onglet : un identifiant
  // d'abonné n'ouvre rien depuis l'onglet Campagnes, et inversement.
  const subscriberRow =
    tab === "subscribers" && params.abonne
      ? await prisma.newsletterSubscriber.findUnique({
          where: { id: params.abonne },
          select: {
            id: true,
            email: true,
            name: true,
            status: true,
            source: true,
            confirmationToken: true,
            confirmedAt: true,
            unsubscribedAt: true,
            createdAt: true,
            updatedAt: true,
            user: { select: { id: true, name: true, email: true } },
            lists: {
              select: { id: true, name: true, slug: true, active: true },
              orderBy: { name: "asc" },
            },
            sends: {
              orderBy: { createdAt: "desc" },
              take: 10,
              select: {
                id: true,
                status: true,
                sentAt: true,
                campaign: { select: { subject: true } },
              },
            },
          },
        })
      : null;

  const subscriberDetail: SubscriberDetailData | null =
    subscriberRow && isSubscriberStatus(subscriberRow.status)
      ? {
          ...subscriberRow,
          sends: subscriberRow.sends
            .filter((send) => isSendStatus(send.status))
            .map((send) => ({
              id: send.id,
              status: send.status,
              sentAt: send.sentAt,
              campaignSubject: send.campaign.subject,
            })),
        }
      : null;

  const campaignRow =
    tab === "campaigns" && params.campagne
      ? await prisma.newsletterCampaign.findUnique({
          where: { id: params.campagne },
          select: {
            id: true,
            subject: true,
            previewText: true,
            contentHtml: true,
            contentText: true,
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
            list: { select: { id: true, name: true, slug: true, active: true } },
            createdBy: { select: { id: true, name: true, email: true } },
            sends: {
              orderBy: { createdAt: "desc" },
              take: 10,
              select: {
                id: true,
                status: true,
                sentAt: true,
                errorMessage: true,
                subscriber: { select: { email: true } },
              },
            },
            _count: { select: { sends: true } },
          },
        })
      : null;

  const campaignDetail: CampaignDetailData | null =
    campaignRow && isCampaignStatus(campaignRow.status)
      ? {
          ...campaignRow,
          sendCount: campaignRow._count.sends,
          sends: campaignRow.sends
            .filter((send) => isSendStatus(send.status))
            .map((send) => ({
              id: send.id,
              status: send.status,
              sentAt: send.sentAt,
              errorMessage: send.errorMessage,
              subscriber: send.subscriber,
            })),
        }
      : null;

  /* --------------------------------------------- compte rendu d'envoi (WP11b) */
  // La Server Action redirige avec `?envoi=<envoyés>-<échecs>` : la page étant un
  // composant serveur, c'est le seul moyen simple de lui transmettre un résultat.
  const envoiParam = params.envoi ?? null;
  const envoiCounts =
    envoiParam && envoiParam !== "erreur"
      ? { sent: Number(envoiParam.split("-")[0] ?? 0), failed: Number(envoiParam.split("-")[1] ?? 0) }
      : null;
  const envoiError = envoiParam === "erreur" || Boolean(envoiCounts && envoiCounts.failed > 0);
  const envoiMessage = envoiParam
    ? envoiParam === "erreur"
      ? "L'envoi s'est interrompu avant de commencer : consultez les journaux du serveur."
      : `${envoiCounts?.sent ?? 0} e-mail(s) expédié(s)${
          envoiCounts && envoiCounts.failed > 0
            ? `, ${envoiCounts.failed} échec(s) — le détail figure dans les envois ci-dessous`
            : ""
        }.`
    : null;
  const canSend =
    campaignDetail?.status === "DRAFT" || campaignDetail?.status === "SCHEDULED";

  /* ------------------------------------------- comptes rendus des listes (WP11f) */
  const LIST_MESSAGES: Record<string, { tone: "success" | "danger"; text: string }> = {
    "liste-creee": { tone: "success", text: "Liste de diffusion créée." },
    "liste-maj": { tone: "success", text: "Liste mise à jour." },
    "liste-activee": { tone: "success", text: "Liste activée : elle peut de nouveau recevoir des campagnes." },
    "liste-desactivee": {
      tone: "success",
      text: "Liste désactivée : elle ne peut plus être rejointe et ne reçoit plus de campagne.",
    },
    "liste-supprimee": { tone: "success", text: "Liste supprimée." },
    "liste-utilisee": {
      tone: "danger",
      text: "Cette liste est rattachée à au moins une campagne : la supprimer effacerait ces campagnes et leur historique. Désactivez-la plutôt.",
    },
    introuvable: { tone: "danger", text: "Cette liste n'existe plus." },
  };
  const listNotice = params.message ? LIST_MESSAGES[params.message] : undefined;

  return (
    <div className="px-8 py-10">
      <h1 className="text-3xl font-bold tracking-tight text-primary-900">Newsletter</h1>
      <p className="mt-2 text-sm text-neutral-600">
        {subscriberCount} abonné{subscriberCount > 1 ? "s" : ""} · {listCount} liste
        {listCount > 1 ? "s" : ""} de diffusion · {campaignCount} campagne
        {campaignCount > 1 ? "s" : ""}. Les listes et les abonnés se gèrent ici ; la rédaction et
        l&apos;envoi des campagnes ont leur propre espace.
      </p>

      {/* Statistiques demandées par le brief. */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Abonnés confirmés"
          value={String(confirmedCount)}
          hint={`${subscriberCount} inscription${subscriberCount > 1 ? "s" : ""} au total`}
        />
        <Stat
          label="Taux de désabonnement"
          value={unsubscribeRate(subscriberCount, unsubscribedCount)}
          hint={`${unsubscribedCount} désabonné${unsubscribedCount > 1 ? "s" : ""} · ${bouncedCount} adresse${bouncedCount > 1 ? "s" : ""} invalide${bouncedCount > 1 ? "s" : ""}`}
        />
        <Stat
          label="Campagnes envoyées ce mois"
          value={String(sentThisMonth)}
          hint={`${campaignCount} campagne${campaignCount > 1 ? "s" : ""} enregistrée${campaignCount > 1 ? "s" : ""}`}
        />
        <Stat
          label="Listes actives"
          value={String(listCount)}
          hint="listes de diffusion thématiques"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-600">
          Créer, prévisualiser et envoyer une campagne se fait dans l&apos;espace dédié (WP11d).
        </p>
        <Link
          href="/backoffice/newsletter/campaigns"
          className="rounded-lg bg-primary-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800"
        >
          Gérer les campagnes
        </Link>
      </div>

      {/* Onglets : simples liens, sans JavaScript. */}
      <nav aria-label="Onglets de la newsletter" className="mt-6 flex gap-2 border-b border-neutral-200">
        {TABS.map((item) => {
          const active = item.key === tab;
          const count =
            item.key === "subscribers"
              ? subscriberCount
              : item.key === "lists"
                ? listCount
                : campaignCount;
          return (
            <Link
              key={item.key}
              href={`${BASE_PATH}?tab=${item.key}`}
              aria-current={active ? "page" : undefined}
              className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
                active
                  ? "border-primary-900 text-primary-900"
                  : "border-transparent text-neutral-600 hover:border-neutral-300 hover:text-neutral-900"
              }`}
            >
              <Users aria-hidden="true" className="h-4 w-4" />
              {item.label}
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-600">
                {count}
              </span>
            </Link>
          );
        })}
      </nav>

      {listNotice ? (
        <p
          role={listNotice.tone === "success" ? "status" : "alert"}
          className={`mt-6 rounded-lg border px-4 py-3 text-sm font-medium ${
            listNotice.tone === "success"
              ? "border-success-200 bg-success-50 text-success-800"
              : "border-danger-200 bg-danger-50 text-danger-700"
          }`}
        >
          {listNotice.text}
        </p>
      ) : null}

      {body}

      {subscriberDetail ? (
        <SubscriberDetail
          subscriber={subscriberDetail}
          closeHref={`${BASE_PATH}?${closeQuery}`}
        />
      ) : null}

      {campaignDetail ? (
        <>
          <CampaignDetail campaign={campaignDetail} closeHref={`${BASE_PATH}?${closeQuery}`} />

          {/* Envoi de la campagne (WP11b). Le formulaire de rédaction arrivera
              avec le WP11d ; ici on n'expédie que ce qui existe déjà en base. */}
          <div className="mt-4">
            {envoiMessage ? (
              <p
                role="status"
                className={`mb-3 rounded-lg border px-4 py-3 text-sm font-medium ${
                  envoiError
                    ? "border-danger-200 bg-danger-50 text-danger-700"
                    : "border-success-200 bg-success-50 text-success-800"
                }`}
              >
                {envoiMessage}
              </p>
            ) : null}

            {canSend ? (
              <form action={sendCampaignAction.bind(null, campaignDetail.id)}>
                <Button type="submit">Envoyer la campagne</Button>
                <p className="mt-2 text-xs text-neutral-500">
                  Envoi immédiat aux abonnés confirmés de la liste, un message par destinataire
                  (100 ms d&apos;intervalle). Le compte rendu s&apos;affiche ici.
                </p>
              </form>
            ) : (
              <p className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
                {campaignDetail.status === "SENT"
                  ? "Campagne déjà envoyée : elle ne peut pas être réexpédiée (dupliquez-la pour un nouvel envoi)."
                  : `Une campagne « ${campaignDetail.status} » ne peut pas être expédiée.`}
              </p>
            )}
          </div>
        </>
      ) : null}

      <p className="mt-8 text-xs text-neutral-500">
        Périmètre : couche de données et consultation (WP11a), envoi via Resend et suivi des
        interactions (WP11b). La création de campagne (WP11d) et l&apos;inscription publique
        (WP11c) viendront ensuite. Les listes se composent dans Prisma Studio, via la relation{" "}
        <code className="font-mono">NewsletterSubscriber.lists</code>.
      </p>
    </div>
  );
}
