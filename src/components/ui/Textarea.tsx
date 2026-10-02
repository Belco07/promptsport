import type { TextareaHTMLAttributes, ReactNode } from "react";

import { Field, describedBy, fieldStyles } from "@/components/ui/Input";

/** Design system — zone de texte multiligne (WP9). Voir Input.tsx pour `Field`. */
export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  id?: string;
};

export function Textarea({
  label,
  hint,
  error,
  id,
  name,
  rows = 5,
  className = "",
  ...props
}: TextareaProps) {
  const fieldId = id ?? (name ? `champ-${name}` : undefined);
  const textarea = (
    <textarea
      id={fieldId}
      name={name}
      rows={rows}
      aria-invalid={error ? true : undefined}
      aria-describedby={fieldId ? describedBy(fieldId, { hint, error }) : undefined}
      className={fieldStyles({ invalid: Boolean(error), className: `resize-y ${className}` })}
      {...props}
    />
  );

  if (!label || !fieldId) {
    return textarea;
  }

  return (
    <Field id={fieldId} label={label} hint={hint} error={error}>
      {textarea}
    </Field>
  );
}
