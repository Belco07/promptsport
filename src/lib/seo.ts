import type { Metadata } from "next";

/**
 * Métadonnées SEO (WP8a) : constantes du site, fabrique de metadata Next.js et
 * générateurs de données structurées JSON-LD (Schema.org).
 */

/** URL publique du site (metadataBase, canoniques, JSON-LD). */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
).replace(/\/+$/, "");

export const SITE_NAME = "PromptSport";
export const HOME_TITLE = "PromptSport — L'actualité qui vibre, la passion qui déborde";
export const SITE_DESCRIPTION =
  "Toute l'actualité sportive : résultats et scores en direct, classements, analyses et articles premium.";
export const TWITTER_CREATOR = "@moncompte";

/** Image Open Graph par défaut (1200x630), servie depuis /public. */
export const DEFAULT_OG_IMAGE = "/og-default.png";
/** Logo utilisé par les données structurées (route d'icône générée par Next). */
export const SITE_LOGO = "/icon";
/** Réseaux sociaux déclarés dans le JSON-LD Organization. */
export const SOCIAL_LINKS = [
  "https://twitter.com/moncompte",
  "https://www.facebook.com/moncompte",
];

/** Transforme un chemin interne en URL absolue. */
export function absoluteUrl(path = "/"): string {
  return new URL(path, `${SITE_URL}/`).toString();
}

/**
 * Sérialise un objet JSON-LD pour un `<script type="application/ld+json">`.
 * `<` est échappé : un titre contenant « </script> » ne doit pas casser la page.
 */
export function jsonLdString(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

type PageMetadataInput = {
  title: string | { absolute: string };
  description: string;
  /** Chemin interne de la page (sert d'URL canonique et d'og:url). */
  path: string;
  type?: "website" | "article";
  images?: string[];
  publishedTime?: string;
  authors?: string[];
  section?: string;
  robots?: Metadata["robots"];
};

/**
 * Métadonnées complètes d'une page publique : canonical, Open Graph et Twitter
 * Card cohérents. Le titre passe par le template du layout racine (sauf titre
 * absolu, réservé à l'accueil).
 */
export function buildPageMetadata({
  title,
  description,
  path,
  type = "website",
  images = [DEFAULT_OG_IMAGE],
  publishedTime,
  authors,
  section,
  robots,
}: PageMetadataInput): Metadata {
  const url = absoluteUrl(path);
  const absoluteImages = images.map((image) => absoluteUrl(image));
  const ogTitle = typeof title === "string" ? title : title.absolute;

  return {
    title,
    description,
    alternates: { canonical: url },
    ...(robots ? { robots } : {}),
    openGraph: {
      type,
      title: ogTitle,
      description,
      url,
      siteName: SITE_NAME,
      locale: "fr_FR",
      images: absoluteImages,
      ...(publishedTime ? { publishedTime } : {}),
      ...(authors ? { authors } : {}),
      ...(section ? { section } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      description,
      images: absoluteImages,
      creator: TWITTER_CREATOR,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Données structurées (JSON-LD)                                              */
/* -------------------------------------------------------------------------- */

const ORGANIZATION_REFERENCE = {
  "@type": "Organization",
  name: SITE_NAME,
  url: absoluteUrl("/"),
} as const;

/** Organization : le site et son éditeur (page d'accueil). */
export function organizationJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: absoluteUrl("/"),
    logo: {
      "@type": "ImageObject",
      url: absoluteUrl(SITE_LOGO),
    },
    description: SITE_DESCRIPTION,
    sameAs: SOCIAL_LINKS,
  };
}

/** NewsArticle : un article publié. */
export function newsArticleJsonLd({
  title,
  description,
  path,
  images,
  publishedAt,
  updatedAt,
  authorName,
  section,
}: {
  title: string;
  description: string;
  path: string;
  images: string[];
  publishedAt: string | null;
  updatedAt: string;
  authorName: string | null;
  section: string | null;
}): Record<string, unknown> {
  const url = absoluteUrl(path);
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: title,
    description,
    image: images.map((image) => absoluteUrl(image)),
    ...(publishedAt ? { datePublished: publishedAt } : {}),
    dateModified: updatedAt,
    ...(section ? { articleSection: section } : {}),
    ...(authorName ? { author: { "@type": "Person", name: authorName } } : {}),
    publisher: {
      ...ORGANIZATION_REFERENCE,
      logo: { "@type": "ImageObject", url: absoluteUrl(SITE_LOGO) },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    url,
    inLanguage: "fr-FR",
  };
}

/** SportsEvent : une rencontre (équipes, date, lieu, compétition). */
export function sportsEventJsonLd({
  name,
  path,
  startDate,
  venue,
  homeTeam,
  awayTeam,
  competitionName,
  description,
}: {
  name: string;
  path: string;
  startDate: string;
  venue: string | null;
  homeTeam: string;
  awayTeam: string;
  competitionName: string | null;
  description?: string;
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name,
    ...(description ? { description } : {}),
    startDate,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    ...(venue ? { location: { "@type": "Place", name: venue } } : {}),
    competitor: [
      { "@type": "SportsTeam", name: homeTeam },
      { "@type": "SportsTeam", name: awayTeam },
    ],
    homeTeam: { "@type": "SportsTeam", name: homeTeam },
    awayTeam: { "@type": "SportsTeam", name: awayTeam },
    ...(competitionName
      ? { superEvent: { "@type": "SportsOrganization", name: competitionName } }
      : {}),
    url: absoluteUrl(path),
  };
}

/** SportsOrganization : une compétition (page /competition/[slug]). */
export function sportsOrganizationJsonLd({
  name,
  path,
  sport,
  country,
}: {
  name: string;
  path: string;
  sport: string | null;
  country: string | null;
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "SportsOrganization",
    name,
    url: absoluteUrl(path),
    ...(sport ? { sport } : {}),
    ...(country ? { areaServed: country } : {}),
    ...(sport ? { description: `Compétition de ${sport.toLowerCase()} : classement et résultats.` } : {}),
  };
}

/** Person : un auteur (page /auteur/[slug]). */
export function personJsonLd({
  name,
  path,
  description,
  image,
  jobTitle,
  sameAs,
}: {
  name: string;
  path: string;
  description: string | null;
  image: string | null;
  jobTitle: string | null;
  sameAs?: string[];
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name,
    url: absoluteUrl(path),
    ...(description ? { description } : {}),
    ...(image ? { image: absoluteUrl(image) } : {}),
    ...(jobTitle ? { jobTitle } : {}),
    ...(sameAs && sameAs.length > 0 ? { sameAs } : {}),
    worksFor: ORGANIZATION_REFERENCE,
    mainEntityOfPage: { "@type": "WebPage", "@id": absoluteUrl(path) },
  };
}

/** ItemList : une liste ordonnée (matchs à venir de /scores). */
export function itemListJsonLd({
  name,
  path,
  items,
}: {
  name: string;
  path: string;
  items: Array<{ name: string; url: string }>;
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    url: absoluteUrl(path),
    numberOfItems: items.length,
    itemListOrder: "https://schema.org/ItemListOrderAscending",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      url: absoluteUrl(item.url),
    })),
  };
}
