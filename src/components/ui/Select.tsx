import type { ReactNode, SelectHTMLAttributes } from "react";

import { Field, describedBy, fieldStyles } from "@/components/ui/Input";

/** Design system — liste déroulante (WP9). Voir Input.tsx pour `Field`. */
export type SelectOption = { value: string; label: string };

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  id?: string;
  options: SelectOption[];
  /** Libellé de l'entrée vide (facultatif). */
  placeholder?: string;
};

export function Select({
  label,
  hint,
  error,
  id,
  name,
  options,
  placeholder,
  className = "",
  ...props
}: SelectProps) {
  const fieldId = id ?? (name ? `champ-${name}` : undefined);
  const select = (
    <select
      id={fieldId}
      name={name}
      aria-invalid={error ? true : undefined}
      aria-describedby={fieldId ? describedBy(fieldId, { hint, error }) : undefined}
      className={fieldStyles({ invalid: Boolean(error), className: `pr-8 ${className}` })}
      {...props}
    >
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );

  if (!label || !fieldId) {
    return select;
  }

  return (
    <Field id={fieldId} label={label} hint={hint} error={error}>
      {select}
    </Field>
  );
}
