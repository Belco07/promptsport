import Link from "next/link";

import { banUser } from "@/app/backoffice/comments/actions";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { BAN_DURATIONS } from "@/lib/engagement";

/**
 * Formulaire modal de bannissement (WP10c).
 *
 * Rendu par le serveur lorsque l'URL contient `bannir=<auteur>` : pas de
 * JavaScript, pas d'état client. « Annuler » est un simple lien qui revient à
 * la liste sans le paramètre.
 */
export function BanModal({
  author,
  closeHref,
}: {
  author: { id: string; name: string; email: string };
  closeHref: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="titre-bannissement"
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
        <h2 id="titre-bannissement" className="text-lg font-bold text-foreground">
          Bannir {author.name}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {author.email} ne pourra plus publier de commentaire pendant la durée choisie.
        </p>

        <form action={banUser.bind(null, author.id)} className="mt-5 flex flex-col gap-4">
          <Select
            name="duration"
            label="Durée"
            defaultValue="7d"
            options={BAN_DURATIONS.map((duration) => ({
              value: duration.value,
              label: duration.label,
            }))}
          />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="champ-ban-reason" className="text-sm font-medium text-foreground">
              Raison
            </label>
            <textarea
              id="champ-ban-reason"
              name="reason"
              rows={3}
              placeholder="Motif communiqué à l'auteur (facultatif)"
              className="resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="flex items-center justify-end gap-3">
            <Link href={closeHref} className="text-sm font-semibold text-foreground underline">
              Annuler
            </Link>
            <Button type="submit" variant="danger">
              Bannir
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
