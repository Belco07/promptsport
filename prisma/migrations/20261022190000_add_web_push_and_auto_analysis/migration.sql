ALTER TABLE "Article" ADD COLUMN "pushNotifiedAt" TIMESTAMP(3), ADD COLUMN "autoAnalysisKey" TEXT;
CREATE UNIQUE INDEX "Article_autoAnalysisKey_key" ON "Article"("autoAnalysisKey");
CREATE TABLE "PushSubscription" (
  "id" TEXT NOT NULL,
  "readerId" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_readerId_idx" ON "PushSubscription"("readerId");
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_readerId_fkey" FOREIGN KEY ("readerId") REFERENCES "Author"("id") ON DELETE CASCADE ON UPDATE CASCADE;
