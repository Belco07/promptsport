# Rapport WP16a — Modèle de données Themes

## Objectif

Séparer les **thèmes éditoriaux** (Mercato, Tactique, Interviews…) des
**catégories sportives** (Football, Rugby…) : un modèle `Theme` avec relation
many-to-many vers `Article`, cinq thèmes par défaut, et une page
`/backoffice/themes`.

## Fichiers

| Fichier | Nature |
| --- | --- |
| `prisma/schema.prisma` | modifié — modèle `Theme` + `themes Theme[]` sur `Article` (many-to-many implicite) |
| `prisma/migrations/20261008122615_add_theme_model/migration.sql` | **créé** — table `Theme` + table de jointure `_ArticleToTheme` |
| `prisma/seed.cjs` | modifié — les 5 thèmes par défaut (idempotent, clé = `slug`) |
| `src/lib/themes.ts` | **créé** — helpers d'affichage (badge, contraste, normalisation hexadécimale) |
| `src/app/backoffice/themes/page.tsx` | **créé** — liste des thèmes |
| `src/app/backoffice/BackofficeNav.tsx` | modifié — lien « Thèmes » (voir écart 1) |
| `scripts/check-wp16a.cjs` | **créé** — suite de vérification (32 contrôles) |

Le modèle `Category` n'a pas été touché.

## Modèle de données

```prisma
model Theme {
  id          String   @id @default(cuid())
  name        String
  slug        String   @unique
  description String?
  color       String?   // code hexadécimal du badge, ex. "#d7ff00"
  icon        String?   // nom d'icône lucide, ex. "Repeat"
  active      Boolean  @default(true)

  articles Article[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

`Article` reçoit `themes Theme[]`. La relation est **implicite** : Prisma crée et
maintient la table de jointure `_ArticleToTheme` (`A` = article, `B` = thème),
avec index sur `B` et clés étrangères `ON DELETE CASCADE`.

## Migration

`prisma/migrations/20261008122615_add_theme_model/migration.sql` :

- `CREATE TABLE "Theme"` (colonnes du modèle, `active` par défaut à `true`) ;
- `CREATE TABLE "_ArticleToTheme"` avec clé primaire composite `(A, B)` ;
- index unique sur `Theme.slug`, index sur `_ArticleToTheme.B` ;
- clés étrangères vers `Article` et `Theme`, en cascade.

Appliquée sans erreur, puis client Prisma régénéré.

## Thèmes par défaut (seed)

| Nom | Slug | Couleur | Icône |
| --- | --- | --- | --- |
| Mercato | `mercato` | `#d7ff00` | `Repeat` |
| Tactique | `tactique` | `#3b82f6` | `ClipboardList` |
| Interviews | `interviews` | `#a855f7` | `Mic` |
| Compétitions | `competitions` | `#f59e0b` | `Trophy` |
| Transferts | `transferts` | `#10b981` | `ArrowLeftRight` |

Le seed est idempotent (le `slug` sert de clé) : `npm run db:seed` peut être
relancé sans créer de doublon. Vérifié : 5 thèmes en base, tous actifs.

## Page backoffice

`/backoffice/themes` — tableau **nom** (badge à la couleur du thème, description
en dessous), **slug**, **nombre d'articles** (`_count.articles`), **actif**.
Accès réservé aux ADMIN par le layout existant (vérifié : JOURNALIST redirigé
vers `/studio`, visiteur vers `/login`). Le lien « Thèmes » est présent dans la
sidebar.

## Écarts assumés par rapport au brief

1. **`src/app/backoffice/BackofficeNav.tsx` modifié** (absent de la liste
   autorisée). Le brief prévoyait d'ajouter le lien dans `layout.tsx`, mais la
   sidebar est un composant distinct (`BackofficeNav.tsx`) rendu par ce layout :
   sans le modifier, le critère « le lien *Thèmes* apparaît dans la sidebar » ne
   peut pas être satisfait. L'ajout se limite à un `<Link>` construit comme les
   six autres entrées (même classe, même état actif, même garde d'hydratation).
2. **Migration générée puis appliquée en deux temps** —
   `prisma migrate dev --create-only` puis `prisma migrate deploy` — au lieu d'un
   `migrate dev` direct : ce dernier peut proposer de **réinitialiser** la base en
   cas de dérive détectée, et la base locale contient les données réelles du
   site. Le résultat est identique (migration appliquée, client régénéré) sans
   aucun risque de perte. À noter : `--skip-generate` n'existe plus dans
   Prisma 7, d'où la génération explicite ensuite.
3. **Suite `scripts/check-wp16a.cjs` ajoutée** (32 contrôles), comme pour chaque
   lot précédent : elle ne modifie aucun fichier produit, seulement la
   vérification.
4. **`src/lib/themes.ts` sans dépendance au client Prisma** : les helpers
   acceptent un type structurel (`{ color?, active? }`), ce qui les rend
   utilisables aussi bien côté serveur que côté client — et directement
   réutilisables par les WP16c/WP16d.

## Vérifications

| Contrôle | Résultat |
| --- | --- |
| `npm run build` | **réussi** |
| `npx tsc --noEmit` | exit 0 |
| `npx eslint` sur les fichiers WP16a | exit 0, aucun avertissement |
| `npm run db:seed` | 5 thèmes créés (relançable sans doublon) |
| `check-wp16a` (nouvelle suite) | **32/32** |
| `check-wp15d` | 36/36 |
| `check-public-pages` | 11/11 |
| `check-reader-flow` | 14/14 |
| `check-wp4` (séparation studio / backoffice) | 22/22 |

Détail des 32 contrôles de `check-wp16a` :

- **schéma** : modèle `Theme` et ses 9 champs, `slug` unique, `active` par défaut,
  liste `articles`, relation `themes` sur `Article`, jointure implicite (aucun
  modèle `_ArticleToTheme` déclaré), modèle `Category` sans champ thème ;
- **migration** : dossier `*_add_theme_model`, table `Theme`, table
  `_ArticleToTheme`, clés étrangères ;
- **seed** : les 5 slugs déclarés, mise à jour idempotente ;
- **helpers** : `themeBadgeStyle`, `themeTextColor`, `normaliseThemeColor`,
  couleur de repli ;
- **backoffice** : page créée, colonnes attendues, comptage `_count`, lien de
  sidebar ;
- **base** : migration appliquée (table `_prisma_migrations`), 5 thèmes, tous
  actifs, **association réelle d'un article à deux thèmes** puis nettoyage,
  comptage par thème calculable ;
- **HTTP** : ADMIN 200 avec les 5 thèmes, les 4 en-têtes et le lien de sidebar ;
  JOURNALIST redirigé ; visiteur redirigé vers `/login`.

## Points ouverts

- La page liste les thèmes ; **création et édition** ne sont pas demandées par ce
  lot (aucun formulaire, aucune Server Action ajoutés).
- **Association article ↔ thème** : possible dès maintenant en base (vérifié) et
  depuis Prisma Studio ; l'interface d'édition arrive avec le WP16b, l'affichage
  public avec les WP16c/WP16d.
