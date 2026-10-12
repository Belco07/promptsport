/**
 * Registre des plateformes d'embeds sociaux (WP15c).
 *
 * Ce fichier est partagé par l'éditeur (bouton d'insertion, éditeur de
 * directive) et par le rendu public : il ne dépend donc ni de React ni de Node.
 *
 * `hasEmbed` distingue les plateformes réellement embarquables par
 * `react-social-media-embed` de celles qui n'ont pas de composant dans la
 * bibliothèque (Bluesky) : pour ces dernières le rendu public affiche une carte
 * de lien, jamais un cadre vide.
 */

export type SocialPlatformDefinition = {
  /** Identifiant utilisé dans la directive `::social{platform="..."}`. */
  id: string;
  label: string;
  /** Domaines acceptés (le sous-domaine est toléré). */
  domains: string[];
  /** Exemple affiché dans la boîte de dialogue de l'éditeur. */
  example: string;
  /** Faux si la bibliothèque n'expose pas de composant pour cette plateforme. */
  hasEmbed: boolean;
};

export const SOCIAL_PLATFORMS: SocialPlatformDefinition[] = [
  {
    id: "youtube",
    label: "YouTube",
    domains: ["youtube.com", "youtu.be", "youtube-nocookie.com"],
    example: "https://www.youtube.com/watch?v=…",
    hasEmbed: true,
  },
  {
    id: "x",
    label: "X (Twitter)",
    domains: ["x.com", "twitter.com"],
    example: "https://x.com/compte/status/…",
    hasEmbed: true,
  },
  {
    id: "instagram",
    label: "Instagram",
    domains: ["instagram.com", "instagr.am"],
    example: "https://www.instagram.com/p/…",
    hasEmbed: true,
  },
  {
    id: "facebook",
    label: "Facebook",
    domains: ["facebook.com", "fb.watch", "fb.com"],
    example: "https://www.facebook.com/compte/posts/…",
    hasEmbed: true,
  },
  {
    id: "tiktok",
    label: "TikTok",
    domains: ["tiktok.com"],
    example: "https://www.tiktok.com/@compte/video/…",
    hasEmbed: true,
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    domains: ["linkedin.com"],
    example: "https://www.linkedin.com/posts/…",
    hasEmbed: true,
  },
  {
    id: "pinterest",
    label: "Pinterest",
    domains: ["pinterest.com", "pinterest.fr", "pin.it"],
    example: "https://www.pinterest.com/pin/…",
    hasEmbed: true,
  },
  {
    id: "bluesky",
    label: "Bluesky",
    domains: ["bsky.app"],
    example: "https://bsky.app/profile/compte.bsky.social/post/…",
    hasEmbed: false,
  },
];

/** Identifiants acceptés dans une directive. */
export type SocialPlatform = string;

/** Fiche d'une plateforme, ou `undefined` si l'identifiant est inconnu. */
export function socialPlatform(id: string): SocialPlatformDefinition | undefined {
  const normalised = id.trim().toLowerCase();
  return SOCIAL_PLATFORMS.find((platform) => platform.id === normalised);
}

/** Libellé lisible d'une plateforme (retombe sur l'identifiant brut). */
export function socialPlatformLabel(id: string): string {
  return socialPlatform(id)?.label ?? id;
}

/** L'identifiant correspond-il à une plateforme connue ? */
export function isSocialPlatform(id: string): boolean {
  return Boolean(socialPlatform(id));
}

/**
 * Normalise et valide l'adresse d'une publication.
 *
 * Retourne l'URL absolue en `https` si elle est exploitable — le domaine doit
 * correspondre à la plateforme annoncée, sinon la directive est refusée (une
 * adresse `javascript:` ou un domaine étranger ne doit jamais atteindre le
 * rendu). Retourne `null` si l'adresse est inutilisable.
 */
export function normaliseSocialUrl(platformId: string, rawUrl: string): string | null {
  const platform = socialPlatform(platformId);
  if (!platform) return null;

  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const matches = platform.domains.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
  if (!matches) return null;

  parsed.protocol = "https:";
  return parsed.toString();
}

/** Directive Markdown insérée par l'éditeur. */
export function socialDirective(platformId: string, url: string): string {
  return `::social{platform="${platformId}" url="${url}"}`;
}
