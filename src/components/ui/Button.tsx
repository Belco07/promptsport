import type { ButtonHTMLAttributes } from "react";

/**
 * Design system — bouton (WP9).
 *
 * Le style est exposé sous forme de fonction (`buttonStyles`) pour pouvoir être
 * appliqué à un `<Link>` : un bouton de navigation doit rester un vrai lien
 * (accessible, indexable, ouvrable dans un nouvel onglet), pas un `<button>`
 * déguisé. Aucune dépendance externe, aucune classe côté client.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  /* Bleu profond : action principale, contraste 15,9:1 avec le blanc. */
  primary:
    "bg-primary-900 [.public-site_&]:bg-primary text-white shadow-sm hover:bg-primary-800 [.public-site_&]:hover:bg-primary active:bg-primary-950 [.public-site_&]:active:bg-primary",
  /* Contour : action secondaire, sans concurrencer l'action principale. */
  secondary:
    "border border-neutral-300 [.public-site_&]:border-border bg-white [.public-site_&]:bg-card text-neutral-800 [.public-site_&]:text-foreground hover:border-primary-300 [.public-site_&]:hover:border-border hover:bg-primary-50 [.public-site_&]:hover:bg-muted hover:text-primary-800 [.public-site_&]:hover:text-editorial-link",
  /* Texte seul : actions tertiaires (annuler, revenir). */
  ghost: "text-neutral-700 [.public-site_&]:text-foreground hover:bg-neutral-100 [.public-site_&]:hover:bg-muted hover:text-neutral-900 [.public-site_&]:hover:text-foreground",
  /* Rouge : actions destructrices ou annulation d'abonnement. */
  danger: "bg-danger-600 [.public-site_&]:bg-destructive text-white shadow-sm hover:bg-danger-700 [.public-site_&]:hover:bg-destructive active:bg-danger-800 [.public-site_&]:active:bg-destructive",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "gap-1.5 px-3 py-1.5 text-sm",
  md: "gap-2 px-4 py-2 text-sm",
  lg: "gap-2 px-5 py-3 text-base",
};

/** Classes communes : base + variante + taille. */
export function buttonStyles({
  variant = "primary",
  size = "md",
  block = false,
  className = "",
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Occupe toute la largeur disponible (formulaires sur mobile). */
  block?: boolean;
  className?: string;
} = {}): string {
  return [
    "app-button inline-flex items-center justify-center rounded-md font-semibold transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-2",
    "disabled:cursor-not-allowed disabled:opacity-55",
    VARIANTS[variant],
    SIZES[size],
    block ? "w-full" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  block = false,
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonStyles({ variant, size, block, className })}
      {...props}
    />
  );
}
