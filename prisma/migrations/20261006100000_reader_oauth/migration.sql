ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'READER';
ALTER TABLE "Author" ADD COLUMN "welcomeCompleted" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Author" ADD COLUMN "favoriteCompetitions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE TABLE "OAuthAccount" (
  "provider" TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  CONSTRAINT "OAuthAccount_pkey" PRIMARY KEY ("provider", "providerAccountId"),
  CONSTRAINT "OAuthAccount_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Author"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "OAuthAccount_authorId_idx" ON "OAuthAccount"("authorId");
