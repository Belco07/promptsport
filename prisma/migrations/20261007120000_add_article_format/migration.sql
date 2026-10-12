CREATE TYPE "ArticleFormat" AS ENUM ('FLASH', 'NEWS', 'ANALYSIS');
ALTER TABLE "Article" ADD COLUMN "format" "ArticleFormat" NOT NULL DEFAULT 'NEWS';
