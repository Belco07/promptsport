import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { Eye } from "@/components/icons";

/**
 * Ligne d'auteur d'un article, disposée comme la référence « Digital Haven » :
 * petit avatar rond, « Par » + nom, date de publication et durée de lecture à
 * gauche ; actions de partage (passées en `children`) à droite.
 *
 * La date de mise à jour n'apparaît que si l'article a réellement été modifié
 * après sa publication (plus de 5 minutes d'écart : l'enregistrement qui
 * accompagne la publication elle-même ne compte pas).
 *
 * `uniqueReaders` n'est fourni que pour la rédaction (journaliste, éditeur,
 * admin) : l'œil et le compteur ne sont jamais rendus pour les lecteurs.
 */
const UPDATE_THRESHOLD_MS = 5 * 60_000;

const dateFormat: Intl.DateTimeFormatOptions = { timeZone: "Africa/Lagos", day: "numeric", month: "long", year: "numeric" };
const timeFormat: Intl.DateTimeFormatOptions = { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" };

export function ArticleMeta({
  author,
  date,
  updatedAt,
  minutes,
  uniqueReaders,
  children,
}: {
  author: { name: string; slug: string | null; photoUrl: string | null };
  date: Date | null;
  updatedAt?: Date | null;
  minutes: number;
  /** Lecteurs uniques, réservé à la rédaction (absent pour le public). */
  uniqueReaders?: number;
  children?: ReactNode;
}) {
  const updated = date && updatedAt && updatedAt.getTime() - date.getTime() > UPDATE_THRESHOLD_MS ? updatedAt : null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-[13px] text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {author.photoUrl ? (
          <Image src={author.photoUrl} alt="" width={26} height={26} loading="lazy" className="h-[26px] w-[26px] rounded-full object-cover" />
        ) : (
          <span aria-hidden="true" className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-muted text-xs font-bold text-foreground">
            {author.name.slice(0, 1)}
          </span>
        )}
        <span>
          Par{" "}
          <span className="font-bold text-foreground">
            {author.slug ? <Link href={`/auteur/${author.slug}`} className="hover:underline">{author.name}</Link> : author.name}
          </span>
        </span>
        {date && (
          <>
            <span aria-hidden="true">·</span>
            <time dateTime={date.toISOString()}>Publié le {date.toLocaleDateString("fr-FR", dateFormat)}</time>
          </>
        )}
        {updated && (
          <>
            <span aria-hidden="true">·</span>
            <time dateTime={updated.toISOString()}>
              Mis à jour le {updated.toLocaleDateString("fr-FR", dateFormat)} à {updated.toLocaleTimeString("fr-FR", timeFormat)}
            </time>
          </>
        )}
        <span aria-hidden="true">·</span>
        <span>{minutes} min de lecture</span>
        {uniqueReaders !== undefined && (
          <>
            <span aria-hidden="true">·</span>
            <span
              title="Lecteurs uniques : personnes différentes ayant lu l’article (hors rédaction). Visible uniquement par la rédaction."
              className="inline-flex items-center gap-1.5 font-semibold text-foreground"
            >
              <Eye aria-hidden="true" size={16} />
              {uniqueReaders.toLocaleString("fr-FR")}
              <span className="sr-only">{uniqueReaders > 1 ? "lecteurs uniques" : "lecteur unique"} (visible uniquement par la rédaction)</span>
            </span>
          </>
        )}
      </div>
      {children}
    </div>
  );
}
