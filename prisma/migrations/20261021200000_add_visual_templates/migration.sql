CREATE TABLE "VisualTemplate" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "document" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisualTemplate_pkey" PRIMARY KEY ("id")
);
