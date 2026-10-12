CREATE TYPE "FeaturedSlotType" AS ENUM ('HERO', 'SECONDARY_1', 'SECONDARY_2', 'URGENT');
CREATE TABLE "FeaturedSlot" (
  "id" TEXT NOT NULL,
  "slot" "FeaturedSlotType" NOT NULL,
  "articleId" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FeaturedSlot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FeaturedSlot_slot_key" ON "FeaturedSlot"("slot");
ALTER TABLE "FeaturedSlot" ADD CONSTRAINT "FeaturedSlot_articleId_fkey"
FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
