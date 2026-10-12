-- Reader accounts use Author (role READER) in this application.
ALTER TYPE "NotificationType" ADD VALUE 'ARTICLE_PUBLISHED';

CREATE TABLE "_ReaderFollowedTeams" (
  "A" TEXT NOT NULL REFERENCES "Author"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "B" TEXT NOT NULL REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "_ReaderFollowedTeams_AB_pkey" PRIMARY KEY ("A", "B")
);
CREATE INDEX "_ReaderFollowedTeams_B_index" ON "_ReaderFollowedTeams"("B");

CREATE TABLE "_ReaderFollowedCompetitions" (
  "A" TEXT NOT NULL REFERENCES "Author"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "B" TEXT NOT NULL REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "_ReaderFollowedCompetitions_AB_pkey" PRIMARY KEY ("A", "B")
);
CREATE INDEX "_ReaderFollowedCompetitions_B_index" ON "_ReaderFollowedCompetitions"("B");

-- Preserve preferences already selected during onboarding.
INSERT INTO "_ReaderFollowedCompetitions" ("A", "B")
SELECT a.id, c.id FROM "Author" a JOIN "Competition" c ON c.slug = ANY(a."favoriteCompetitions")
ON CONFLICT DO NOTHING;

-- The existing onboarding/preferences action still writes this array.
-- Keep it compatible without changing those actions or deleting preferences.
CREATE FUNCTION sync_reader_competition_follows() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "_ReaderFollowedCompetitions" WHERE "A" = NEW.id;
  INSERT INTO "_ReaderFollowedCompetitions" ("A", "B")
  SELECT NEW.id, c.id FROM "Competition" c WHERE c.slug = ANY(NEW."favoriteCompetitions")
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reader_competition_follows_update
AFTER INSERT OR UPDATE OF "favoriteCompetitions" ON "Author"
FOR EACH ROW EXECUTE FUNCTION sync_reader_competition_follows();
