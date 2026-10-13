CREATE TYPE "SyncStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED');
CREATE TABLE "SyncLog" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "matchesSynced" INTEGER NOT NULL DEFAULT 0,
  "errors" JSONB NOT NULL DEFAULT '[]',
  "status" "SyncStatus" NOT NULL DEFAULT 'FAILED',
  CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SyncLog_type_startedAt_idx" ON "SyncLog"("type", "startedAt");
