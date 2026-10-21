import { unstable_cache } from "next/cache";

import { prisma } from "@/lib/prisma";

/**
 * Configuration globale du site (WP43).
 *
 * Une seule ligne (`id = "default"`) porte le nom public, la description SEO et
 * le mode maintenance. La lecture est mise en cache cinq minutes et invalidée
 * par l'action d'enregistrement : les métadonnées du layout public ne doivent
 * pas ouvrir une connexion à chaque requête.
 */

export const SITE_CONFIG_ID = "default";
export const SITE_CONFIG_TAG = "site-config";

export type SiteConfigValues = {
  siteName: string;
  siteDescription: string;
  maintenanceMode: boolean;
  /** `unstable_cache` sérialise les dates en chaînes ISO. */
  updatedAt: Date | string | null;
};

/** Valeurs de repli si la base est momentanément indisponible. */
export const DEFAULT_SITE_CONFIG: SiteConfigValues = {
  siteName: "PromptSport",
  siteDescription: "L'actualité sportive en continu",
  maintenanceMode: false,
  updatedAt: null,
};

export const getSiteConfig = unstable_cache(
  async (): Promise<SiteConfigValues> => {
    try {
      const config = await prisma.siteConfig.findUnique({
        where: { id: SITE_CONFIG_ID },
        select: {
          siteName: true,
          siteDescription: true,
          maintenanceMode: true,
          updatedAt: true,
        },
      });

      return config ?? DEFAULT_SITE_CONFIG;
    } catch (error) {
      console.warn(
        "[site-config] configuration indisponible :",
        error instanceof Error ? error.message : error,
      );
      return DEFAULT_SITE_CONFIG;
    }
  },
  ["site-config"],
  { revalidate: 300, tags: [SITE_CONFIG_TAG] },
);
