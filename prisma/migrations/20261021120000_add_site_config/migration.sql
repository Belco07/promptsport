-- WP43 : configuration globale du site (une seule ligne, id = 'default').
CREATE TABLE "SiteConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "siteName" TEXT NOT NULL DEFAULT 'PromptSport',
    "siteDescription" TEXT NOT NULL DEFAULT 'L''actualité sportive en continu',
    "maintenanceMode" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteConfig_pkey" PRIMARY KEY ("id")
);

-- La configuration existe dès la migration : l'administration peut la lire et
-- la modifier sans créer de ligne au préalable.
INSERT INTO "SiteConfig" ("id", "siteName", "siteDescription", "maintenanceMode", "updatedAt")
VALUES ('default', 'PromptSport', 'L''actualité sportive en continu', false, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
