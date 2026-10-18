ALTER TABLE "Author" ADD COLUMN "alertsEnabled" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "ClubAlertDelivery" (
 "id" TEXT NOT NULL, "readerId" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'RESERVED',
 "providerMessageId" TEXT, "error" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "sentAt" TIMESTAMP(3),
 CONSTRAINT "ClubAlertDelivery_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ClubAlertDelivery_readerId_createdAt_idx" ON "ClubAlertDelivery"("readerId", "createdAt");
ALTER TABLE "ClubAlertDelivery" ADD CONSTRAINT "ClubAlertDelivery_readerId_fkey" FOREIGN KEY ("readerId") REFERENCES "Author"("id") ON DELETE CASCADE ON UPDATE CASCADE;
