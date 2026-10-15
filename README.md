# promptsport

## WP19a-bis — AllSportsApi (RapidAPI) : fournisseur actif

API-Football est **en pause** : son offre gratuite ne couvre que les saisons
2022-2024, pas la saison en cours. Le fournisseur retenu après validation est
**AllSportsApi**, consommé via RapidAPI.

```bash
node scripts/test-allsports.cjs                      # Phase 1 : valide 3 endpoints
npx tsx scripts/sync-football.ts --dry-run           # Phase 2 : prépare sans écrire
```

Validation du 09/10/2026 (15/15) : 272 catégories, 13 ligues françaises,
**Ligue 1 = tournoi 34**, saison **26/27** (id 96127), 18 équipes, 60 matchs
analysés avec scores, **260 matchs en direct** détectés (`/api/matches/live`),
quota 100/jour suivi par l'en-tête `x-ratelimit-requests-remaining`.

| Point | Valeur |
| --- | --- |
| Hôte | `allsportsapi2.p.rapidapi.com` (en-têtes `x-rapidapi-key` / `x-rapidapi-host`) |
| Clé | `ALLSPORTS_API_KEY` dans `.env` (plan Basic gratuit) |
| Débit | 5 requêtes/seconde, 100 requêtes/24 h (registre local partagé) |
| Service | `src/lib/allsports-sync.ts` (`syncCompetition`, `syncAllCompetitions`) |
| Repli | `src/lib/api-football-sync.ts` conservé, non utilisé par le script |
| Identifiants | FL1=34, PL=17, PD=8 (LaLiga), SA=23, BL1=35, CL=7 |

