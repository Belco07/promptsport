# Rapport — Suivis lecteurs et Mon Sport

Date : 10 octobre 2026.

## Résultat

La page `/mon-sport` est disponible pour les comptes connectés. Elle affiche les
actualités des favoris, les vingt prochains matchs et les vingt derniers résultats
des clubs suivis, ainsi que les classements des compétitions suivies.

Les clubs et compétitions peuvent être suivis depuis `/competition/[slug]`.
Le bouton affiche « Suivre » ou « Suivi » et permet de retirer le suivi.
Une invitation et des liens de découverte apparaissent sans club suivi.
La liste des clubs suivis est ajoutée à `/mon-compte`, avec « Ne plus suivre ».
« Mon Sport » est accessible dans la navigation et le menu utilisateur connecté.

## Modèle et migration

Le projet utilise `Author` pour les comptes lecteurs (rôle `READER`) : il ne possède
pas de modèle `Reader`. Après accord pour cette adaptation, les relations
`followedTeams` et `followedCompetitions` ont été ajoutées à `Author`, avec leurs
relations inverses sur `Team` et `Competition`.

Migration appliquée : `20261010150000_add_reader_follows`.
Elle crée les deux tables de jointure et ajoute le type `ARTICLE_PUBLISHED`.
Les préférences de compétition déjà présentes ont été reprises. Un trigger garde
la relation compatible avec les écrans d’accueil et de préférences existants.

## Actualités et notifications

Les actualités sont sélectionnées par mention du nom ou du nom court du favori
dans le titre. La recherche utilise des mots complets : « Inter » ne correspond
pas à « Interview ». Elle retourne au maximum dix articles publiés par favori,
supprime les doublons et conserve le tri chronologique.

Les lecteurs qui suivent un club mentionné reçoivent une notification in-app lors
de la publication, qu’elle se fasse à la création, à l’édition ou via le sélecteur
de statut. Les brouillons et les simples corrections d’articles déjà publiés ne
déclenchent pas d’alerte. Les rappels répétés pour le même lien sont dédupliqués,
avec un verrou transactionnel par article. L’auteur ne se notifie pas lui-même.
Aucun e-mail n’est envoyé par ce nouveau parcours.

Le contenu intégral des articles premium n’est jamais chargé par le fil personnalisé.
Les cartes utilisent les métadonnées et les composants existants.

## Vérifications

- `prisma validate` : réussi.
- `prisma migrate deploy` : réussi.
- `prisma generate` : réussi.
- `npm run build` : réussi, route `/mon-sport` incluse.
- 33 contrôles sur PostgreSQL : authentification des actions, suivis idempotents,
  retrait des suivis, indépendance des comptes, préférences existantes, limite de
  dix articles, confidentialité premium, alertes et trois parcours de publication.
  Tous les jeux de données de ces contrôles ont été annulés par transaction.
- Contrôles HTTP sur `http://localhost:3002` : redirection des visiteurs anonymes,
  session lecteur, page sans favoris puis avec favoris, compétition et compte.
  Le compte temporaire a été supprimé après vérification.
- Empreintes avant/après identiques pour les 6 compétitions, 111 équipes et
  1 889 matchs. Aucune préférence existante manquante après la migration.

Le serveur de développement a été redémarré uniquement sur le port 3002 pour
charger le nouveau client Prisma. Le projet sur le port 3000 n’a pas été touché.

## Limites de ce lot

La correspondance éditoriale repose sur les noms présents dans le titre ; les
surnoms et variantes qui ne figurent pas dans les noms des clubs ne sont pas
déduits automatiquement. Les alertes au démarrage des matchs restent le lot
optionnel WP19. Le style utilise les tokens clair/sombre existants ; le contrôle
réalisé ici couvre le rendu HTTP, sans inspection visuelle automatisée.
