ALTER TABLE "Article" ADD COLUMN "matchId" TEXT;
CREATE INDEX "Article_matchId_status_publishedAt_idx" ON "Article"("matchId", "status", "publishedAt");
ALTER TABLE "Article" ADD CONSTRAINT "Article_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;
