import type { Prisma } from "@/generated/prisma/client";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BanModal } from "@/app/backoffice/comments/components/BanModal";
import { CommentsTab, type CommentRow } from "@/app/backoffice/comments/components/CommentsTab";
import { ReportsTab, type ReportRow } from "@/app/backoffice/comments/components/ReportsTab";
import { UsersTab, type UserRow } from "@/app/backoffice/comments/components/UsersTab";
import { auth } from "@/lib/auth";
import {
  COMMENT_STATUSES,
  REPORT_STATUSES,
  isCommentStatus,
  isReportStatus,
} from "@/lib/engagement";
import { prisma } from "@/lib/prisma";
import { moderateMatchComment } from "./actions";

/**
 * Modération des commentaires (WP10c).
 *
 * Trois onglets dans une seule page : commentaires (filtres, sélection
 * multiple, pagination), signalements et utilisateurs (bannissement).
 * L'ensemble fonctionne sans JavaScript côté client : filtres en GET,
 * sélection rattachée au formulaire d'actions groupées par l'attribut HTML
 * `form`, et bannissement dans un formulaire modal rendu par le serveur.
 *
 * Aucun journal d'audit n'est tenu (hors périmètre) : la page indique qui a
 * traité un signalement, c'est tout.
 */

const BASE_PATH = "/backoffice/comments";
/** Pagination demandée par le brief. */
const PAGE_SIZE = 50;

