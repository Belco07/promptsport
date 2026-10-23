import Link from "next/link";

import type { ArticleFormat } from "@/components/FormatBadge";

/**
 * Filtre par format d'article (WP16c) — « pills » de navigation.
 *
 * Composant serveur : chaque pill est un lien qui conserve le chemin de base et
 * réinitialise la pagination (changer de filtre ramène à la page 1). Le filtre
 * actif est signalé par `aria-current`, ce qui le rend lisible aux lecteurs
 * d'écran et stylable sans JavaScript.
 */

const FORMATS: Array<{ value: ArticleFormat; label: string }> = [
  { value: "FLASH", label: "Flash" },
  { value: "NEWS", label: "Actu" },
  { value: "ANALYSIS", label: "Analyse" },
];

export function FormatFilter({
  basePath,
  activeFormat,
}: {
  /** Chemin de la page de thème, ex. `/theme/mercato`. */
  basePath: string;
  /** Format sélectionné, `undefined` pour « Tous ». */
  activeFormat?: ArticleFormat;
}) {
  // Filtre actif : fond et texte tirés des jetons sémantiques, contraste
  // garanti dans les deux thèmes (l'accent éditorial est jaune-lime en sombre).
  const pillClass = (active: boolean) =>
    `inline-flex h-8 items-center !rounded-full border px-3 text-[13px] font-semibold transition-colors ${
      active
        ? "border-foreground bg-foreground text-background"
        : "border-border bg-card text-muted-foreground hover:text-foreground"
    }`;

  return (
    <nav aria-label="Filtrer par format" className="mb-6 flex flex-wrap items-center gap-2">
      <Link
        href={basePath}
        aria-current={activeFormat ? undefined : "page"}
        className={pillClass(!activeFormat)}
      >
        Tous
      </Link>
      {FORMATS.map((format) => (
        <Link
          key={format.value}
          href={`${basePath}?format=${format.value}`}
          aria-current={activeFormat === format.value ? "page" : undefined}
          className={pillClass(activeFormat === format.value)}
          data-format={format.value}
        >
          {format.label}
        </Link>
      ))}
    </nav>
  );
}

export default FormatFilter;
