import { absoluteUrl } from "@/lib/seo";

/**
 * Boutons de partage d'un article (WP13f) : X, Facebook, LinkedIn, WhatsApp et
 * e-mail.
 *
 * Composant **serveur** : les liens sont calculés à partir de l'URL canonique
 * (`NEXT_PUBLIC_SITE_URL` + slug), donc présents et corrects dès le HTML servi —
 * pas d'attente d'hydratation comme avec `window.location`, et l'URL partagée est
 * exactement celle déclarée en canonique. Aucun JavaScript n'est nécessaire.
 *
 * Deux dispositions, une seule source : `rail` (colonne verticale sur le bord
 * gauche de l'article) et `inline` (rangée horizontale, avant les réactions en
 * fin d'article). Les icônes sont des marques dessinées en SVG (24 × 24, couleur
 * du texte) plutôt que des icônes génériques : les logos de réseaux ne font pas
 * partie de lucide, et un pictogramme approximatif serait trompeur.
 */

type Network = "x" | "facebook" | "linkedin" | "whatsapp" | "email";

/** Marques officielles, simplifiées, en 24 × 24 et `currentColor`. */
const PATHS: Record<Network, string> = {
  x: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z",
  facebook:
    "M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z",
  linkedin:
    "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z",
  whatsapp:
    "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.347-.347.52-.52.174-.174.232-.298.347-.497.115-.198.058-.372-.03-.52-.086-.148-.66-1.59-.905-2.178-.24-.578-.48-.5-.66-.51-.172-.008-.371-.01-.57-.01-.199 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z",
  email:
    "M4 4.5h16A2.5 2.5 0 0 1 22.5 7v10a2.5 2.5 0 0 1-2.5 2.5H4A2.5 2.5 0 0 1 1.5 17V7A2.5 2.5 0 0 1 4 4.5Zm.5 2L12 12.3l7.5-5.8Z",
};

/**
 * L'enveloppe se dessine en deux sous-chemins : le corps, puis le rabat, évidé
 * par la règle `evenodd`. Sans elle, la forme pleine ressemblerait à une simple
 * carte fermée.
 */
const EVEN_ODD: Partial<Record<Network, boolean>> = { email: true };

const LABELS: Record<Network, string> = {
  x: "Partager sur X",
  facebook: "Partager sur Facebook",
  linkedin: "Partager sur LinkedIn",
  whatsapp: "Partager sur WhatsApp",
  email: "Partager par e-mail",
};

const ORDER: Network[] = ["x", "facebook", "linkedin", "whatsapp", "email"];

/**
 * Couleurs des marques (mode jour) et repli sur la couleur du texte en mode nuit.
 *
 * En mode jour, chaque icône reprend sa couleur officielle — c'est ce qui rend le
 * bouton identifiable d'un coup d'œil. En mode nuit, ces couleurs seraient soit
 * trop sombres (le X noir disparaîtrait sur une carte sombre), soit trop vives :
 * le glyphe repasse donc en couleur de texte du thème, sur la même carte.
 */
const BRAND_COLOURS: Record<Network, string> = {
  x: "text-[#000000] dark:text-foreground",
  facebook: "text-[#1877F2] dark:text-foreground",
  linkedin: "text-[#0A66C2] dark:text-foreground",
  whatsapp: "text-[#25D366] dark:text-foreground",
  email: "text-[#374151] dark:text-foreground",
};

/** Bulle de commentaire, pour le raccourci du rail latéral. */
const COMMENT_PATH =
  "M12 3C6.75 3 2.5 6.42 2.5 10.64c0 2.4 1.3 4.53 3.35 5.93-.06 1.2-.5 2.43-1.35 3.43 1.68.06 3.16-.55 4.2-1.32.99.24 2.08.37 3.3.37 5.25 0 9.5-3.42 9.5-7.64S17.25 3 12 3Zm-3.2 6.1h6.4a.95.95 0 1 1 0 1.9H8.8a.95.95 0 1 1 0-1.9Zm0 3.4h4.2a.95.95 0 1 1 0 1.9H8.8a.95.95 0 1 1 0-1.9Z";

/** Liens de partage, calculés côté serveur à partir de l'URL canonique. */
function shareLinks(slug: string, title: string): Record<Network, string> {
  const url = absoluteUrl(`/article/${slug}`);
  const text = encodeURIComponent(title);
  const target = encodeURIComponent(url);

  return {
    x: `https://twitter.com/intent/tweet?text=${text}&url=${target}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${target}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${target}`,
    whatsapp: `https://wa.me/?text=${text}%20${target}`,
    email: `mailto:?subject=${text}&body=${target}`,
  };
}

export function ArticleShareLinks({
  slug,
  title,
  orientation = "inline",
  comments,
}: {
  slug: string;
  title: string;
  orientation?: "inline" | "rail";
  /**
   * Raccourci vers les commentaires, avec leur nombre — uniquement sur le rail
   * latéral : la rangée de fin d'article reste limitée aux réseaux de partage.
   */
  comments?: { count: number };
}) {
  const links = shareLinks(slug, title);
  const vertical = orientation === "rail";
  const showComments = vertical && comments !== undefined;

  return (
    <nav
      aria-label="Partager cet article"
      data-share={orientation}
      className={vertical ? "flex flex-col gap-2" : "flex flex-wrap items-center gap-2"}
    >
      {!vertical ? (
        <span className="mr-1 text-xs font-bold uppercase tracking-[1px] text-muted-foreground">
          Partager
        </span>
      ) : null}

      {ORDER.map((network) => (
        <a
          key={network}
          href={links[network]}
          aria-label={LABELS[network]}
          title={LABELS[network]}
          {...(network === "email"
            ? {}
            : { target: "_blank", rel: "noopener noreferrer" })}
          className={`flex h-12 w-12 items-center justify-center border border-border bg-card transition-colors hover:border-editorial-link hover:bg-muted ${BRAND_COLOURS[network]}`}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-[22px] w-[22px]"
          >
            <path d={PATHS[network]} fillRule={EVEN_ODD[network] ? "evenodd" : undefined} />
          </svg>
        </a>
      ))}

      {showComments ? (
        // Pas de parenthèses dans le libellé : axe retire le contenu entre
        // parenthèses des noms accessibles, et le compteur visible ne serait
        // plus « contenu » dans le nom (label-content-name-mismatch, WP30).
        <a
          href="#commentaires"
          aria-label={`Commentaires ${comments.count}`}
          title={`Commentaires ${comments.count}`}
          className="relative flex h-12 w-12 items-center justify-center border border-border bg-card text-foreground transition-colors hover:border-editorial-link hover:bg-muted hover:text-editorial-link"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-[22px] w-[22px]">
            <path d={COMMENT_PATH} />
          </svg>
          {/*
            Le compteur est posé sur le lime de la charte avec un texte sombre :
            en thème nuit, `--ed-link` vaut lui-même #d7ff00, donc un texte blanc
            sur ce fond était illisible. Le lime est clair dans les deux thèmes :
            le texte sombre reste lisible partout.
          */}
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 min-w-[19px] rounded-full bg-[#d7ff00] px-1 text-center text-[11px] font-bold leading-[19px] text-[#111211]"
          >
            {comments.count}
          </span>
        </a>
      ) : null}
    </nav>
  );
}
