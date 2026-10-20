-- News Engine (WP41) : veille X, Facebook et Instagram.
-- Ces sources utilisent les API officielles et nécessitent des tokens
-- d'accès configurés côté serveur (X_BEARER_TOKEN, META_ACCESS_TOKEN…).
ALTER TYPE "NewsSourceType" ADD VALUE IF NOT EXISTS 'X';
ALTER TYPE "NewsSourceType" ADD VALUE IF NOT EXISTS 'FACEBOOK';
ALTER TYPE "NewsSourceType" ADD VALUE IF NOT EXISTS 'INSTAGRAM';
