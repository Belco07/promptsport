import {
  BellRing,
  CheckCheck,
  Flag,
  Heart,
  MessageSquare,
  ShieldCheck,
  ShieldOff,
  UserCheck,
  UserX,
} from "lucide-react";
import Link from "next/link";

import { markAsRead } from "@/app/mon-compte/notifications/actions";
import { Badge } from "@/components/ui/Badge";

/**
 * Une notification dans la liste de l'espace personnel (WP10d).
 *
 * Composant serveur : l'icône dépend du type, la date est relative, et le bouton
 * « Marquer comme lu » est un formulaire lié à la Server Action — aucun
 * JavaScript nécessaire.
 */

export type NotificationRow = {
  id: string;
  type: string;
  title: string;
  message: string;
  linkUrl: string | null;
  read: boolean;
  readAt: Date | null;
  createdAt: Date;
};

/** Icône et teinte par type de notification. */
const TYPE_STYLES: Record<string, { icon: typeof BellRing; tone: string }> = {
  COMMENT_REPLY: { icon: MessageSquare, tone: "bg-primary-50 text-primary-700" },
  COMMENT_REACTION: { icon: Heart, tone: "bg-accent-50 text-accent-700" },
  COMMENT_APPROVED: { icon: CheckCheck, tone: "bg-success-50 text-success-700" },
  COMMENT_REJECTED: { icon: ShieldOff, tone: "bg-danger-50 text-danger-700" },
  REPORT_RESOLVED: { icon: ShieldCheck, tone: "bg-success-50 text-success-700" },
  REPORT_DISMISSED: { icon: Flag, tone: "bg-neutral-100 text-neutral-600" },
  USER_BANNED: { icon: UserX, tone: "bg-danger-50 text-danger-700" },
  USER_UNBANNED: { icon: UserCheck, tone: "bg-success-50 text-success-700" },
};

/** Date relative courte : « à l'instant », « il y a 5 min », « hier », sinon date. */
export function relativeDate(date: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));

  if (seconds < 60) return "à l'instant";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;

  const days = Math.round(hours / 24);
  if (days === 1) return "hier";
  if (days < 7) return `il y a ${days} jours`;

  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(date);
}

export function NotificationItem({
  notification,
  now = new Date(),
}: {
  notification: NotificationRow;
  now?: Date;
}) {
  const style = TYPE_STYLES[notification.type] ?? {
    icon: BellRing,
    tone: "bg-neutral-100 text-neutral-600",
  };
  const Icon = style.icon;

  const content = (
    <>
      <span
        aria-hidden="true"
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${style.tone}`}
      >
        <Icon className="h-4.5 w-4.5" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-neutral-900">{notification.title}</span>
          {!notification.read ? (
            <span
              aria-label="Non lue"
              title="Non lue"
              className="inline-block h-2 w-2 rounded-full bg-danger-600"
            />
          ) : null}
        </span>
        <span className="mt-0.5 block text-sm leading-6 text-neutral-600">
          {notification.message}
        </span>
        <span className="mt-1 block text-xs text-neutral-500">
          <time dateTime={notification.createdAt.toISOString()}>
            {relativeDate(notification.createdAt, now)}
          </time>
          {notification.read && notification.readAt ? " · lue" : ""}
        </span>
      </span>
    </>
  );

  return (
    <li
      className={`flex items-start gap-3 rounded-xl border p-4 ${
        notification.read ? "border-neutral-200 bg-white" : "border-danger-100 bg-danger-50/40"
      }`}
    >
      {notification.linkUrl ? (
        <Link href={notification.linkUrl} className="flex min-w-0 flex-1 items-start gap-3">
          {content}
        </Link>
      ) : (
        <span className="flex min-w-0 flex-1 items-start gap-3">{content}</span>
      )}

      {!notification.read ? (
        <form action={markAsRead.bind(null, notification.id)} className="shrink-0">
          <button
            type="submit"
            className="text-xs font-medium text-neutral-500 underline transition-colors hover:text-neutral-800"
          >
            Marquer comme lu
          </button>
        </form>
      ) : (
        <Badge variant="status" tone="neutral" className="shrink-0">
          Lue
        </Badge>
      )}
    </li>
  );
}
