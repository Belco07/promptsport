-- Migration WP38 : interventions éditoriales en direct (MatchLiveUpdate).
CREATE TYPE "LiveUpdateType" AS ENUM ('TEXT', 'GOAL', 'CARD', 'SUB', 'KEY_MOMENT');

CREATE TABLE "MatchLiveUpdate" (
  "id" TEXT NOT NULL,
  "matchId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "minute" INTEGER,
  "content" VARCHAR(500) NOT NULL,
  "type" "LiveUpdateType" NOT NULL DEFAULT 'TEXT',
  "isPinned" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MatchLiveUpdate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MatchLiveUpdate_matchId_minute_idx" ON "MatchLiveUpdate"("matchId", "minute");
CREATE INDEX "MatchLiveUpdate_matchId_createdAt_idx" ON "MatchLiveUpdate"("matchId", "createdAt");

ALTER TABLE "MatchLiveUpdate" ADD CONSTRAINT "MatchLiveUpdate_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchLiveUpdate" ADD CONSTRAINT "MatchLiveUpdate_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Author"("id") ON DELETE CASCADE ON UPDATE CASCADE;
