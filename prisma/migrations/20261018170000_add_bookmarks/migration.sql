CREATE TABLE "Bookmark" (
  "id" TEXT NOT NULL,
  "readerId" TEXT NOT NULL,
  "articleId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Bookmark_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Bookmark_readerId_articleId_key" ON "Bookmark"("readerId", "articleId");
CREATE INDEX "Bookmark_readerId_createdAt_idx" ON "Bookmark"("readerId", "createdAt");
ALTER TABLE "Bookmark" ADD CONSTRAINT "Bookmark_readerId_fkey" FOREIGN KEY ("readerId") REFERENCES "Author"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Bookmark" ADD CONSTRAINT "Bookmark_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ReadingHistory" (
  "id" TEXT NOT NULL,
  "readerId" TEXT NOT NULL,
  "articleId" TEXT NOT NULL,
  "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReadingHistory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReadingHistory_readerId_articleId_key" ON "ReadingHistory"("readerId", "articleId");
CREATE INDEX "ReadingHistory_readerId_readAt_idx" ON "ReadingHistory"("readerId", "readAt");
ALTER TABLE "ReadingHistory" ADD CONSTRAINT "ReadingHistory_readerId_fkey" FOREIGN KEY ("readerId") REFERENCES "Author"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReadingHistory" ADD CONSTRAINT "ReadingHistory_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve private bookmarks created with the previous reaction control.
INSERT INTO "Bookmark" ("id", "readerId", "articleId", "createdAt")
SELECT "id", "authorId", "articleId", "createdAt" FROM "ArticleReaction" WHERE "type" = 'BOOKMARK'
ON CONFLICT ("readerId", "articleId") DO NOTHING;
