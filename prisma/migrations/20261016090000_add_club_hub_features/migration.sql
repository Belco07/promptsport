ALTER TABLE "Author" ADD COLUMN "digestOptIn" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "ManOfTheMatchVote" (
  "id" TEXT PRIMARY KEY, "matchId" TEXT NOT NULL REFERENCES "Match"("id") ON DELETE CASCADE,
  "readerId" TEXT NOT NULL REFERENCES "Author"("id") ON DELETE CASCADE,
  "playerId" TEXT NOT NULL REFERENCES "Player"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ManOfTheMatchVote_matchId_readerId_key" ON "ManOfTheMatchVote"("matchId", "readerId");
CREATE INDEX "ManOfTheMatchVote_matchId_playerId_idx" ON "ManOfTheMatchVote"("matchId", "playerId");
CREATE TABLE "ClubDigestSubscription" (
  "id" TEXT PRIMARY KEY, "readerId" TEXT NOT NULL REFERENCES "Author"("id") ON DELETE CASCADE,
  "clubId" TEXT NOT NULL REFERENCES "Team"("id") ON DELETE CASCADE, "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "ClubDigestSubscription_readerId_clubId_key" ON "ClubDigestSubscription"("readerId", "clubId");
CREATE INDEX "ClubDigestSubscription_enabled_idx" ON "ClubDigestSubscription"("enabled");
CREATE TABLE "ClubDigestDelivery" (
  "id" TEXT PRIMARY KEY, "subscriptionId" TEXT NOT NULL REFERENCES "ClubDigestSubscription"("id") ON DELETE CASCADE,
  "week" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'RESERVED', "providerMessageId" TEXT, "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "sentAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "ClubDigestDelivery_subscriptionId_week_key" ON "ClubDigestDelivery"("subscriptionId", "week");
CREATE TABLE "ClubRivalry" (
  "id" TEXT PRIMARY KEY, "clubId" TEXT NOT NULL REFERENCES "Team"("id") ON DELETE CASCADE,
  "rivalClubId" TEXT NOT NULL REFERENCES "Team"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClubRivalry_distinct_clubs" CHECK ("clubId" <> "rivalClubId")
);
CREATE UNIQUE INDEX "ClubRivalry_clubId_rivalClubId_key" ON "ClubRivalry"("clubId", "rivalClubId");
CREATE INDEX "ClubRivalry_rivalClubId_idx" ON "ClubRivalry"("rivalClubId");

-- Only established pairs whose two clubs are already present are configured.
-- No team creation, provider lookup, or guessed rivalry for unknown clubs.
WITH pairs(left_names,right_names) AS (VALUES
  (ARRAY['FC Barcelona','FC Barcelone','Barcelona'],ARRAY['Real Madrid']),
  (ARRAY['Manchester United'],ARRAY['Manchester City']),
  (ARRAY['Arsenal'],ARRAY['Tottenham Hotspur','Tottenham']),
  (ARRAY['Inter','Inter Milan','Internazionale'],ARRAY['AC Milan','Milan']),
  (ARRAY['Paris Saint-Germain','Paris Saint Germain','PSG'],ARRAY['Olympique Marseille','Olympique de Marseille','Marseille']),
  (ARRAY['Roma','AS Roma'],ARRAY['Lazio']),
  (ARRAY['Liverpool'],ARRAY['Everton']),
  (ARRAY['Sevilla','Sevilla FC','Séville'],ARRAY['Real Betis','Betis'])
), clubs AS (
  SELECT l.id AS left_id,r.id AS right_id FROM pairs
  JOIN "Team" l ON l.name=ANY(left_names) JOIN "Team" r ON r.name=ANY(right_names)
), directions AS (
  SELECT left_id AS club_id,right_id AS rival_id FROM clubs
  UNION SELECT right_id,left_id FROM clubs
)
INSERT INTO "ClubRivalry"(id,"clubId","rivalClubId")
SELECT 'rivalry_' || md5(club_id || ':' || rival_id),club_id,rival_id FROM directions
ON CONFLICT ("clubId","rivalClubId") DO NOTHING;
