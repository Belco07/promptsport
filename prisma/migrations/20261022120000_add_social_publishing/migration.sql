-- Publication Facebook/Instagram et validation des sources non officielles.

ALTER TYPE "SocialPlatform" ADD VALUE 'INSTAGRAM';
ALTER TYPE "SocialPostStatus" ADD VALUE 'PUBLISHING';
ALTER TYPE "SocialPostStatus" ADD VALUE 'FAILED';

ALTER TABLE "Article"
  ADD COLUMN "newsSourceId" TEXT,
  ADD COLUMN "socialAutoPublish" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "SocialPost"
  ADD COLUMN "externalId" TEXT,
  ADD COLUMN "error" TEXT,
  ADD COLUMN "autoPublished" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "publishedAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "Article_newsSourceId_idx" ON "Article"("newsSourceId");
CREATE INDEX "SocialPost_status_idx" ON "SocialPost"("status");

ALTER TABLE "Article"
  ADD CONSTRAINT "Article_newsSourceId_fkey"
  FOREIGN KEY ("newsSourceId") REFERENCES "NewsSource"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
