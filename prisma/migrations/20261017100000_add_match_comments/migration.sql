CREATE TYPE "MatchCommentPhase" AS ENUM ('PRE_MATCH', 'LIVE', 'POST_MATCH');
CREATE TYPE "MatchCommentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'DELETED');
CREATE TABLE "MatchComment" (
  "id" TEXT NOT NULL,
  "matchId" TEXT NOT NULL,
  "readerId" TEXT,
  "authorId" TEXT,
  "content" VARCHAR(1000) NOT NULL,
  "phase" "MatchCommentPhase" NOT NULL,
  "status" "MatchCommentStatus" NOT NULL DEFAULT 'PENDING',
  "parentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MatchComment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MatchComment_content_check" CHECK (length(btrim("content")) BETWEEN 1 AND 1000),
  CONSTRAINT "MatchComment_owner_check" CHECK ("readerId" IS NULL OR "authorId" IS NULL),
  CONSTRAINT "MatchComment_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MatchComment_readerId_fkey" FOREIGN KEY ("readerId") REFERENCES "Author"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MatchComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Author"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MatchComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "MatchComment"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "MatchComment_matchId_phase_status_createdAt_idx" ON "MatchComment"("matchId", "phase", "status", "createdAt");
CREATE INDEX "MatchComment_readerId_matchId_createdAt_idx" ON "MatchComment"("readerId", "matchId", "createdAt");
CREATE INDEX "MatchComment_authorId_matchId_createdAt_idx" ON "MatchComment"("authorId", "matchId", "createdAt");
CREATE INDEX "MatchComment_parentId_idx" ON "MatchComment"("parentId");
CREATE INDEX "MatchComment_status_createdAt_idx" ON "MatchComment"("status", "createdAt");
