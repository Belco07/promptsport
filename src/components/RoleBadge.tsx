import {
  USER_ROLE_BADGES,
  USER_ROLE_LABELS,
  type UserRole,
} from "@/lib/roles";

/**
 * Badge de rôle : ADMIN = rouge, EDITOR = bleu, JOURNALIST = gris.
 */
export function RoleBadge({ role }: { role: UserRole }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${USER_ROLE_BADGES[role]}`}
    >
      {USER_ROLE_LABELS[role]}
    </span>
  );
}
