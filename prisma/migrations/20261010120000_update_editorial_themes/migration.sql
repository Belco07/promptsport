-- WP20 — Mise à jour des thèmes éditoriaux.
--
-- « Transferts » recouvrait « Mercato » (un transfert est un cas particulier du
-- mercato) : le thème est **désactivé**, pas supprimé, pour préserver
-- l'historique. Ses articles sont réaffectés au thème « Mercato » avant que les
-- anciennes associations ne soient supprimées.
--
-- Les quatre nouveaux thèmes (Blessures, Polémiques, Power Ranking, Opinion)
-- sont créés par le seed (`npm run db:seed`), pas ici : la migration ne touche
-- qu'aux données déjà présentes.

-- 1. Désactivation du thème « Transferts ».
UPDATE "Theme" SET active = false, "updatedAt" = CURRENT_TIMESTAMP WHERE slug = 'transferts';

-- 2. Réaffectation des articles vers « Mercato ».
--    La garde sur `mercato` évite d'insérer un `B` NULL si le thème n'existe pas
--    (base neuve où le seed n'a pas encore tourné) : l'insertion serait alors
--    rejetée par la contrainte NOT NULL et ferait échouer la migration.
INSERT INTO "_ArticleToTheme" ("A", "B")
SELECT j."A", (SELECT id FROM "Theme" WHERE slug = 'mercato')
FROM "_ArticleToTheme" j
WHERE j."B" = (SELECT id FROM "Theme" WHERE slug = 'transferts')
  AND EXISTS (SELECT 1 FROM "Theme" WHERE slug = 'mercato')
ON CONFLICT DO NOTHING;

-- 3. Suppression des associations devenues obsolètes.
DELETE FROM "_ArticleToTheme" WHERE "B" = (SELECT id FROM "Theme" WHERE slug = 'transferts');
