"use client";

import { useFormStatus } from "react-dom";

type ActionButtonProps = {
  label: string;
  pendingLabel?: string;
  disabled?: boolean;
  title?: string;
  variant?: "primary" | "secondary";
};

/** Bouton de formulaire avec état « en cours » (Server Actions). */
export function ActionButton({
  label,
  pendingLabel,
  disabled = false,
  title,
  variant = "primary",
}: ActionButtonProps) {
  const { pending } = useFormStatus();

  const className =
    variant === "primary"
      ? "rounded-md bg-primary px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      : "rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      title={title}
      className={className}
    >
      {pending ? (pendingLabel ?? "Traitement…") : label}
    </button>
  );
}