Les hôtes `allsportsapi.com` et `apiv2.allsportsapi.com` **rejettent** cette clé
(« Wrong login credentials ») : l'accès se fait obligatoirement par RapidAPI. Les
équipes n'exposent pas d'URL de logo exploitable côté navigateur (les images
passent par `/api/team/{id}/image`, derrière l'authentification) : `logoUrl`
reste `null` et l'interface affiche son visuel de repli.

### Bascule des données existantes — à confirmer

Les compétitions, équipes et matchs actuels viennent de football-data.org
(identifiants 2001-2021). `assertMigrated()` dans `allsports-sync.ts` **refuse**
d'écrire par-dessus : la bascule doit être confirmée explicitement, avec
sauvegarde préalable. En attendant, `--dry-run` permet de tout vérifier sans
toucher à la base.

## WP19a — API-Football (API-Sports direct)

La synchronisation sportive utilisait API-Football v3 via
`https://v3.football.api-sports.io` avec l'en-tête `x-apisports-key`. L'ancien module `football-sync.ts`
est une passerelle dépréciée vers `api-football-sync.ts` : même les actions du
backoffice utilisent le nouveau fournisseur, sans changer leurs signatures.
Les textes historiques du backoffice restent inchangés (hors périmètre WP19a).
Ce service reste disponible comme repli (voir le lot précédent ci-dessus).


### Compte et configuration

1. Créer un compte sur [API-Football](https://dashboard.api-football.com/) et confirmer l'adresse e-mail.
2. Vérifier le plan et son quota dans le tableau de bord ou via `/status`.
   Le plan gratuit est activé à l'inscription confirmée ; les saisons accessibles sont limitées.
   Une clé RapidAPI n'est pas interchangeable avec une clé API-Sports directe.
3. Copier la clé depuis **Account → My Access** dans `.env` : `API_FOOTBALL_KEY="votre-cle"`.
   Ne jamais publier ce fichier ni la clé dans les journaux.

Le [plan gratuit annoncé par API-Football](https://www.api-football.com/pricing)
offre 100 requêtes/jour mais limite les saisons disponibles. La saison courante
est choisie depuis `/leagues` ; si elle est inaccessible, la synchronisation
échoue explicitement, sans importer silencieusement une saison ancienne.
Pour une base de développement historique, définir volontairement
`API_FOOTBALL_SEASON=2024` (exemple, à vérifier avec votre abonnement).
Cette option ne rend pas accessibles les saisons exclues du plan.

### Migration initiale — destructive, à approuver

```bash
npx tsx scripts/migrate-sports-data.ts                 # simulation, sans API ni écriture
npx tsx scripts/migrate-sports-data.ts --confirm-reset # seulement après accord
```

Le second appel télécharge et valide les six jeux de données **avant** toute
suppression. Une erreur de clé, de quota ou de saison interrompt la migration.
Ensuite, il verrouille les tables sportives, écrit une sauvegarde JSON complète
dans `backups/sports-before-api-football-*.json` (dossier ignoré par Git), puis
remplace Match, Team et Competition dans une seule transaction PostgreSQL.
Une erreur d'import annule toute la transaction. Les autres tables ne sont pas
modifiées. Les anciens identifiants internes de matchs/équipes disparaissent :
les anciens liens `/match/<id>` et les favoris dépendant d'identifiants supprimés
peuvent devenir obsolètes. Conserver la sauvegarde pour une restauration contrôlée.
Redémarrer le serveur après migration afin de renouveler les caches sportifs.

### Synchronisation et mapping

```bash
npx tsx scripts/sync-football.ts        # les six compétitions
npx tsx scripts/sync-football.ts FL1 PL # codes historiques compatibles
npx tsx scripts/sync-football.ts 61 39  # IDs API-Football équivalents
```

| Code | Ligue | ID API-Football |
|---|---|---|
| FL1 | Ligue 1 | 61 |
| PL | Premier League | 39 |
| PD | La Liga | 140 |
| SA | Serie A | 135 |
| BL1 | Bundesliga | 78 |
| CL | Champions League | 2 |

`fetchCompetitions()`, `fetchTeams(leagueId, season)` et
`fetchMatches(leagueId, season, from, to)` utilisent `/leagues`, `/teams` et
`/fixtures`. `syncCompetition(code)` et `syncAllCompetitions()` enregistrent
les noms, pays, saisons, logos, horaires, scores et stades dans le schéma existant.
Les `externalId` sont les IDs numériques API-Football convertis en chaînes.
Chaque compétition est importée atomiquement ; les autres continuent après une
erreur. Le CLI retourne un code non nul même en cas d'échec partiel.

Statuts : NS/TBD → programmé ; 1H/HT/2H/ET/BT/P/LIVE → direct ;
FT/AET/PEN/AWD/WO → terminé ; PST/SUSP/INT → reporté ; CANC/ABD → annulé.
Un statut inconnu annule l'import plutôt que d'inventer son état.
Les matchs importés couvrent toute la saison sélectionnée, passée et à venir.
Le classement existant est calculé localement, pas depuis `/standings` : les
sanctions et règles particulières de certaines compétitions ne sont pas importées.
Les compositions/statistiques/événements détaillés ne sont pas stockés dans WP19a.

### Quotas et exploitation

- Aucun ajout de bibliothèque ; `fetch` natif, délai maximal de 30 secondes.
- Au moins 7 secondes entre réservations de requêtes. Un registre par empreinte
  SHA-256 de clé dans le répertoire temporaire du système partage cette limite
  entre les processus locaux, avec un plafond conservateur de 100 appels/24 h.
  Les erreurs comptent également. Aucune clé n'est écrite dans ce registre.
- Le cache mémoire mutualise les appels simultanés : 5 minutes pour ligues/équipes,
  30 secondes pour les matchs. Une synchronisation fraîche des six ligues coûte
  normalement 13 requêtes (1 catalogue, 6 équipes, 6 calendriers).
- Le registre est local à une machine. Plusieurs hôtes/serverless et les appels
  réalisés dans le tableau de bord API-Sports partagent le quota distant, mais pas ce registre local :
  n'exécuter qu'un seul ordonnanceur. Le quota fournisseur reste l'autorité.
- Les erreurs HTTP et les erreurs incluses dans une réponse HTTP 200 sont prises
  en compte. Pas de boucle de retry automatique consommant le quota.
- Ne pas lancer l'ancien et le nouveau fournisseur en parallèle. Les données
  héritées sont détectées avant import pour éviter les collisions d'identifiants.
- L'endpoint cron sportif reste hors périmètre et sera traité dans WP19b.

Référence : [documentation API-Football v3](https://www.api-football.com/documentation-v3).

Site d'actualité sportive (Next.js 15, App Router) : pages publiques, studio
rédactionnel, backoffice d'administration, abonnements Stripe et analytique
maison respectueuse de la vie privée.

## Démarrer

Prérequis : Node 20+, et une base **PostgreSQL** (voir « Base de données » plus
bas pour le conteneur Docker de développement).

```bash
cp .env.example .env        # À FAIRE AVANT npm install (voir la note ci-dessous)
npm install
npm run db:deploy           # applique les migrations sur PostgreSQL
npm run dev -- -p 3002      # http://localhost:3002
```

> **Ordre important** : `npm install` déclenche `postinstall: prisma generate`
> (WP12b), et `prisma.config.ts` lit `DATABASE_URL` au chargement — sans `.env`,
> l'installation s'arrête sur
> `PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL`.
> Créez donc `.env` en premier (ou lancez `npm run db:generate` après l'avoir
> créé). Sur Vercel, les variables sont déjà présentes pendant l'installation :
> ce cas ne s'y produit pas.

Le port 3000 est occupé par un autre projet ; promptsport tourne sur **3002**.

Production locale :

```bash
npm run build
npm run start -p 3003
```

## Structure

- `src/app` — pages publiques : accueil, `article/[slug]`, `scores`,
  `competition/[slug]`, `match/[id]`, `abonnement`, `mon-compte`
  (dont `mon-compte/notifications`), `auteur/[slug]`, `mentions-legales`,
  `confidentialite`
- `src/app/studio` — rédaction (ADMIN, EDITOR, JOURNALIST)
- `src/app/backoffice` — administration (ADMIN), dont `/backoffice/comments`
  (commentaires et signalements, WP10a)
- `src/components` — composants partagés ; `src/components/ui` — design system
- `src/lib` — accès Prisma, authentification, SEO, analytique, engagement
- `prisma/schema.prisma` + `prisma/migrations` — base **PostgreSQL**
- `scripts/check-*.cjs` — suites de vérification (à lancer avec `PORT=3002`)
- `scripts/lib/pg-sync.cjs` — passerelle synchrone vers PostgreSQL pour les suites

## Base de données (WP12a — PostgreSQL)

La base est **PostgreSQL**, en développement comme en production. Le passage
depuis SQLite a laissé trois particularités à connaître.

### Conteneur de développement

```bash
docker run -d --name promptsport-pg \
  -e POSTGRES_USER=promptsport -e POSTGRES_PASSWORD=promptsport \
  -e POSTGRES_DB=promptsport -p 5432:5432 \
  -v promptsport-pgdata:/var/lib/postgresql/data postgres:17-alpine
docker start promptsport-pg     # aux démarrages suivants
```

`DATABASE_URL` correspond alors à
`postgresql://promptsport:promptsport@localhost:5432/promptsport?schema=public`.

### Migration de données depuis l'ancienne base SQLite

Le schéma SQLite d'origine est conservé uniquement comme **source** de la
migration ponctuelle (`SQLITE_DATABASE_URL` dans `.env`) :

```bash
npm run db:migrate-sqlite-to-postgres   # recopie et vérifie les comptages
```

Le script relit chaque table SQLite, vide les tables PostgreSQL
(`TRUNCATE … RESTART IDENTITY CASCADE`) puis réinsère ligne par ligne, en
convertissant les booléens SQLite (0/1) et les colonnes JSON. Il affiche un
tableau de comptage SQLite/PostgreSQL et sort en erreur si les totaux diffèrent.
Les horodatages sont des `TIMESTAMP(3)` **naïfs contenant de l'UTC** : les
décalages de fuseau sont conservés à l'identique, et Prisma écrit comme il lit en
UTC (`@prisma/adapter-pg` convertit les `Date` avec leurs composants UTC).

### Migrations et dérive de schéma

```bash
npm run db:deploy    # prisma migrate deploy (production et développement)
npm run db:studio    # Prisma Studio
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
```

La dernière commande doit répondre `No difference detected` (code 0) : elle
vérifie que la base réellement migrée correspond au schéma Prisma.

### Piège à connaître : l'import de l'adaptateur PostgreSQL

`@prisma/adapter-pg` (et donc `pg`) **doit être chargé paresseusement** dans
`src/lib/prisma.ts` :

```ts
const { PrismaPg } = require("@prisma/adapter-pg") as typeof import("@prisma/adapter-pg");
```

Un `import` statique fait évaluer `pg` dans toutes les couches du bundle, y
compris celle qui charge les modules de Server Actions référencés par un
composant client. L'évaluation y échoue et **toutes** les Server Actions de la
page répondent alors 500 avec
`TypeError: Cannot read properties of undefined (reading 'bind')`, alors que les
pages en lecture (GET) fonctionnent normalement. Le chargement paresseux
n'évalue `pg` qu'à la création réelle du client, côté serveur.

### Suites de vérification

Les suites `scripts/check-*.cjs` ont été écrites pour l'API **synchrone** de
better-sqlite3 et s'appuyaient sur son dialecte. Elles passent désormais par
`scripts/lib/pg-sync.cjs`, qui conserve la même API (`prepare`, `get`, `all`,
`run`, `pragma`) en exécutant les requêtes dans un fil dédié (`Atomics.wait` +
`receiveMessageOnPort`) et adapte le dialecte :

- `?` → `$1, $2, …` ; identifiants camelCase mis entre guillemets ;
- booléens : `col = 0` → `col = false`, paramètre `0/1` → `($n::int <> 0)` ;
- `PRAGMA table_info(X)` → `information_schema.columns` ;
- `sqlite_master` → `information_schema.tables` / `pg_indexes` ;
- `datetime('now')` → `now()`, `substr(date, 1, 10)` → `substr("date"::text, 1, 10)` ;
- valeurs relues : booléens en 1/0, horodatages en texte ISO, JSON en texte brut
  (comme le faisait better-sqlite3).

```bash
PORT=3002 node scripts/check-wp11a.cjs
```

## Déploiement (WP12b — Vercel + Prisma Postgres)

Le site se déploie sur **Vercel**, avec la base **Prisma Postgres** (PostgreSQL managé).
La configuration versionnée vit dans `vercel.json` ; la marche à suivre complète
(avec cases à cocher) est dans [`scripts/deploy-checklist.md`](scripts/deploy-checklist.md).

### 1. Dépôt GitHub

```bash
git init
git add .
git commit -m "promptsport : site d'actualité sportive"
git branch -M main
git remote add origin https://github.com/<compte>/<dépôt>.git
git push -u origin main
```

`.gitignore` exclut `.env`, `node_modules/`, `.next/`, `prisma/*.db`, le client
Prisma généré (`src/generated/`), les sauvegardes locales et les journaux.
`.env.example` est **versionné** : c'est le modèle des variables d'environnement.
Vérifier avant de pousser qu'aucun secret ne part :

```bash
git status --porcelain | Select-String '\.env'   # ne doit rien afficher d'autre que .env.example
git check-ignore -v .env                          # doit confirmer l'exclusion
```

### 2. Projet Vercel

1. Créer un compte sur <https://vercel.com/signup> et lier le compte GitHub.
2. **Add New Project** → importer le dépôt.
3. Framework Preset : **Next.js** ; Root Directory : `.` ; Output Directory :
   `.next` (défauts). La commande de construction est lue dans `vercel.json` :
   `prisma generate && next build`.
   *(Le build local utilise `next build --turbopack` ; la commande Vercel est
   volontairement sans Turbopack pour rester sur le chemin de build standard.)*
4. Déployer. Le premier déploiement peut échouer : les variables d'environnement
   ne sont pas encore définies, c'est attendu.

### 3. Variables d'environnement Vercel

Settings → Environment Variables, en cochant **Production** et **Preview**.

| Variable | Valeur |
| --- | --- |
| `DATABASE_URL` | chaîne **pooled** de Prisma Postgres (`pooled.db.prisma.io`), avec `?sslmode=require` |
| `DIRECT_URL` | chaîne **directe** de Prisma Postgres (`db.prisma.io`), pour les migrations, le seed des thèmes et Prisma Studio |
| `AUTH_SECRET` | secret de signature des JWT (`openssl rand -base64 32`) |
| `NEXT_PUBLIC_SITE_URL` | `https://<projet>.vercel.app` (sans barre oblique finale) |
| `CRON_SECRET` | secret du cron (`openssl rand -base64 32`) |
| `ALLSPORTS_API_KEY` | clé RapidAPI AllSportsApi utilisée par les synchronisations |
| `FOOTBALL_DATA_API_KEY` | ancienne page `/backoffice/sports/sync` uniquement, facultative et inutile pour AllSports |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | identifiants OAuth Google, facultatifs |
| `AUTH_FACEBOOK_ID`, `AUTH_FACEBOOK_SECRET` | identifiants OAuth Facebook, facultatifs |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | clés Stripe (test ou live) |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME` | envoi des e-mails |

Deux remarques sur les noms : le code lit `AUTH_SECRET` (Auth.js v5 accepte
`NEXTAUTH_SECRET` comme ancien nom, sans que ce projet en dépende) et
`ALLSPORTS_API_KEY` pour le fournisseur sportif actif. `AUTH_URL` / `NEXTAUTH_URL`
sont inutiles ici : `trustHost: true` déduit l'URL de la requête.

### 4. Migrations en production

`prisma migrate deploy` doit passer par la chaîne **directe** : un pooler en mode
transaction ne conserve pas l'état de session (verrous, `SET`, requêtes
préparées), ce qui produit des échecs de migration difficiles à lire.

`prisma.config.ts` applique donc une règle unique : la CLI prend **`DIRECT_URL`
si elle est renseignée**, sinon `DATABASE_URL` (poste local, CI, ou Vercel où
seule `DATABASE_URL` existe). Aucune substitution manuelle n'est nécessaire :

```bash
npm run db:deploy
```

Avant de déployer, lancer le préflight (§4 ter) : il vérifie en quelques
secondes la chaîne de connexion, le serveur, les migrations en attente et
l'extension `pg_trgm`.

`postinstall: prisma generate` régénère le client Prisma à chaque installation :
c'est indispensable sur Vercel, où `src/generated/` n'est pas versionné.
Ne jamais utiliser `prisma migrate dev` en production.

### 4 bis. Thèmes éditoriaux en production

Les migrations créent la table `Theme` mais **pas son contenu** : une base
fraîchement migrée n'a aucun thème, donc `/themes` est vide et le sélecteur du
studio n'affiche rien. Le seed complet (`npm run db:seed`) ne convient pas : il
crée aussi un compte `admin@example.com` avec un mot de passe connu. Un seed
ciblé existe donc pour la production :

```bash
npm run db:seed:themes
```

- il n'écrit **que** dans `Theme` : aucun auteur, aucun mot de passe, aucune
  donnée existante supprimée ;
- il est **idempotent** (clé = `slug`) : relançable sans doublon, et il met à
  jour nom, description, couleur, icône et `active` — c'est ce qui propage la
  désactivation de « Transferts » (WP20) sur une base déjà remplie ;
- les 9 thèmes par défaut sont décrits dans `prisma/default-themes.cjs`, source
  unique partagée avec `prisma/seed.cjs` ;
- il vise `DIRECT_URL` en priorité (même règle que `prisma.config.ts`, donc
  `db:deploy` et `db:seed:themes` ne peuvent pas diverger de base) ; la chaîne
  directe est de toute façon préférable, le script exécutant `SET TIME ZONE 'UTC'`,
  un ordre de session que le pooler ne garantit pas. Les suites `check-*.cjs`,
  elles, restent sur `DATABASE_URL` : elles écrivent des données de test ;
- `npm run db:seed:themes -- --dry-run` affiche les créations/mises à jour sans
  rien écrire, et `--quiet` ne garde que le bilan.

Résultat attendu : `9 thème(s) en base, 8 actif(s)` (« Transferts » inactif).

### 4 ter. Préflight Prisma Postgres

À lancer **avant** `db:deploy` : une migration qui échoue en production laisse
une entrée « failed » dans `_prisma_migrations`, à rattraper à la main
(`prisma migrate resolve`). Le contrôle tient en une commande :

```bash
node scripts/check-prisma-postgres.cjs
```

Il vise `DIRECT_URL` (sinon `DATABASE_URL`, sinon une URL passée en argument) et
vérifie : schéma de l'URL (une URL `prisma+postgres://` est refusée), connexion
au serveur, TLS, base/utilisateur/schéma, migrations appliquées **et en attente**
(comparées au dossier `prisma/migrations`), présence des thèmes, et disponibilité
de `pg_trgm` — requise par la migration `20261008160000_article_search`.

L'essai de création de `pg_trgm` est exécuté dans une transaction **annulée**
(`BEGIN … ROLLBACK`) : la base n'est jamais modifiée (`--no-extension` pour
l'éviter complètement). Sortie : `OK | …`, `ECHEC | …`, `ATTENTION | …` puis
`RESULTAT: n/N`, et un code de sortie 1 dès qu'un contrôle échoue.

### 5. Tâches planifiées

`vercel.json` déclare un cron quotidien (les horaires sont en **UTC**) :

```json
{ "crons": [{ "path": "/api/cron/newsletter", "schedule": "0 6 * * *" }] }
```

Vercel ajoute automatiquement l'en-tête `Authorization: Bearer $CRON_SECRET` aux
appels du planificateur ; la route `/api/cron/newsletter` refuse tout appel sans
jeton valide (503 si le secret n'est pas configuré, 401 si le jeton est faux).

La **synchronisation sportive** ne peut pas être un cron Vercel : elle n'existe
que sous forme de Server Action du backoffice et de script CLI
(`npm run sync:football`), et le plan Hobby limite de toute façon les crons à une
exécution quotidienne. Deux solutions documentées dans la checklist :
GitHub Actions (recommandé, gratuit, horaire) ou un service externe type
cron-job.org. Le workflow prêt à copier se trouve dans
`scripts/deploy-checklist.md`.

### 6. Vérifications après déploiement

- `/` affiche les articles ; `/scores`, `/competition/<slug>`, `/match/<id>` répondent 200 ;
- `/login` connecte `admin@example.com` ; `/studio/articles/new` publie un article ;
- un commentaire se poste sur un article ; l'inscription newsletter répond 200 ;
- `/sitemap.xml`, `/robots.txt` et `/rss.xml` sont servis ;
- `https://<projet>.vercel.app/api/cron/newsletter` avec l'en-tête
  `Authorization: Bearer <CRON_SECRET>` renvoie `{"ok":true,…}` ;
- l'onglet **Logs** de Vercel ne montre aucune erreur 500.

### Limites connues du plan Hobby

- Crons : 2 tâches maximum, une exécution par jour (d'où le cron unique +
  GitHub Actions pour la synchronisation sportive).
- Durée d'exécution d'une fonction : 60 s. Le traitement des campagnes
  planifiées appelle l'API Resend pour chaque destinataire : au-delà de quelques
  centaines d'abonnés, prévoir le plan Pro (300 s) ou un envoi découpé.

## Engagement (WP10a)

Quatre modèles : `Comment` (réponses imbriquées, statut, `editedAt`),
`CommentReaction` et `ArticleReaction` (une réaction par auteur et par cible),
`Report` (un signalement par auteur et par commentaire). Les suppressions
suivent le contenu (`ON DELETE CASCADE`) ; `Report.resolvedById` repasse à NULL
si le compte du modérateur disparaît.

- Interface d'administration : `/backoffice/comments` (onglets Commentaires et
  Signalements, actions « Supprimer » — suppression douce, statut DELETED — et
  « Résoudre »).
- Aucune interface publique pour l'instant (WP10b) ; la modération complète
  (approbation, rejet, notifications) relève des WP10c/WP10d.
- Créer des données de test : `npm run db:studio` (Prisma Studio).

## Design system

- **Palette et typographie** : `tailwind.config.js` est la source unique
  (échelles `primary`, `accent`, `success`, `danger`, `neutral`, familles
  `font-sans` / `font-display`, ombres de carte, largeur de lecture).
- Tailwind CSS v4 se configure en CSS : le fichier JS n'est lu que parce que
  `src/app/globals.css` le déclare (`@config "../../tailwind.config.js";`).
  Le chemin est relatif à la feuille de style — une erreur ici casse tout le
  build avec « Can't resolve ».
- Dans les styles écrits à la main, référencer la palette avec la fonction
  `theme(--color-primary-600)` et **non** `var(--color-primary-600)` : v4 n'émet
  de variables CSS que pour les clés utilisées par une classe utilitaire.
- **Police** : Inter, auto-hébergée par `next/font/google` (aucune requête vers
  Google au chargement), variable `--font-inter` consommée par la config.
- **Composants** : `Button`, `Badge`, `Card`, `Input`, `Textarea`, `Select`
  dans `src/components/ui`. Les icônes viennent de `lucide-react`.
- `/studio` et `/backoffice` gardent leur apparence d'origine, à une exception
  près : la page de modération `/backoffice/comments` utilise les composants du
  design system, comme le demandait son brief.

## Emplacements publicitaires

`src/components/AdSlot.tsx` réserve la place d'un emplacement commercial, dans
deux formats : `banner` (bandeau large, ratio 1838 × 340) et `rectangle`
(encart latéral 300 × 250). Ce n'est **pas** un script de régie : le bloc impose
son ratio plutôt qu'une hauteur en pixels, pour que la surface soit identique à
toutes les largeurs d'écran et qu'aucun contenu ne se décale le jour où une
annonce est servie (protection du CLS mesuré au WP8c). Aucun JavaScript n'est
chargé par l'emplacement lui-même.

| Page | Position | Format |
| --- | --- | --- |
| Accueil (`src/app/page.tsx`) | sous la manchette, avant la une | `banner` |
| Accueil, colonne de droite | sous le fil info et l'encart abonnement | `rectangle` |
| Article (`src/app/article/[slug]/page.tsx`) | après le corps de l'article | `banner` |
| Scores, Compétition, Match | après l'en-tête (après la fiche pour un match) | `banner` |

### Masquage pour les abonnés premium

`src/components/AdSlotGate.tsx` n'affiche l'emplacement qu'aux visiteurs non
abonnés. Deux chemins, pour une raison de rendu :

- **Pages prérendues** (accueil, scores, compétition, match — `revalidate = 60`) :
  la session est lue **après montage** via `/api/auth/session`, car un `auth()`
  côté serveur rendrait ces pages dynamiques et ferait perdre le prérendu du
  WP8c. L'abonné reçoit donc la place réservée dans le HTML puis la voit
  disparaître.
- **Page article** (déjà dynamique, elle lit la session pour les commentaires) :
  `premium` est passé au composant, le serveur tranche et l'emplacement n'est
  jamais envoyé à l'abonné.

À revoir si une régie facture les impressions : il faudra alors assumer des pages
dynamiques ou activer le rendu partiel (PPR, désactivé dans ce projet).

### Diffuser une annonce

Remplacer le contenu de l'`<aside>` par l'`<ins>` ou l'`<iframe>` du partenaire :
la mise en page ne bouge pas. Le libellé « Publicité » est visible (mention
obligatoire pour une insertion commerciale) et se remplace via la propriété
`label` ; le repère `data-ad-slot="banner" | "rectangle"` permet de compter ou de
cibler les emplacements.

## Rôles et droits éditoriaux

Toute la rédaction voit tous les articles ; les actions dépendent du rôle et de
la propriété de l'article (`canEditArticle`, `canDeleteArticle`,
`canTransitionArticle` dans `src/lib/roles.ts`, appliqués **côté serveur** dans
`src/app/studio/articles/actions.ts`).

| Action | Journaliste auteur | Journaliste non auteur | Éditeur / Admin |
| --- | --- | --- | --- |
| Voir la liste et les articles | oui | oui | oui |
| Éditer le contenu | oui, si l'article n'est pas publié | non | oui |
| Brouillon ↔ En revue | oui, si non publié | non | sur ses propres articles |
| → Publié / Archivé, ou dépublication | non | non | oui |
| Décider du **premium** (réservé aux abonnés) | non | non | oui |
| Supprimer | ses brouillons et articles en revue | non | brouillons et en revue ; publié réservé à l'admin |

Deux règles à retenir : le **brouillon reste l'état de travail de l'auteur** (un
éditeur qui renvoie un article le met « en revue »), et **un article publié sort
du périmètre de son auteur** (il le voit, mais ne peut plus le modifier ni le
supprimer). La suite `scripts/check-workflow-roles.cjs` vérifie cette matrice.

Le **premium** obéit à la même logique que la publication (`canSetPremium` dans
`src/lib/roles.ts`) : il ferme la lecture au-delà de l'extrait, c'est donc un
arbitrage éditorial et commercial. La case n'est proposée qu'aux ADMIN et
EDITOR ; pour les autres, le formulaire affiche l'état sans le modifier, et la
Server Action **conserve la valeur en base** — sans quoi l'enregistrement d'un
brouillon par son auteur retirerait le paywall sans que personne ne l'ait
demandé.

## Modération des commentaires

`/backoffice/comments` (ADMIN) : trois onglets — commentaires (filtres, sélection
multiple, pagination 50), signalements (motif, auteur, précisions) et
utilisateurs (compteurs, bannissement temporaire ou définitif). Les signalements
d'un commentaire sont détaillés directement dans la ligne du commentaire. Côté
public, seuls les commentaires approuvés sont visibles ; un auteur banni ne peut
ni commenter, ni réagir, ni signaler.

## Notifications (WP10d)

Notifier dans l'application, jamais par e-mail ni par notification push : le
modèle `Notification` (destinataire, type, titre, message, lien facultatif, état
de lecture) alimente `/mon-compte/notifications` (filtres « Toutes » / « Non
lues », 20 par page, marquage à l'unité ou en bloc) et un aperçu des cinq
dernières non lues sur `/mon-compte`. Le compteur du menu utilisateur est relu à
chaque navigation via une Server Action — ni temps réel, ni requête périodique.

Les notifications sont créées par les parcours existants, jamais par les pages :
réponse à un commentaire (`createComment` avec `parentId`), réaction à un
commentaire, approbation ou rejet par la modération, traitement d'un
signalement, bannissement et fin de suspension.

- **Échec silencieux** : `src/lib/notifications.ts` attrape ses erreurs et
  renvoie `false` ; une notification impossible ne fait jamais échouer l'action
  de l'utilisateur (dépôt d'un commentaire, réaction, modération).
- **Pas d'auto-notification** : se répondre à soi-même ou réagir à son propre
  commentaire ne crée rien. Le retrait d'une réaction ne notifie pas non plus.
- **Répondre publiquement** : `?repondre=<id>` pré-remplit le formulaire de
  commentaire (champ caché `parentId`), sans JavaScript. Le parent est revalidé
  côté serveur (même article, statut approuvé) ; un parent inconnu est ignoré et
  le commentaire est enregistré à la racine.
- Les actions groupées de modération (`bulkApprove`, `bulkReject`,
  `bulkDelete`) n'envoient volontairement aucune notification.

## Newsletter (WP11a)

Couche de données et consultation : quatre modèles — `NewsletterSubscriber`
(email unique, double opt-in `PENDING` → `CONFIRMED`, jeton de confirmation,
lien optionnel vers un compte), `NewsletterList` (liste thématique, slug unique,
`active`), `NewsletterCampaign` (sujet, contenus HTML et texte, statut, dates,
compteurs destinataires/délivrés/ouvertures/clics/rejets) et `NewsletterSend`
(une ligne par abonné et par campagne, unique sur `[campaignId, subscriberId]`).

- `/backoffice/newsletter` (ADMIN) : deux onglets — abonnés (email, nom, statut,
  origine, date, listes, désabonnement) et campagnes (sujet, liste, statut,
  date d'envoi, destinataires, taux d'ouverture, duplication en brouillon) —
  plus les statistiques demandées : abonnés confirmés, taux de désabonnement,
  campagnes envoyées ce mois. Les panneaux « Voir » sont rendus par la page
  (`?abonne=`, `?campagne=`) : le lot n'ouvre pas de route de détail.
- **Aucun envoi d'e-mail, aucune inscription publique, aucun formulaire de
  campagne** : les données se créent dans Prisma Studio (`npm run db:studio`),
  les envois et les webhooks du fournisseur arrivent avec le WP11b, le
  formulaire public avec le WP11c, la rédaction des campagnes avec le WP11d.
- Suppressions : un abonné emporte ses envois et ses listes, une campagne
  emporte ses envois ; supprimer un compte utilisateur **ne supprime pas** son
  abonnement (le lien `userId` repasse à NULL), et supprimer un auteur qui a créé
  des campagnes est refusé (comme pour ses articles).
- `userId` est **unique** : c'est ce qui rend la relation
  `Author.newsletterSubscriber` « un à un » (une seule ligne d'abonnement par
  compte), comme le demande le brief.

## Envoi et suivi (WP11b)

Resend assure l'expédition ; les interactions (délivrance, ouverture, clic, rejet,
plainte) reviennent par webhook et mettent à jour `NewsletterSend` puis les
compteurs de la campagne.

```bash
# Configuration (voir .env)
RESEND_API_KEY=re_…            # https://resend.com/api-keys
RESEND_FROM_EMAIL=…            # onboarding@resend.dev en sandbox
RESEND_FROM_NAME=…
RESEND_WEBHOOK_SECRET=whsec_…  # Resend > Webhooks, endpoint /api/webhooks/resend

# Expédition en ligne de commande
npm run newsletter:send -- <campaignId>
npx tsx scripts/send-campaign.ts --confirmation <subscriberId>   # double opt-in
npx tsx scripts/send-campaign.ts --welcome <subscriberId>
```

- **Qui reçoit quoi** : seuls les abonnés `CONFIRMED` **membres de la liste** de
  la campagne. Les inscriptions en attente, les désabonnés et les adresses
  rejetées sont écartées ; un clic sur « Se désabonner » suffit à sortir des
  envois suivants.
- **Un échec n'arrête rien** : chaque destinataire a sa ligne `NewsletterSend`,
  marquée `FAILED` avec le motif si le fournisseur refuse, et la boucle continue
  (100 ms entre deux messages). Si aucun envoi n'est accepté, la campagne finit
  en `FAILED` et non en `SENT`.
- **Compteurs recalculés, jamais incrémentés** : un webhook peut être réémis, le
  recalcul à partir des envois rend l'opération idempotente. Le statut d'un envoi
  ne recule jamais (une ouverture signalée après un clic ne rétrograde pas).
- **RGPD** : double opt-in (`/newsletter/confirm/<jeton>`) et désabonnement en un
  clic (`/newsletter/unsubscribe/<jeton>`), plus les en-têtes `List-Unsubscribe`.
  Le jeton est `confirmationToken` (le schéma du WP11a n'a pas de colonne dédiée)
  et n'est jamais effacé, pour que les liens restent valables.
- **Limite connue** : la page de désabonnement agit en GET, comme le demande le
  brief. Certains antivirus et scanners de messagerie ouvrent les liens des
  e-mails : ils peuvent donc désabonner à l'insu de l'abonné. À arbitrer au WP11c
  (bouton de confirmation, ou POST).
- **Sans clé, l'application ne plante pas** : elle consigne l'échec et marque les
  envois `FAILED`. Le bouton « Envoyer la campagne » du backoffice reste
  utilisable et affiche le compte rendu.

### Vérifier sans compte Resend

`scripts/check-wp11b.cjs` démarre un **serveur Resend factice** local et pointe
l'API dessus par `RESEND_BASE_URL` (variable optionnelle, réservée aux tests) :

```bash
node scripts/check-wp11b.cjs          # lance le stub, le CLI et les webhooks signés
```

Pour exercer l'application elle-même (Server Action du backoffice) contre ce
serveur factice, lancer le serveur de développement avec ces deux variables :

```bash
RESEND_API_KEY=re_stub_local_test RESEND_BASE_URL=http://127.0.0.1:3100 npm run dev -- -p 3002
```

## Inscription publique et préférences (WP11c)

Quatre surfaces publiques, toutes en lecture seule tant qu'un bouton n'a pas été
actionné :

| Route | Rôle |
| --- | --- |
| `/newsletter` | formulaire d'inscription : e-mail, nom facultatif, listes, consentement RGPD |
| `/newsletter/confirm/<jeton>` | confirme l'adresse (double opt-in) et propose la gestion des préférences |
| `/newsletter/preferences/<jeton>` | choisir ses listes, se réabonner après un désabonnement |
| `/newsletter/unsubscribe/<jeton>` | désabonnement **après confirmation** (bouton, Server Action) |

- **Un GET ne modifie jamais rien** : les pages lisent le statut
  (`getSubscriberByToken`) et les mutations passent par les Server Actions
  (`confirmUnsubscribe`, `updatePreferences`). C'était nécessaire : les
  antivirus, aperçus de messagerie et robots suivent les liens des e-mails, et
  l'ancienne page de désabonnement agissait en GET — un abonné pouvait être
  désabonné sans avoir rien demandé.
- **Double opt-in obligatoire** : une inscription crée un abonné `PENDING` et
  n'ouvre l'envoi qu'après le clic de confirmation. Une adresse déjà connue ne
  crée pas de doublon : un e-mail de gestion est renvoyé, et **le jeton ne
  circule que par e-mail** (le renvoyer à l'écran permettrait d'obtenir les liens
  de gestion d'un tiers en saisissant son adresse).
- **Adresses rejetées** (`BOUNCED`) : jamais réinscrites ni réactivées.
- **Limitation de débit** : 3 inscriptions par heure et par adresse IP
  (`x-forwarded-for`), compteur en mémoire — voir la limite mono-instance
  ci-dessus. Le compteur n'est consommé que pour une demande valide.
- **Préférences** : enregistrer une liste alors qu'on était désabonné remet le
  statut à `CONFIRMED` (consentement actif de l'abonné). Une sélection vide est
  refusée : se désabonner a sa propre page, avec sa confirmation.
- **Création de compte** : la case « Recevoir la newsletter » du backoffice est
  décochée par défaut ; cochée, elle crée un abonné `CONFIRMED` lié au compte
  (`userId`, source `compte`) — l'adresse est vérifiée par l'administrateur, donc
  pas de double opt-in pour une saisie interne.

## Gestion des campagnes (WP11d)

`/backoffice/newsletter/campaigns` (ADMIN) : liste filtrable (statut, liste,
recherche par sujet), paginée par 20, du plus récent au plus ancien.

| Route | Rôle |
| --- | --- |
| `…/campaigns` | liste, filtres, actions de ligne (Voir, Éditer, Dupliquer, Envoyer, Supprimer) |
| `…/campaigns/new` | création : sujet, pré-en-tête, liste, contenu HTML, planification |
| `…/campaigns/<id>` | métriques et taux, destinataires paginés (50), planification, relance des non-ouvreurs |
| `…/campaigns/<id>/edit` | édition — refusée si la campagne n'est plus brouillon ou planifiée |
| `…/campaigns/<id>/preview` | rendu réel dans une `iframe` sandboxée + envoi d'un test |

- **Éditeur de contenu** : un `textarea` HTML brut (option A du brief), pas de
  WYSIWYG. Le gabarit d'e-mail (bandeau, pied de page, désabonnement) est ajouté
  à l'envoi ; la prévisualisation montre exactement ce rendu.
- **Envoi immédiat** : toujours derrière une confirmation modale qui rappelle le
  nombre de destinataires — un envoi ne part jamais d'un simple clic dans une
  liste. L'action « Envoyer » du tableau ouvre la page de détail avec la
  confirmation déjà affichée.
- **Prévisualisation** : le HTML de campagne étant écrit par un administrateur, il
  est affiché dans une `iframe` `sandbox` (aucun script, aucune navigation), avec
  des jetons de suivi factices : prévisualiser ne compte pas une ouverture et ne
  peut désabonner personne.
- **Renvoyer aux non-ouvreurs** : le modèle envoie à une *liste* ; l'action crée
  donc une liste des destinataires qui n'ont pas ouvert (hors rejets et échecs),
  puis une campagne en brouillon visant cette liste. Rien n'est expédié sans
  validation.
- **Désabonnés** (détail) : nombre de destinataires de cette campagne qui sont
  désabonnés **aujourd'hui** — le schéma du WP11a n'a pas de compteur par
  campagne, l'approximation est annoncée dans l'interface.
- Suppression refusée dès que la campagne est partie (`SENT` ou `SENDING`).

### Envoi des campagnes planifiées

Une campagne dotée d'une date passe en `SCHEDULED` ; l'endpoint
`/api/cron/newsletter` expédie celles dont l'échéance est atteinte.

```bash
# Jeton : CRON_SECRET dans .env (en-tête Authorization ou paramètre token)
curl -H "Authorization: Bearer $CRON_SECRET" https://votre-domaine/api/cron/newsletter
```

- Réponse JSON : `{ ok, processed: [{ id, subject, sent, failed, status }], errors }`.
- 401 si le jeton est absent ou faux (comparaison en temps constant), **503 si
  `CRON_SECRET` n'est pas configuré** — l'endpoint ne peut pas être laissé ouvert.
- Ordre d'appel : `vercel.json` avec `{"crons": [{"path": "/api/cron/newsletter", "schedule": "*/5 * * * *"}]}`,
  une GitHub Action planifiée, ou une ligne de crontab. Vercel Cron envoie
  automatiquement `Authorization: Bearer $CRON_SECRET` si la variable existe.
- Le bouton « Traiter les envois planifiés » de la liste déclenche le même
  traitement manuellement, sans attendre le cron.

## Notifications par e-mail (WP11e)

Chaque notification in-app peut aussi partir par e-mail, selon les préférences du
compte (`/mon-compte/preferences`, ADMIN et lecteurs confondus) :

- **interrupteur global** `Author.emailNotificationsEnabled` (actif par défaut) ;
- **liste des types désactivés** `Author.emailNotificationTypes` — un `Json?`
  contenant par exemple `["COMMENT_REPLY", "USER_BANNED"]`, `NULL` signifiant
  « aucun type désactivé ».

| Type | E-mail | Gabarit |
| --- | --- | --- |
| `COMMENT_REPLY` | oui | réponse à un commentaire |
| `COMMENT_APPROVED` | oui | commentaire publié après modération |
| `COMMENT_REJECTED` | oui | commentaire refusé |
| `USER_BANNED` | oui | suspension du compte |
| `REPORT_RESOLVED` | oui | signalement traité |
| `COMMENT_REACTION` | non | « trop bruyant » (brief) : reste in-app |
| `REPORT_DISMISSED`, `USER_UNBANNED` | non | pas de gabarit dans ce lot |

- **Jamais bloquant** : `createNotification` écrit d'abord la notification in-app,
  puis appelle l'envoi **sans l'attendre** (`void sendNotificationEmail(…)`). Ni
  une panne de Resend, ni une clé absente ne peuvent faire échouer un dépôt de
  commentaire ou une décision de modération.
- **Plafond** : 20 e-mails par heure et par utilisateur. Au-delà, la notification
  in-app est créée et l'e-mail abandonné (journalisé) — un fil actif ne doit pas
  inonder une boîte mail.
- **Chaque e-mail** contient le texte de la notification, un lien vers la
  ressource concernée, un lien vers `/mon-compte/notifications` et un lien vers
  les préférences, qui sert aussi de désabonnement. **Aucun pixel de suivi** :
  ces messages transactionnels ne sont pas mesurés.
- Un e-mail par notification, sans digest (brief).





## Page auteur

Les auteurs disposent d'une page publique `/auteur/[slug]` (biographie, photo,
articles publiés, JSON-LD Person). Le `slug` est dérivé du nom ; l'administration
des utilisateurs ne le renseigne pas encore, aussi la page résout-elle à défaut
le slug du nom. Compléter les auteurs existants :

```bash
node scripts/backfill-author-slugs.cjs   # idempotent
```

## Points d'exploitation

- **La base PostgreSQL doit tourner** : si le conteneur `promptsport-pg` est
  arrêté, toute page qui lit la base répond 500 (`ECONNREFUSED`) et les suites
  échouent dès leur première requête. `docker start promptsport-pg`, puis attendre
  la ligne `database system is ready to accept connections` dans
  `docker logs promptsport-pg`.
- **Ne jamais remettre `DATABASE_URL` sur SQLite** : le schéma, les migrations et
  l'adaptateur Prisma sont PostgreSQL (`prisma/dev.db` n'est plus qu'une source de
  migration ponctuelle). `npx prisma migrate deploy` échouerait sur un fichier
  SQLite.
- **`@prisma/adapter-pg` en import paresseux** : un import statique dans
  `src/lib/prisma.ts` casse toutes les Server Actions (500
  `Cannot read properties of undefined (reading 'bind')`). Voir la section
  « Base de données ».
- **Ne jamais lancer `next build` pendant que `next dev` tourne** : le build
  écrase le dossier `.next` utilisé par le serveur de développement, qui se met
  alors à répondre 500 (manifestes manquants) ou meurt en cours de route. Après
  un build, arrêter puis relancer le serveur de dev — et vérifier qu'aucune
  instance orpheline n'occupe déjà le port (`netstat -ano | findstr :3002`), sans
  quoi le nouveau serveur échoue avec `EADDRINUSE`.
- **Middleware** : il doit vivre dans `src/middleware.ts`, au même niveau que le
  dossier `app/`. Un `middleware.ts` placé à la racine du projet est compilé mais
  **jamais exécuté** (aucune erreur, aucun avertissement) : la protection des
  rôles et le cookie visiteur `ps_vid` seraient alors silencieusement inactifs.
  Le build doit afficher une ligne `ƒ Middleware`.
- **Après `npx prisma generate`, redémarrer `next dev`** : le serveur de
  développement garde en mémoire le client Prisma chargé au démarrage. Les
  nouveaux modèles y sont absents (`prisma.newsletterSubscriber` vaut
  `undefined`) et les pages répondent 500 — sans que le typecheck ni le build ne
  signalent quoi que ce soit, puisque le client régénéré, lui, est correct.
- **Auth.js en production** : `trustHost: true` est indispensable dans
  `src/lib/auth.ts`. Sans lui, Auth.js v5 refuse l'hôte en production
  (`UntrustedHost`) et toutes les routes `/api/auth/*` répondent 500, donc la
  connexion est impossible — alors que le développement fonctionne.
- **Webhooks Stripe** : `stripe listen --forward-to localhost:3002/api/webhooks/stripe`
  (les suites `check-wp7b`, `check-wp7d`, `check-wp7e` en dépendent).
- **Webhook Resend** : à déclarer dans le tableau de bord Resend sur
  `https://votre-domaine/api/webhooks/resend`, puis recopier le secret `whsec_…`
  dans `.env`. La route vérifie la signature (Svix) avant tout traitement ; sans
  secret configuré, elle répond 503 plutôt que d'accepter n'importe quoi.
  Le secret présent dans `.env` est un secret de **développement**, généré
  localement : il doit être remplacé avant toute mise en production.
- **Analytique** : agrégation quotidienne des visites puis purge des données
  brutes au-delà de 90 jours.

```bash
npm run analytics:aggregate            # hier (UTC)
npm run analytics:aggregate 2026-09-26 # un jour précis
```

La collecte (`POST /api/analytics/track`) est sans cookie tiers, sans adresse IP
et sans identifiant personnel : seul un identifiant visiteur anonyme (UUID en
cookie HttpOnly) est conservé, et l'agrégat quotidien est gardé sans limite.
# Migration AllSportsApi de la base principale

Les six compétitions utilisent désormais les identifiants AllSportsApi. Le bilan, les limites et les sauvegardes sont décrits dans [RAPPORT-MIGRATION-ALLSPORTS.md](./RAPPORT-MIGRATION-ALLSPORTS.md).

Pour actualiser les données : `npx tsx scripts/sync-football.ts FL1 PL PD SA BL1 CL`. Le `DATABASE_URL` fourni dans l'environnement a priorité sur `.env`. La clé reste dans `ALLSPORTS_API_KEY` et ne doit pas être commitée.

Le script `scripts/migrate-allsports-data.ts` inspecte la base sans écrire par défaut. L'option `--confirm-migration` est réservée à la bascule initiale depuis football-data.org, avec contrôle du quota, préparation des six ligues et sauvegarde PostgreSQL vérifiée avant transaction. Il refuse une base déjà migrée.


## WP23 — exploitation et sécurité

### OAuth facultatif

Déclarer AUTH_GOOGLE_ID et AUTH_GOOGLE_SECRET pour Google, AUTH_FACEBOOK_ID et AUTH_FACEBOOK_SECRET pour Facebook, dans .env en local et dans Vercel pour chaque environnement concerné. Sans la paire complète, le fournisseur reste désactivé. Enregistrer les URL de retour du domaine exact : https://promptsport.net/api/auth/callback/google et https://promptsport.net/api/auth/callback/facebook. Ne jamais exposer les secrets avec un préfixe NEXT_PUBLIC_.

### Restaurer une sauvegarde PostgreSQL

Utiliser une archive pg_dump au format custom et une version de pg_restore compatible avec celle qui a créé l’archive. Depuis Git Bash, vérifier d’abord la table des matières :

    docker exec -i promptsport-pg pg_restore --list < backups/production-avant-migrations.dump

Restaurer d’abord dans une base vide de contrôle, créée au préalable. RESTORE_URL est l’URL directe de cette base de contrôle (pas celle de production), stockée dans l’environnement ; ne pas la coller dans une commande ou un journal :

    PGDATABASE="$RESTORE_URL" docker exec -i -e PGDATABASE promptsport-pg sh -c 'pg_restore --dbname="$PGDATABASE" --no-owner --no-privileges --exit-on-error --single-transaction' < backups/production-avant-migrations.dump

Vérifier les volumes des tables, les articles, les scores, les associations et les connexions. Appliquer ensuite les migrations manquantes avec DIRECT_URL visant explicitement la base restaurée : npm run db:deploy. Pour une restauration réelle, suspendre les écritures et les crons, sauvegarder l’état actuel, restaurer dans une nouvelle base vide puis basculer les URL pooled de l’application et directe des migrations vers cette base validée. Redéployer et vérifier le site avant de reprendre les écritures. Ne pas lancer --clean contre la production active. Conserver les sauvegardes hors du dépôt, dans un stockage protégé et avec une rétention adaptée.

### Journaux et quota

Le cron sportif accepte uniquement Authorization: Bearer <CRON_SECRET>. Le paramètre token dans l’URL ne sert plus à s’authentifier. Le workflow GitHub utilise déjà ce header. Ne jamais journaliser le secret ou une URL de connexion. Le cron newsletter conserve sa propre politique existante.

Le passage finished du cron sportif purge les journaux opérationnels SyncLog (live, upcoming, finished, request) dont finishedAt remonte à plus de 90 jours. Les tâches non terminées et les instantanés durables de classement/import sont conservés : ils servent de données applicatives et ne doivent pas disparaître avec les logs. La purge nécessite un cron finished exécuté avec succès ; elle ne s’exécute pas depuis une page publique.

### Limites des routes publiques

Par adresse IP et par minute : recherche 30, analytics 60, statut de synchronisation 120. Le dépassement renvoie HTTP 429 et Retry-After. Les fenêtres expirées sont nettoyées. Les compteurs en mémoire sont propres à chaque processus : sur Vercel, ils ne constituent pas une limite globale entre instances. Les en-têtes IP doivent être fournis par le proxy de confiance. Le statut conserve son cache serveur de 15 secondes, mais sa réponse HTTP est privée pour que le CDN ne contourne pas le contrôle par IP.

### Logos authentifiés

/api/logo/[teamId] accepte l’identifiant local ou l’identifiant externe numérique d’une équipe connue. L’hôte et le chemin fournisseur sont fixes ; aucune URL arbitraire n’est acceptée et la clé RapidAPI reste côté serveur. Seuls PNG, JPEG, WebP et GIF, de taille au plus 256 Kio, sont servis ; les redirections et SVG sont refusés. Le cache partagé en base et le cache HTTP durent 24 heures. Les appels sont comptés dans le même registre de quota que la synchronisation, sous verrou PostgreSQL, avec un maximum supplémentaire de cinq nouveaux logos par 24 h et une réserve fournisseur de vingt appels. Les logos publics existants restent utilisés sans appel RapidAPI. Une indisponibilité fournisseur ou un budget épuisé renvoie 503 sans exposer l’erreur interne.

Le dossier obsolète indiqué dans le brief, src/app/backoffice/sports/football-data/, n’existe pas. La page historique est dans src/app/backoffice/sports/sync/ ; elle est conservée car ce chemin et ses liens ont été explicitement exclus du périmètre autorisé.

### Audit des dépendances WP23

La branche codex/wp23-npm-audit a été réservée au correctif npm. Le périmètre confirmé exclut package-lock.json ; npm audit fix --package-lock=false refuse de fonctionner (fix cannot be used without a package-lock). Aucun correctif de dépendance n’est donc livré dans WP23. L’audit initial du 15 octobre 2026 compte 12 alertes high, 1 moderate, aucune critical. Résoudre ce point nécessite une mise à jour cohérente de package.json et package-lock.json, suivie du build ; ne pas utiliser --force pour rétrograder automatiquement Prisma ou Next.
