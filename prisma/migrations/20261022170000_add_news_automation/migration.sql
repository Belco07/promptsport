-- WP47 — automatisation hybride et filtrage budgétaire.
--
-- Les valeurs par défaut sont volontairement conservatrices :
--   * une source reste à 50/100 et n'est jamais auto-publiée sans opt-in ;
--   * une alerte reste à 1/5 et ne déclenche donc pas l'IA par défaut.
ALTER TABLE "NewsSource"
  ADD COLUMN "reliability" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN "autoPublish" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "NewsAlert"
  ADD COLUMN "viralScore" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "NewsSource"
  ADD CONSTRAINT "NewsSource_reliability_check"
  CHECK ("reliability" >= 0 AND "reliability" <= 100);

ALTER TABLE "NewsAlert"
  ADD CONSTRAINT "NewsAlert_viralScore_check"
  CHECK ("viralScore" >= 1 AND "viralScore" <= 5);

CREATE INDEX "NewsAlert_viralScore_status_idx"
  ON "NewsAlert"("viralScore", "status");

CREATE INDEX "NewsSource_autoPublish_reliability_idx"
  ON "NewsSource"("autoPublish", "reliability");
