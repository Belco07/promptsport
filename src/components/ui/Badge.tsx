import type { ReactNode } from "react";

/**
 * Design system — badge (WP9).
 *
 * Quatre usages éditoriaux : rubrique (`category`), article réservé aux
 * abonnés (`premium`), état d'un match (`status`) et rôle d'un utilisateur
 * (`role`). La teinte est pilotée par `tone`, ce qui permet d'ajouter un usage
 * sans dupliquer de classes.
 *
 * Composant serveur : aucun état, aucune interaction.
 */

export type BadgeVariant = "premium" | "category" | "status" | "role";
export type BadgeTone =
  | "neutral"
  | "primary"
  | "accent"
  | "success"
  | "danger"
  | "live"
  | "premium";

const TONES: Record<BadgeTone, string> = {
  neutral: "border-neutral-200 bg-neutral-100 text-neutral-700",
  primary: "border-primary-200 bg-primary-50 text-primary-800",
  accent: "border-accent-200 bg-accent-50 text-accent-800",
  success: "border-success-200 bg-success-50 text-success-800",
  danger: "border-danger-200 bg-danger-50 text-danger-800",
  /* Direct : rouge, avec la pastille animée propre au « live ». */
  live: "border-danger-200 bg-danger-600 text-white",
  /* Premium : doré, distinct des rubriques (bleues) et des statuts. */
  premium: "border-amber-300 bg-amber-100 text-amber-900",
};

/** Teinte par défaut de chaque variante. */
const DEFAULT_TONE: Record<BadgeVariant, BadgeTone> = {
  premium: "premium",
  category: "primary",
  status: "neutral",
  role: "neutral",
};

export function badgeStyles({
  variant = "category",
  tone,
  className = "",
}: {
  variant?: BadgeVariant;
  tone?: BadgeTone;
  className?: string;
} = {}): string {
  const resolved = tone ?? DEFAULT_TONE[variant];
  return [
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
    variant === "premium" ? "uppercase tracking-wide" : "",
    TONES[resolved],
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

export function Badge({
  variant = "category",
  tone,
  className = "",
  children,
  /** Pastille clignotante (match en direct). */
  pulse = false,
  title,
}: {
  variant?: BadgeVariant;
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
  pulse?: boolean;
  title?: string;
}) {
  return (
    <span
      className={badgeStyles({ variant, tone, className })}
      data-badge-variant={variant}
      title={title}
    >
      {pulse ? (
        <span aria-hidden="true" className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
        </span>
      ) : null}
      {children}
    </span>
  );
}
