"use client";

import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useEffect, useState, type ComponentType } from "react";
import { ArrowUpRight } from "lucide-react";

import { socialPlatform } from "@/lib/social-embeds";

/**
 * Embed social (WP15c) — Client Component obligatoire : `react-social-media-embed`
 * injecte les scripts des plateformes dans le navigateur et ne peut pas être
 * rendu côté serveur. Les composants sont donc chargés dynamiquement, sans SSR.
 *
 * Thème : la bibliothèque rend des cadres conçus pour un fond clair. En thème
 * sombre, `.social-embed--dark` pose un fond blanc derrière l'embed (et donne au
 * message de chargement un contraste lisible).
 */

type EmbedComponent = ComponentType<{ url: string }>;

/** Message affiché pendant le chargement du module d'embed. */
function EmbedPlaceholder() {
  return (
    <p className="social-embed-loading" aria-hidden="true">
      Chargement de l’embed…
    </p>
  );
}

const dynamicEmbed = (loader: () => Promise<EmbedComponent>) =>
  dynamic(loader, { ssr: false, loading: () => <EmbedPlaceholder /> });

const YouTubeEmbed = dynamicEmbed(() =>
  import("react-social-media-embed").then((module) => module.YouTubeEmbed),
);
const XEmbed = dynamicEmbed(() =>
  import("react-social-media-embed").then((module) => module.XEmbed),
);
const InstagramEmbed = dynamicEmbed(() =>
  import("react-social-media-embed").then((module) => module.InstagramEmbed),
);
const FacebookEmbed = dynamicEmbed(() =>
  import("react-social-media-embed").then((module) => module.FacebookEmbed),
);
const TikTokEmbed = dynamicEmbed(() =>
  import("react-social-media-embed").then((module) => module.TikTokEmbed),
);
const LinkedInEmbed = dynamicEmbed(() =>
  import("react-social-media-embed").then((module) => module.LinkedInEmbed),
);
const PinterestEmbed = dynamicEmbed(() =>
  import("react-social-media-embed").then((module) => module.PinterestEmbed),
);

/** Plateformes réellement embarquables (Bluesky n'a pas de composant). */
const EMBED_COMPONENTS: Record<string, EmbedComponent> = {
  youtube: YouTubeEmbed,
  x: XEmbed,
  instagram: InstagramEmbed,
  facebook: FacebookEmbed,
  tiktok: TikTokEmbed,
  linkedin: LinkedInEmbed,
  pinterest: PinterestEmbed,
};

/**
 * Embeds conçus pour un fond clair : en thème sombre, ils reçoivent un fond
 * blanc (`.social-embed--light`) pour rester lisibles. X et YouTube adaptent
 * eux-mêmes leur rendu au thème, ils n'en ont pas besoin.
 */
const LIGHT_CHROME_PLATFORMS = new Set(["instagram", "facebook", "tiktok", "linkedin", "pinterest"]);

/**
 * Carte de repli : plateforme sans composant d'embed (Bluesky) ou module
 * indisponible. Un lien lisible vaut mieux qu'un cadre vide.
 */
function SocialEmbedLink({ label, url }: { label: string; url: string }) {
  return (
    <a className="social-embed-link" href={url} target="_blank" rel="noopener noreferrer">
      <span className="social-embed-link-label">
        Voir la publication sur {label}
        <ArrowUpRight size={16} aria-hidden="true" />
      </span>
      <span className="social-embed-link-url">{url}</span>
    </a>
  );
}

export function SocialEmbed({ platform, url }: { platform: string; url: string }) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Le thème n'est connu qu'après montage : le serveur et le premier rendu
  // client utilisent donc le même état (clair), sans divergence d'hydratation.
  useEffect(() => {
    setMounted(true);
  }, []);

  const definition = socialPlatform(platform);
  if (!definition) return null;

  const Embed = definition.hasEmbed ? EMBED_COMPONENTS[definition.id] : undefined;
  const dark = mounted && resolvedTheme === "dark";
  const lightChrome = LIGHT_CHROME_PLATFORMS.has(definition.id) ? " social-embed--light" : "";

  return (
    <div
      className={`social-embed${lightChrome}${dark ? " social-embed--dark" : ""}`}
      data-social-embed={definition.id}
      role="group"
      aria-label={`Publication ${definition.label}`}
    >
      <div className="social-embed-frame">
        {Embed ? <Embed url={url} /> : <SocialEmbedLink label={definition.label} url={url} />}
      </div>
    </div>
  );
}

export default SocialEmbed;
