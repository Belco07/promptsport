-- Migration WP34 : ajoute le champ color sur le modèle Competition.
ALTER TABLE "Competition" ADD COLUMN "color" TEXT;
