CREATE TYPE "SocialPlatform" AS ENUM ('X', 'FACEBOOK');
CREATE TYPE "SocialPostStatus" AS ENUM ('DRAFT', 'POSTED');
CREATE TABLE "SocialPost" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "content" TEXT NOT NULL,
    "status" "SocialPostStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SocialPost_articleId_platform_key" ON "SocialPost"("articleId", "platform");
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
