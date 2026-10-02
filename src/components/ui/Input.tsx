import type { InputHTMLAttributes, ReactNode } from "react";

/**
 * Design system — champs de formulaire (WP9).
 *
 * `Field` porte l'étiquette, l'aide et le message d'erreur, et câble les
 * relations d'accessibilité (`htmlFor`, `aria-describedby`, `aria-invalid`) une
 * seule fois pour les trois champs. Les composants restent sans état : ils
 * fonctionnent aussi bien dans un formulaire à Server Action que dans un
 * composant client.
 */

/** Classes communes aux input / textarea / select. */
export function fieldStyles({
  invalid = false,
  className = "",
}: { invalid?: boolean; className?: string } = {}): string {
  return [
    "block w-full rounded-lg border bg-white px-3 py-2 text-sm text-neutral-900",
    "placeholder:text-neutral-400",
    "disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500",
    invalid
      ? "border-danger-400 focus:border-danger-500"
      : "border-neutral-300 focus:border-primary-500",
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

export function Field({
  id,
  label,
  hint,
  error,
  children,
  className = "",
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium text-neutral-800">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-aide`} className="text-xs text-neutral-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-erreur`} className="text-xs font-medium text-danger-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Identifiants des éléments qui décrivent le champ (aide ou erreur). */
export function describedBy(id: string, { hint, error }: { hint?: ReactNode; error?: ReactNode }) {
  if (error) return `${id}-erreur`;
  if (hint) return `${id}-aide`;
  return undefined;
}

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Identifiant du champ ; déduit du `name` s'il n'est pas fourni. */
  id?: string;
};

export function Input({ label, hint, error, id, name, className = "", ...props }: InputProps) {
  const fieldId = id ?? (name ? `champ-${name}` : undefined);
  const input = (
    <input
      id={fieldId}
      name={name}
      aria-invalid={error ? true : undefined}
      aria-describedby={fieldId ? describedBy(fieldId, { hint, error }) : undefined}
      className={fieldStyles({ invalid: Boolean(error), className })}
      {...props}
    />
  );

  if (!label || !fieldId) {
    return input;
  }

  return (
    <Field id={fieldId} label={label} hint={hint} error={error}>
      {input}
    </Field>
  );
}
