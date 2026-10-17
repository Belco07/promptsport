-- Complete the existing hub without recreating its votes or subscriptions.
ALTER TABLE "Author" ADD COLUMN "favoriteClubId" TEXT;
ALTER TABLE "Author" ADD CONSTRAINT "Author_favoriteClubId_fkey" FOREIGN KEY ("favoriteClubId") REFERENCES "Team"(id) ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Author_favoriteClubId_idx" ON "Author"("favoriteClubId");
ALTER TABLE "Team" ADD COLUMN "rivalClubIds" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Team" ADD CONSTRAINT "Team_rivalClubIds_array" CHECK (jsonb_typeof("rivalClubIds")='array');
UPDATE "Team" t SET "rivalClubIds"=(SELECT jsonb_agg(r."rivalClubId" ORDER BY r."rivalClubId") FROM "ClubRivalry" r WHERE r."clubId"=t.id)
WHERE EXISTS (SELECT 1 FROM "ClubRivalry" r WHERE r."clubId"=t.id);

-- Preserve the relational foreign keys used by the already-deployed hub.
CREATE FUNCTION sync_club_rivalries() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(NEW."rivalClubIds") x(id)
    WHERE x.id=NEW.id OR NOT EXISTS (SELECT 1 FROM "Team" t WHERE t.id=x.id)) THEN
    RAISE EXCEPTION 'Invalid rival club';
  END IF;
  DELETE FROM "ClubRivalry" WHERE "clubId"=NEW.id;
  INSERT INTO "ClubRivalry" (id,"clubId","rivalClubId")
  SELECT 'rivalry_' || md5(NEW.id || ':' || x.id),NEW.id,x.id FROM (SELECT DISTINCT jsonb_array_elements_text(NEW."rivalClubIds") AS id) x;
  RETURN NEW;
END;
$$;
CREATE TRIGGER team_rivalries_update AFTER INSERT OR UPDATE OF "rivalClubIds" ON "Team" FOR EACH ROW EXECUTE FUNCTION sync_club_rivalries();
