import type { NextConfig } from "next";

/**
 * Configuration Next.js — WP8c (Core Web Vitals).
 *
 * Leviers activés ici : formats d'images modernes, palette de tailles adaptée à
 * la grille du site, domaines distants autorisés pour l'optimiseur, et en-têtes
 * de cache par type de ressource.
 */

/** Assets immuables produits par le build (nom de fichier haché). */
const STATIC_ASSETS_CACHE = "public, max-age=31536000, immutable";
/** Images optimisées : court en navigateur, mais service immédiat depuis le cache. */
const OPTIMIZED_IMAGE_CACHE = "public, max-age=60, stale-while-revalidate=86400";
/**
 * HTML des pages publiques : jamais servi depuis le cache navigateur sans
 * revalidation. La fraîcheur du contenu est gérée par la revalidation Next.js
 * côté serveur (`revalidate`), pas par le cache du navigateur.
 */
const PUBLIC_HTML_CACHE = "public, max-age=0, must-revalidate";

/**
 * Configuration de l'optimiseur d'images.
 *
 * `qualities` est lue par Next depuis la version 15 (l'optimiseur refuse une
 * qualité non déclarée et avertit tant que la clé est absente) mais elle n'est
 * pas encore présente dans les types de `NextConfig` en 15.5 : on l'ajoute de
 * façon typée plutôt que par un cast. La qualité 70 est celle des vignettes
 * d'articles (WP9) : en AVIF, ~15 % d'octets en moins pour un écart invisible.
 */
type ImageConfig = NonNullable<NextConfig["images"]> & { qualities: number[] };

const imageConfig: ImageConfig = {
  // Formats modernes : le navigateur reçoit de l'AVIF ou du WebP selon son
  // en-tête `Accept`, avec repli automatique sur le format d'origine.
  formats: ["image/avif", "image/webp"],
  qualities: [70, 75],
  // Largeurs générées pour les images pleine largeur (la colonne de contenu
  // fait au plus 1152 px : inutile de produire du 2048/3840). La largeur 832
  // évite de servir du 1024 px à la couverture d'article, qui s'affiche sur
  // 800 px au maximum.
  deviceSizes: [360, 420, 640, 768, 832, 1024, 1280, 1536],
  // Petites tailles : logos d'équipes (40 et 64 px) et vignettes d'articles.
  imageSizes: [40, 64, 96, 128, 256, 384],
  // Hôtes distants autorisés pour l'optimiseur d'images.
  remotePatterns: [
    // Logos des équipes servis par l'API football-data.org.
    { protocol: "https", hostname: "crests.football-data.org" },
    // Couvertures d'articles stockées dans Vercel Blob en production : l'URL
    // renvoyée par put() est de la forme
    // https://<store>.public.blob.vercel-storage.com/uploads/<uuid>.jpg, et
    // next/image refuse par défaut tout hôte non déclaré ici.
    { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
  ],
};

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Par défaut, Next limite le corps des Server Actions à 1 Mo.
      // Les images de couverture autorisées vont jusqu'à 5 Mo : on monte à 6 Mo
      // pour couvrir la surcharge multipart (boundaries, en-têtes, métadonnées).
      bodySizeLimit: "6mb",
    },
    // Partial Prerendering reste expérimental : désactivé explicitement (WP8c).
    ppr: false,
    // `optimizePackageImports` n'est pas renseigné : le projet ne dépend
    // d'aucune bibliothèque à fichier « barrel » (react-markdown, remark-gfm,
    // stripe, bcryptjs et better-sqlite3 ont une entrée unique) — l'activer
    // n'apporterait aucun gain et risquerait de casser l'import.
  },
  images: imageConfig,
  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: STATIC_ASSETS_CACHE }],
      },
      {
        // Next sert déjà `max-age=60` (minimumCacheTTL) : on ajoute la
        // revalidation en arrière-plan pour éviter tout blocage au 61e accès.
        source: "/_next/image",
        headers: [{ key: "Cache-Control", value: OPTIMIZED_IMAGE_CACHE }],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      ...[
        "/",
        "/scores",
        "/abonnement",
        "/abonnement/:path*",
        "/article/:path*",
        "/competition/:path*",
        "/match/:path*",
      ].map((source) => ({
        source,
        headers: [{ key: "Cache-Control", value: PUBLIC_HTML_CACHE }],
      })),
    ];
  },
};

export default nextConfig;
