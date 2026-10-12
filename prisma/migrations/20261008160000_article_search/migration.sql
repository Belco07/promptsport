BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
ALTER TABLE "Article" ADD COLUMN "searchVector" tsvector;

CREATE FUNCTION article_search_vector_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('pg_catalog.french', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('pg_catalog.french', coalesce(NEW.excerpt, '')), 'B') ||
    setweight(to_tsvector('pg_catalog.french', coalesce((SELECT name FROM "Author" WHERE id = NEW."authorId"), '')), 'B') ||
    setweight(to_tsvector('pg_catalog.french', coalesce((SELECT name FROM "Category" WHERE id = NEW."categoryId"), '')), 'B') ||
    setweight(to_tsvector('pg_catalog.french', left(coalesce(NEW.content, ''), 10000)), 'C');
  RETURN NEW;
END;
$$;
CREATE TRIGGER article_search_vector_trigger
BEFORE INSERT OR UPDATE ON "Article"
FOR EACH ROW EXECUTE FUNCTION article_search_vector_update();

-- Existing articles are indexed without changing their editorial timestamps.
UPDATE "Article" SET "searchVector" = NULL;
CREATE INDEX article_search_vector_idx ON "Article" USING GIN ("searchVector");
CREATE INDEX article_search_title_trgm_idx ON "Article" USING GIN (title gin_trgm_ops);

-- Keep related names current even when the article itself is not edited.
CREATE FUNCTION article_search_related_name_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'Author' THEN
    UPDATE "Article" SET "searchVector" = NULL WHERE "authorId" = NEW.id;
  ELSE
    UPDATE "Article" SET "searchVector" = NULL WHERE "categoryId" = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER article_search_author_name_trigger
AFTER UPDATE OF name ON "Author" FOR EACH ROW
WHEN (OLD.name IS DISTINCT FROM NEW.name)
EXECUTE FUNCTION article_search_related_name_update();
CREATE TRIGGER article_search_category_name_trigger
AFTER UPDATE OF name ON "Category" FOR EACH ROW
WHEN (OLD.name IS DISTINCT FROM NEW.name)
EXECUTE FUNCTION article_search_related_name_update();
COMMIT;
