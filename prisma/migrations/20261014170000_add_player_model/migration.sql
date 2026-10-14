CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "position" TEXT,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Player_slug_key" ON "Player"("slug");
CREATE UNIQUE INDEX "Player_teamId_name_key" ON "Player"("teamId", "name");
CREATE INDEX "Player_teamId_idx" ON "Player"("teamId");
CREATE INDEX "Player_name_idx" ON "Player"("name");
ALTER TABLE "Player" ADD CONSTRAINT "Player_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
