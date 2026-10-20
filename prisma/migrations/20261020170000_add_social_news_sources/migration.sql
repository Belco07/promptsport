-- News Engine (WP41) : veille sur les réseaux sociaux.
-- Les valeurs sont ajoutées à l'enum existant ; les lignes NewsSource déjà
-- présentes conservent leur type RSS ou YOUTUBE.
ALTER TYPE "NewsSourceType" ADD VALUE IF NOT EXISTS 'BLUESKY';
ALTER TYPE "NewsSourceType" ADD VALUE IF NOT EXISTS 'MASTODON';
ALTER TYPE "NewsSourceType" ADD VALUE IF NOT EXISTS 'REDDIT';
ALTER TYPE "NewsSourceType" ADD VALUE IF NOT EXISTS 'SOCIAL';
