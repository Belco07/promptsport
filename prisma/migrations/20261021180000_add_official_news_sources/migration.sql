-- News Engine : sources officielles et connecteurs dédiés.
-- Les nouvelles valeurs sont ajoutées à l'enum existant ; aucune ligne
-- NewsSource n'est supprimée ou convertie.
ALTER TYPE "NewsSourceType" ADD VALUE IF NOT EXISTS 'FLASHSCORE';
ALTER TYPE "NewsSourceType" ADD VALUE IF NOT EXISTS 'SITEMAP';
ALTER TYPE "NewsSourceType" ADD VALUE IF NOT EXISTS 'OFFICIAL_SITE';
ALTER TYPE "NewsSourceType" ADD VALUE IF NOT EXISTS 'JSON';
ALTER TYPE "NewsSourceType" ADD VALUE IF NOT EXISTS 'MANUAL';

-- Marqueur éditorial des sources de première main (clubs, fédérations,
-- confédérations, ligues). Les sources existantes restent des médias.
ALTER TABLE "NewsSource" ADD COLUMN "isOfficial" BOOLEAN NOT NULL DEFAULT false;
