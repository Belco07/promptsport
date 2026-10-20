-- News Engine (WP41) : sources de veille et alertes.
-- Migration générée par diff, limitée aux objets de ce lot (le drift local
-- historique sur les FK/index existants n'est volontairement pas repris).

-- CreateEnum
CREATE TYPE "NewsSourceType" AS ENUM ('RSS', 'YOUTUBE');

-- CreateEnum
CREATE TYPE "NewsAlertStatus" AS ENUM ('PENDING', 'DRAFT_GENERATED', 'IGNORED');

-- CreateTable
CREATE TABLE "NewsSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "NewsSourceType" NOT NULL,
    "url" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsAlert" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "content" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "status" "NewsAlertStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NewsSource_url_key" ON "NewsSource"("url");

-- CreateIndex
CREATE INDEX "NewsSource_active_idx" ON "NewsSource"("active");

-- CreateIndex
CREATE INDEX "NewsAlert_status_publishedAt_idx" ON "NewsAlert"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "NewsAlert_sourceId_idx" ON "NewsAlert"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "NewsAlert_sourceId_url_key" ON "NewsAlert"("sourceId", "url");

-- AddForeignKey
ALTER TABLE "NewsAlert" ADD CONSTRAINT "NewsAlert_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "NewsSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