const TABS = [
  { key: "comments", label: "Commentaires" },
  { key: "reports", label: "Signalements" },
  { key: "users", label: "Utilisateurs" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/** Normalise l'onglet demandé (accepte aussi l'ancien paramètre `onglet`). */
function resolveTab(params: { tab?: string; onglet?: string }): TabKey {
  const requested =
    params.tab ??
    (params.onglet === "signalements" ? "reports" : params.onglet === "commentaires" ? "comments" : undefined);
  return TABS.some((tab) => tab.key === requested) ? (requested as TabKey) : "comments";
}

function parsePage(value: string | undefined): number {
  const page = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

export default async function BackofficeCommentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    onglet?: string;
    page?: string;
    status?: string;
    article?: string;
    author?: string;
    bannir?: string;
    type?: string;
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
  const tab = resolveTab(params);
  const page = parsePage(params.page);
  const skip = (page - 1) * PAGE_SIZE;
  const now = new Date();
  const startOfDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  /* ------------------------------------------------------------ statistiques */
  const [pendingComments, openReports, activeBans, commentsToday, commentCount, reportCount, authorCount, pendingMatch, matchToday, matchCount] =
    await Promise.all([
      prisma.comment.count({ where: { status: "PENDING" } }),
      prisma.report.count({ where: { status: "PENDING" } }),
      prisma.author.count({ where: { bannedUntil: { gt: now } } }),
      prisma.comment.count({ where: { createdAt: { gte: startOfDay } } }),
      prisma.comment.count(),
      prisma.report.count(),
      prisma.author.count({ where: { OR: [{ comments: { some: {} } }, { readerMatchComments: { some: {} } }, { authoredMatchComments: { some: {} } }] } }),
      prisma.matchComment.count({ where: { status: "PENDING" } }),
      prisma.matchComment.count({ where: { createdAt: { gte: startOfDay } } }),
      prisma.matchComment.count(),
    ]);

  const stats = [
    { label: "Commentaires en attente", value: pendingComments + pendingMatch },
    { label: "Signalements ouverts", value: openReports },
    { label: "Utilisateurs bannis", value: activeBans },
    { label: "Commentaires aujourd'hui", value: commentsToday + matchToday },
  ];

  /* -------------------------------------------------------- onglet actif */
  const query: Record<string, string> = {};
  if (params.status) query.status = params.status;
  if (params.article) query.article = params.article;
  if (params.author) query.author = params.author;
  if (params.type === "matches") query.type = "matches";

  let body: React.ReactNode = null;

  if (tab === "comments" && params.type === "matches") {
    const status = params.status === "PENDING" || params.status === "APPROVED" || params.status === "REJECTED" || params.status === "DELETED" ? params.status : undefined;
    const where: Prisma.MatchCommentWhereInput = { status, ...(params.author ? { OR: [{ reader: { name: { contains: params.author, mode: "insensitive" } } }, { author: { name: { contains: params.author, mode: "insensitive" } } }] } : {}) };
    const [rows, total] = await Promise.all([
      prisma.matchComment.findMany({ where, take: PAGE_SIZE, skip, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { reader: { select: { name: true } }, author: { select: { name: true } }, match: { select: { homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } } } } }),
      prisma.matchComment.count({ where }),
    ]);
    const href = (target: number) => `${BASE_PATH}?${new URLSearchParams({ ...query, tab: "comments", type: "matches", page: String(target) })}`;
    body = <div className="mt-6 space-y-4">
      <form className="flex flex-wrap items-end gap-3" method="get"><input type="hidden" name="type" value="matches" /><input type="hidden" name="tab" value="comments" />
        <label className="text-sm text-foreground">Statut<select name="status" defaultValue={status ?? ""} className="ml-2 min-h-11 rounded border border-border bg-card p-2"><option value="">Tous</option>{["PENDING", "APPROVED", "REJECTED", "DELETED"].map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="text-sm text-foreground">Auteur<input name="author" defaultValue={params.author ?? ""} className="ml-2 min-h-11 rounded border border-border bg-card p-2" /></label><button className="min-h-11 rounded border border-border px-4">Filtrer</button>
      </form>
      <p className="text-sm text-muted-foreground">{total} commentaire(s) de match</p>
      {rows.map(row => <article key={row.id} className="rounded-xl border border-border bg-card p-4">
        <Link href={`/match/${row.matchId}?tab=discussion&phase=${row.phase}#match-comment-${row.id}`} className="font-bold text-editorial-link">{row.match.homeTeam.name} — {row.match.awayTeam.name}</Link>
        <p className="mt-2 text-sm text-muted-foreground">{row.reader?.name ?? row.author?.name ?? "Compte supprimé"} · {row.phase} · {row.status} · {row.createdAt.toLocaleString("fr-FR", { timeZone: "Africa/Lagos" })}</p>
        <p className="my-3 whitespace-pre-wrap break-words text-foreground">{row.content}</p>
        {row.status !== "DELETED" && <form action={moderateMatchComment.bind(null, row.id)} className="flex flex-wrap gap-3">{[{ value: "approve", label: "Approuver" }, { value: "reject", label: "Rejeter" }, { value: "delete", label: "Supprimer" }].map(action => <button key={action.value} name="intent" value={action.value} className="min-h-11 rounded border border-border px-3 text-sm text-foreground">{action.label}</button>)}</form>}
      </article>)}
      {!rows.length && <p className="text-muted-foreground">Aucun commentaire de match.</p>}
      <nav aria-label="Pagination des commentaires de match" className="flex gap-5">{page > 1 && <Link href={href(page - 1)}>Précédent</Link>}{skip + PAGE_SIZE < total && <Link href={href(page + 1)}>Suivant</Link>}</nav>
    </div>;
  } else if (tab === "comments") {
    const where: Prisma.CommentWhereInput = {};
    if (params.status && isCommentStatus(params.status)) {
      where.status = params.status;
    }
    if (params.article) {
      where.article = { slug: params.article };
    }
    if (params.author) {
      where.author = {
        OR: [{ name: { contains: params.author } }, { email: { contains: params.author } }],
      };
    }

    const [rows, total, articles] = await Promise.all([
      prisma.comment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: PAGE_SIZE,
        select: {
          id: true,
          content: true,
          status: true,
          createdAt: true,
          editedAt: true,
          author: { select: { id: true, name: true, email: true } },
          article: { select: { title: true, slug: true } },
          // Signalements détaillés : qui a signalé, pour quel motif, et où en
          // est le traitement — sans avoir à ouvrir l'onglet Signalements.
          reports: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              reason: true,
              details: true,
              status: true,
              createdAt: true,
              reporter: { select: { name: true, email: true } },
            },
          },
        },
      }),
      prisma.comment.count({ where }),
      prisma.article.findMany({
        where: { comments: { some: {} } },
        orderBy: { title: "asc" },
        select: { slug: true, title: true },
      }),
    ]);

    const commentRows: CommentRow[] = rows.map((row) => ({
      id: row.id,
      content: row.content,
      status: row.status,
      createdAt: row.createdAt,
      editedAt: row.editedAt,
      author: row.author,
      article: row.article,
      reports: row.reports,
    }));

    body = (
      <CommentsTab
        rows={commentRows}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        filters={{
          status: params.status ?? "",
          article: params.article ?? "",
          author: params.author ?? "",
        }}
        articles={articles}
        basePath={BASE_PATH}
        query={query}
      />
    );
  } else if (tab === "reports") {
    const where: Prisma.ReportWhereInput = {};
    if (params.status && isReportStatus(params.status)) {
      where.status = params.status;
    }

    const [rows, total] = await Promise.all([
      prisma.report.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: PAGE_SIZE,
        select: {
          id: true,
          reason: true,
          details: true,
          status: true,
          createdAt: true,
          resolvedAt: true,
          reporter: { select: { name: true, email: true } },
          resolvedBy: { select: { name: true } },
          comment: {
            select: {
              id: true,
              content: true,
              status: true,
              author: { select: { id: true, name: true } },
              article: { select: { title: true, slug: true } },
            },
          },
        },
      }),
      prisma.report.count({ where }),
    ]);

    body = (
      <ReportsTab
        rows={rows as ReportRow[]}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        status={params.status ?? ""}
        basePath={BASE_PATH}
        query={query}
      />
    );
  } else {
    const where: Prisma.AuthorWhereInput = { OR: [{ comments: { some: {} } }, { readerMatchComments: { some: {} } }, { authoredMatchComments: { some: {} } }] };

    const [authors, total, rejectedGroups, flaggedGroups] = await Promise.all([
      prisma.author.findMany({
        where,
        orderBy: { name: "asc" },
        skip,
        take: PAGE_SIZE,
        select: {
          id: true,
          name: true,
          email: true,
          bannedUntil: true,
          banReason: true,
          _count: { select: { comments: true, readerMatchComments: true, authoredMatchComments: true } },
        },
      }),
      prisma.author.count({ where }),
      prisma.comment.groupBy({
        by: ["authorId"],
        where: { status: "REJECTED" },
        _count: { _all: true },
      }),
      prisma.comment.groupBy({
        by: ["authorId"],
        where: { reports: { some: {} } },
        _count: { _all: true },
      }),
    ]);

    const rejectedByAuthor = new Map(rejectedGroups.map((group) => [group.authorId, group._count._all]));
    const flaggedByAuthor = new Map(flaggedGroups.map((group) => [group.authorId, group._count._all]));

    const userRows: UserRow[] = authors.map((author) => ({
      id: author.id,
      name: author.name,
      email: author.email,
      bannedUntil: author.bannedUntil,
      banReason: author.banReason,
      comments: author._count.comments + author._count.readerMatchComments + author._count.authoredMatchComments,
      rejected: rejectedByAuthor.get(author.id) ?? 0,
      flagged: flaggedByAuthor.get(author.id) ?? 0,
    }));

    body = (
      <UsersTab
        rows={userRows}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        basePath={BASE_PATH}
        query={query}
        now={now}
      />
    );
  }

  /* ------------------------------------------ formulaire modal de bannissement */
  const banTarget = params.bannir
    ? await prisma.author.findUnique({
        where: { id: params.bannir },
        select: { id: true, name: true, email: true },
      })
    : null;

  const closeParams = new URLSearchParams({ ...query, tab: "users", page: String(page) });

  return (
    <div className="px-8 py-10">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Modération des commentaires</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {commentCount + matchCount} commentaire{commentCount + matchCount > 1 ? "s" : ""} · {reportCount} signalement
        {reportCount > 1 ? "s" : ""} · {authorCount} auteur{authorCount > 1 ? "s" : ""} ayant commenté.
      </p>

      {/* Statistiques de modération. */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{stat.label}</p>
            <p className="mt-1 text-2xl font-bold text-foreground">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Onglets : liens, sans JavaScript. */}
      <nav aria-label="Onglets de modération" className="mt-8 flex gap-2 border-b border-border">
        {TABS.map((item) => {
          const active = item.key === tab;
          const count =
            item.key === "comments" ? commentCount + matchCount : item.key === "reports" ? reportCount : authorCount;
          return (
            <Link
              key={item.key}
              href={`${BASE_PATH}?tab=${item.key}`}
              aria-current={active ? "page" : undefined}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                active
                  ? "border-accent text-editorial-link"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
              }`}
            >
              {item.label}
              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {count}
              </span>
            </Link>
          );
        })}
      </nav>

      {tab === "comments" && <form method="get" className="mt-5 flex items-center gap-3"><input type="hidden" name="tab" value="comments" /><label htmlFor="comment-type" className="font-semibold text-foreground">Type</label><select id="comment-type" name="type" defaultValue={params.type === "matches" ? "matches" : "articles"} className="min-h-11 rounded border border-border bg-card p-2 text-foreground"><option value="articles">Articles</option><option value="matches">Matchs</option></select><button className="min-h-11 rounded border border-border px-4 text-foreground">Afficher</button></form>}
      {body}

      {banTarget ? (
        <BanModal author={banTarget} closeHref={`${BASE_PATH}?${closeParams.toString()}`} />
      ) : null}

      <p className="mt-8 text-xs text-muted-foreground">
        Statuts disponibles : {COMMENT_STATUSES.length} pour un commentaire (dont{" "}
        {COMMENT_STATUSES.filter((status) => status === "DELETED").length} suppression douce) et{" "}
        {REPORT_STATUSES.length} pour un signalement. Aucun journal d&apos;audit n&apos;est conservé
        dans ce lot ; aucune notification n&apos;est envoyée aux auteurs (WP10d).
      </p>
    </div>
  );
}
