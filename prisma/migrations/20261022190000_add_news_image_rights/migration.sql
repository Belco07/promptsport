-- Droit à l'image des sources de veille et crédit des couvertures.
-- Les photos ne sont reprises que pour les sources explicitement licenciées.

CREATE TYPE "NewsImagePolicy" AS ENUM ('REFERENCE_ONLY', 'LICENSED');

ALTER TABLE "NewsSource"
  ADD COLUMN "imagePolicy" "NewsImagePolicy" NOT NULL DEFAULT 'REFERENCE_ONLY';

ALTER TABLE "NewsAlert"
  ADD COLUMN "imageUrl" TEXT,
  ADD COLUMN "imageCredit" TEXT;

ALTER TABLE "Article"
  ADD COLUMN "coverImageCredit" TEXT,
  ADD COLUMN "coverImageCreditUrl" TEXT;
