import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { markAllAsRead } from "@/app/mon-compte/notifications/actions";
import { Footer } from "@/components/Footer";
import { NotificationItem, type NotificationRow } from "@/components/NotificationItem";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Espace notifications (WP10d).
 *
 * Liste paginée (20 par page) avec un filtre « Toutes » / « Non lues ». Les
 * actions sont des formulaires liés à des Server Actions : marquer une
 * notification comme lue, ou tout marquer d'un coup.
 */

export const metadata: Metadata = {
  title: "Notifications",
  description: "Vos notifications : réponses, réactions et décisions de modération.",
};

export const dynamic = "force-dynamic";

/** Pagination demandée par le brief. */
const PAGE_SIZE = 20;

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filtre?: string; page?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const params = await searchParams;
  const unreadOnly = params.filtre === "non-lues";
  const parsedPage = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const where = { userId: session.user.id, ...(unreadOnly ? { read: false } : {}) };

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        type: true,
        title: true,
        message: true,
        linkUrl: true,
        read: true,
        readAt: true,
        createdAt: true,
      },
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: session.user.id, read: false } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const now = new Date();

  const pageHref = (target: number) =>
    `/mon-compte/notifications?${new URLSearchParams({
      ...(unreadOnly ? { filtre: "non-lues" } : {}),
      page: String(target),
    }).toString()}`;

  return (
    <>
      <main id="contenu" className="mx-auto w-full max-w-4xl px-4 py-10">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
              Notifications
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {total} notification{total > 1 ? "s" : ""}
              {unreadOnly ? " non lue" + (total > 1 ? "s" : "") : ""} · {unreadCount} non lue
              {unreadCount > 1 ? "s" : ""} au total.
            </p>
          </div>

          {unreadCount > 0 ? (
            <form action={markAllAsRead}>
              <Button type="submit" variant="secondary" size="sm">
                Tout marquer comme lu
              </Button>
            </form>
          ) : null}
        </header>

        <nav aria-label="Filtres des notifications" className="mb-5 flex flex-wrap items-center gap-2">
          <Link
            href="/mon-compte/notifications"
            aria-current={unreadOnly ? undefined : "page"}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
              unreadOnly
                ? "border-border bg-card text-muted-foreground hover:border-border"
                : "border-editorial-link bg-secondary text-editorial-link"
            }`}
          >
            Toutes
          </Link>
          <Link
            href="/mon-compte/notifications?filtre=non-lues"
            aria-current={unreadOnly ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
              unreadOnly
                ? "border-editorial-link bg-secondary text-editorial-link"
                : "border-border bg-card text-muted-foreground hover:border-border"
            }`}
          >
            Non lues{unreadCount > 0 ? ` (${unreadCount})` : ""}
          </Link>
        </nav>

        {notifications.length === 0 ? (
          <Card>
            <CardBody className="text-center text-sm text-muted-foreground">
              Aucune notification pour le moment.
            </CardBody>
          </Card>
        ) : (
          <ul className="space-y-3">
            {notifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification as NotificationRow}
                now={now}
              />
            ))}
          </ul>
        )}

        {totalPages > 1 ? (
          <nav aria-label="Pagination des notifications" className="mt-6 flex items-center justify-between text-sm">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="font-semibold text-editorial-link underline">
                ← Page précédente
              </Link>
            ) : (
              <span className="text-muted-foreground">← Page précédente</span>
            )}
            <span className="text-muted-foreground">
              Page {page} sur {totalPages}
            </span>
            {page < totalPages ? (
              <Link href={pageHref(page + 1)} className="font-semibold text-editorial-link underline">
                Page suivante →
              </Link>
            ) : (
              <span className="text-muted-foreground">Page suivante →</span>
            )}
          </nav>
        ) : null}

        <p className="mt-8 text-sm">
          <Link href="/mon-compte" className="font-semibold text-editorial-link underline">
            Retour à mon compte
          </Link>
        </p>
      </main>

      <Footer />
    </>
  );
}
