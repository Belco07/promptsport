import { Badge, type BadgeTone } from "@/components/ui/Badge";
import {
  COMMENT_STATUS_LABELS,
  REPORT_STATUS_LABELS,
  banStatusLabel,
  isBanned,
  isCommentStatus,
  isReportStatus,
  type CommentStatus,
  type ReportStatus,
} from "@/lib/engagement";

/**
 * Badges de modération (WP10c) : s'appuient sur le composant Badge du design
 * system pour que l'administration et le public partagent les mêmes teintes.
 */

const COMMENT_TONES: Record<CommentStatus, BadgeTone> = {
  PENDING: "neutral",
  APPROVED: "success",
  REJECTED: "accent",
  FLAGGED: "danger",
  DELETED: "neutral",
};

const REPORT_TONES: Record<ReportStatus, BadgeTone> = {
  PENDING: "danger",
  REVIEWED: "accent",
  RESOLVED: "success",
  DISMISSED: "neutral",
};

export function CommentStatusBadge({ status }: { status: string }) {
  const label = isCommentStatus(status) ? COMMENT_STATUS_LABELS[status] : status;
  const tone = isCommentStatus(status) ? COMMENT_TONES[status] : "neutral";
  return (
    <Badge variant="status" tone={tone}>
      {label}
    </Badge>
  );
}

export function ReportStatusBadge({ status }: { status: string }) {
  const label = isReportStatus(status) ? REPORT_STATUS_LABELS[status] : status;
  const tone = isReportStatus(status) ? REPORT_TONES[status] : "neutral";
  return (
    <Badge variant="status" tone={tone}>
      {label}
    </Badge>
  );
}

/** Statut de bannissement : banni (rouge), ban terminé (neutre), sinon vert. */
export function BanStatusBadge({
  author,
  now,
}: {
  author: { bannedUntil: Date | null };
  now: Date;
}) {
  const label = banStatusLabel(author, now);
  const tone: BadgeTone = isBanned(author, now) ? "danger" : label === "Non banni" ? "success" : "neutral";
  return (
    <Badge variant="status" tone={tone}>
      {label}
    </Badge>
  );
}
