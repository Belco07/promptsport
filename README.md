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

Prérequis : Node.js **22+ ou 24 LTS** (WebSocket natif), et une base **Neon**.
Docker PostgreSQL reste disponible avec la passerelle locale décrite plus bas.

```bash
cp .env.example .env        # renseigner les deux URLs Neon avant npm install
npm install
npm run db:deploy           # applique les migrations sur PostgreSQL
npm run dev -- --port 3012 # http://localhost:3012
```

> **Ordre important** : `npm install` déclenche `postinstall: prisma generate`
> (WP12b), et `prisma.config.ts` lit `DATABASE_URL` au chargement — sans `.env`,
> l'installation s'arrête sur
> `PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL`.
> Créez donc `.env` en premier (ou lancez `npm run db:generate` après l'avoir
> créé). Sur Vercel, les variables sont déjà présentes pendant l'installation :
> ce cas ne s'y produit pas.

Le port **3000 est réservé à ClipMagic** ; PromptSport tourne sur **3012**.

Production locale :

```bash
npm run build
npm run start -- --port 3013
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
- `scripts/migrate-local-to-neon.cjs` — migration des données Docker → Neon
- `scripts/lib/pg-sync.cjs` — passerelle synchrone vers PostgreSQL pour les suites

## Base de données (WP35 — Neon)

L'application utilise `PrismaNeon` (`@prisma/adapter-neon` 7.10.1), aligné sur
`prisma` et `@prisma/client` 7.10.1, avec `@neondatabase/serverless` 1.2.0.
L'ancien adaptateur `@prisma/adapter-pg` est retiré. La dépendance `pg` reste
nécessaire aux scripts SQL, aux seeds et aux fixtures E2E.

### Application et CLI : deux connexions distinctes

Dans `.env` et dans Vercel, copier les deux chaînes de la console Neon :

```dotenv
# Application : hôte avec -pooler ; connexion WebSocket sécurisée du pilote Neon.
DATABASE_URL="postgresql://user:password@ep-example-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require"
# CLI Prisma : hôte sans -pooler ; migrations / introspection / Studio via TCP.
DIRECT_URL="postgresql://user:password@ep-example.eu-central-1.aws.neon.tech/neondb?sslmode=require"
APP_DATABASE_URL=""
NEON_WS_PROXY=""
```

Les exemples ne contiennent pas de vrais identifiants. `src/lib/prisma.ts`
prend `APP_DATABASE_URL` si elle est renseignée, sinon `DATABASE_URL` : effacer
un ancien override lors de la bascule Neon. La CLI ne lit jamais cet override ;
`prisma.config.ts` prend **DIRECT_URL en priorité**, avec un repli DATABASE_URL
pour les environnements locaux/CI ne fournissant qu'une connexion directe.
Changer les variables exige un redémarrage du serveur (singleton Prisma).

Le passage d'adaptateur ne copie aucune donnée et n'applique aucune migration.
La migration de données Docker → Neon reste une opération séparée, décrite
plus bas. Ne pas lancer `db:deploy` sans vérifier la destination DIRECT_URL.

Références : [Prisma sur Neon](https://neon.com/docs/guides/prisma) et
[configuration Prisma 7](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference).


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
Pour migrer cette base locale, DIRECT_URL doit également viser Docker.

`PrismaNeon` utilise WebSocket, pas une connexion TCP directe à Docker.
Une petite passerelle de test, **limitée à la boucle locale**, est disponible
sans dépendance supplémentaire dans le script WP19e autorisé :

```powershell
# Terminal 1 : DATABASE_URL doit viser Docker localhost:5432.
node scripts/check-wp19e.cjs --ws-proxy
# Terminal 2 : configuration du processus Next.js uniquement.
$env:NEON_WS_PROXY="127.0.0.1:5443"
npm run dev -- --port 3012
```

La passerelle n'ouvre que `127.0.0.1:5443` et refuse les origines Web distantes.
Elle ne modifie ni les volumes ni les données et s'arrête avec Ctrl+C.
`NEON_WS_PROXY` ne doit pas être défini sur Vercel/Neon : les connexions Neon
conservent leur WebSocket sécurisé. Le singleton refuse d'utiliser cette option
avec un hôte PostgreSQL ou un proxy non local.

`node scripts/check-wp19e.cjs` démarre sa propre passerelle temporaire, crée une
base Docker isolée, exécute les contrôles PrismaNeon et la supprime en fin de
suite. Les suites Playwright utilisant Docker nécessitent la passerelle sur
5443 et NEON_WS_PROXY dans l'environnement du **serveur** testé.


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
UTC. Les contrôles d’horodatage restent exécutés avec le nouvel adaptateur Neon.

### Migrations et dérive de schéma

```bash
npm run db:deploy    # prisma migrate deploy (production et développement)
npm run db:check     # prisma migrate status : migrations en attente ? (code 1 si oui)
npm run db:studio    # Prisma Studio
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
```

La dernière commande doit répondre `No difference detected` (code 0) : elle
vérifie que la base réellement migrée correspond au schéma Prisma.

`db:check` et `db:deploy` visent la même base : `DIRECT_URL` d'abord, sinon
`DATABASE_URL`. Sur un poste configuré pour la production, `npm run db:check`
contrôle donc la production. Le workflow `Migrations`
(`.github/workflows/migrate-check.yml`) exécute ce contrôle automatiquement à
chaque pull request et à chaque push sur `main`, avec le secret `DIRECT_URL` :
il échoue si une migration n'est pas appliquée. C'est le garde-fou qui
manquait — Vercel ne joue pas `prisma migrate deploy` au déploiement.

### Chargement de l'adaptateur côté serveur

`PrismaNeon` et `neonConfig` sont chargés paresseusement dans
`src/lib/prisma.ts`, à la création du singleton. Cette frontière conserve le
pilote côté serveur lorsque des composants clients référencent des Server
Actions ; le navigateur ne reçoit ni le pilote ni les URLs de connexion.

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

## Déploiement (Vercel + Neon)

Le site se déploie sur **Vercel**, avec une base **Neon** (PostgreSQL managé,
offre gratuite suffisante pour ce projet). La configuration versionnée vit dans
`vercel.json` ; la marche à suivre historique, avec cases à cocher, reste dans
[`scripts/deploy-checklist.md`](scripts/deploy-checklist.md) — elle mentionne
encore Prisma Postgres par endroits, la procédure ci-dessous fait foi.

Neon expose deux chaînes de connexion, à ne pas confondre :

| Chaîne | Usage | Variable |
| --- | --- | --- |
| **Pooled** (`ep-…-pooler.…neon.tech`) | l'application sur Vercel : beaucoup de connexions courtes, multiplexées par PgBouncer | `DATABASE_URL` |
| **Directe** (`ep-….neon.tech`) | migrations, seed des thèmes, Prisma Studio, script de migration | `DIRECT_URL` |

Les deux exigent `?sslmode=require`. La chaîne directe est obligatoire pour
`prisma migrate deploy` : un pooler en mode transaction ne conserve pas l'état de
session (verrous, `SET`, requêtes préparées).

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
3. Framework Preset : **Next.js** ; Root Directory : `.`. La commande de
   construction et le dossier de sortie sont lus dans `vercel.json` :
   `prisma generate && next build`, `outputDirectory: .next-production`
   (aligné sur `next.config.ts`, qui déplace le build de production dans ce
   dossier).
   *(Le build local utilise `next build --turbopack` ; la commande Vercel est
   volontairement sans Turbopack pour rester sur le chemin de build standard.)*
4. Déployer. Le premier déploiement peut échouer : les variables d'environnement
   ne sont pas encore définies, c'est attendu. Pour une première mise en
   production complète, suivre plutôt §3 bis (base Neon remplie avant le
   déploiement).

### 3. Variables d'environnement Vercel

Settings → Environment Variables, en cochant **Production** et **Preview**.

| Variable | Valeur |
| --- | --- |
| `DATABASE_URL` | chaîne **pooled** Neon (`ep-…-pooler.…neon.tech`), avec `?sslmode=require` |
| `DIRECT_URL` | chaîne **directe** Neon (`ep-….neon.tech`), pour les migrations, le seed des thèmes et Prisma Studio |
| `AUTH_SECRET` | secret de signature des JWT (`openssl rand -base64 32`) |
| `NEXT_PUBLIC_SITE_URL` | `https://<projet>.vercel.app` (sans barre oblique finale) |
| `CRON_SECRET` | secret du cron (`openssl rand -base64 32`) |
| `ALLSPORTS_API_KEY` | clé RapidAPI AllSportsApi utilisée par les synchronisations |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | identifiants OAuth Google, facultatifs |
| `AUTH_FACEBOOK_ID`, `AUTH_FACEBOOK_SECRET` | identifiants OAuth Facebook, facultatifs |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | clés Stripe (test ou live) ; le paiement passe par Stripe Checkout côté serveur, aucune clé publique n'est nécessaire |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME` | envoi des e-mails |
| `BLOB_READ_WRITE_TOKEN` | stockage des images de couverture (Vercel Blob, store public) |

Deux remarques sur les noms : le code lit `AUTH_SECRET` (Auth.js v5 accepte
`NEXTAUTH_SECRET` comme ancien nom, sans que ce projet en dépende) et
`ALLSPORTS_API_KEY` pour le fournisseur sportif actif. `AUTH_URL` / `NEXTAUTH_URL`
sont inutiles ici : `trustHost: true` déduit l'URL de la requête.

### 3 bis. Première mise en production : Neon → Vercel

La base locale (conteneur Docker) contient les articles, les 1 403 matchs et les
9 thèmes. Neon ne reçoit pas de copie de fichier : on applique d'abord le schéma
avec les migrations, puis on injecte les données avec le script dédié. Le
`.env` local n'est **pas** modifié au passage — il continue de viser Docker.

**1. Créer la base Neon.** Sur <https://console.neon.tech>, créer un projet
(région la plus proche des utilisateurs). Dans **Dashboard → Connect**, copier
les deux chaînes :

- **Pooled connection** → `DATABASE_URL` sur Vercel ;
- **Direct connection** → `DIRECT_URL` sur Vercel, et cible du script.

Vérifier que l'URL directe ne contient pas `-pooler` et se termine par
`?sslmode=require`.

**2. Répéter la migration à blanc.** Le script est en simulation par défaut : il
se contente de vérifier le conteneur, la source, la cible et les migrations en
attente. Il ne lit jamais `DIRECT_URL` ni `DATABASE_URL` du `.env` (qui visent
la base de développement) : la cible doit être passée explicitement.

```bash
node scripts/migrate-local-to-neon.cjs --target "postgresql://…@ep-….neon.tech/neondb?sslmode=require"
```

**3. Appliquer.** Le script enchaîne : `pg_dump --data-only --inserts` de la
base Docker, `prisma migrate deploy` sur Neon, injection du dump en autocommit
(sans transaction globale), puis comparaison table par table des comptages
source et cible.

```bash
node scripts/migrate-local-to-neon.cjs --target "postgresql://…" --confirm
```

Options utiles :

| Option | Effet |
| --- | --- |
| `--target <url>` | cible Neon ; à défaut, `NEON_DIRECT_URL` est lue |
| `--source <url>` | base locale (défaut : `promptsport` sur `localhost:5432`) |
| `--container <nom>` | conteneur Docker (défaut : `promptsport-pg`) |
| `--dump <chemin>` | fichier SQL de sortie (défaut : `backups/neon-data-<date>.sql`) |
| `--confirm` | exécute réellement (sans lui : simulation) |
| `--truncate` | vide les tables de la cible avant l'injection (relance) |
| `--skip-migrations` | n'exécute pas `prisma migrate deploy` |
| `--allow-local-target` | autorise une cible `localhost` (répétition seulement) |
| `--overwrite` | remplace un dump existant |

Le dump exclut `_prisma_migrations` (écrite par Prisma sur la cible) et suspend
les triggers utilisateur pendant le chargement : `sync_club_rivalries` exigerait
que les clubs rivaux existent déjà, ce que l'ordre de `pg_dump` ne garantit pas.
Les clés étrangères restent vérifiées ; les triggers sont réactivés en fin
d'import et dans le chemin d'erreur. L'injection n'étant pas transactionnelle,
un échec laisse les lignes déjà validées sur la cible : corriger puis relancer
avec `--truncate` (ou restaurer une sauvegarde Neon). Le dump produit est
conservé.

Prérequis : Docker en marche, conteneur `promptsport-pg` démarré (il fournit
`pg_dump` et `psql`, absents de l'hôte Windows), `npm install` effectué.

**4. Thèmes.** Les migrations créent la table `Theme` sans son contenu. Sur le
poste, viser Neon avec la chaîne directe :

```bash
DIRECT_URL="postgresql://…@ep-….neon.tech/neondb?sslmode=require" npm run db:seed:themes
```

Résultat attendu : `9 thème(s) en base, 8 actif(s)` (« Transferts » inactif).
Le seed est idempotent.

**5. Préflight.** Contrôler la cible avant de basculer le trafic :

```bash
node scripts/check-prisma-postgres.cjs "postgresql://…@ep-….neon.tech/neondb?sslmode=require"
```

Il vérifie la connexion, TLS, les migrations appliquées et en attente, les
thèmes et la disponibilité de `pg_trgm` (création testée puis annulée).

**6. Vercel.** Renseigner `DATABASE_URL` (pooled) et `DIRECT_URL` (directe) dans
Settings → Environment Variables (Production + Preview), avec les autres
variables du tableau §3, puis redéployer. `vercel.json` impose déjà
`prisma generate && next build` et `outputDirectory: .next-production`.

**7. Vérifier.** Après déploiement, contrôler `/`, `/scores`, `/themes`, un
article, une page match et le studio. Relancé **sans** `--confirm`, le script
affiche le nombre de lignes déjà présentes sur la cible : c'est un contrôle
rapide que la base n'est pas vide.

**8. Revenir en arrière.** Les données de production vivent uniquement sur
Neon. En cas de problème, deux leviers : redéployer le commit précédent
(Vercel → Deployments → Promote) si la cause est applicative, ou restaurer une
sauvegarde Neon (console → **Backups**, restauration ponctuelle) si la cause est
une écriture. Le dump local produit par le script reste une copie de la base de
départ, pas une sauvegarde continue : activer les sauvegardes Neon avant
d'ouvrir le site au public.

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

Le même garde-fou existe en automatique : à chaque pull request et à chaque
push sur `main`, le workflow « Migrations » compare `prisma/migrations` à la
production et échoue si une migration est en attente ; `npm run db:check` fait
ce contrôle à la demande, localement (même cible que `db:deploy`). Le secret
GitHub `DIRECT_URL` doit contenir la chaîne directe Neon (Settings → Secrets and
variables → Actions), et être mis à jour lors d'un changement de projet Neon.

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

### 4 ter. Préflight base distante

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

- **En mode Docker, PostgreSQL et sa passerelle doivent tourner** : si `promptsport-pg` est
  arrêté, ou si la passerelle WebSocket locale est absente, les pages et suites
  échouent dès leur première requête. `docker start promptsport-pg`, puis attendre
  la ligne `database system is ready to accept connections` dans
  `docker logs promptsport-pg`.
- **Ne jamais remettre `DATABASE_URL` sur SQLite** : le schéma, les migrations et
  l'adaptateur Prisma sont PostgreSQL (`prisma/dev.db` n'est plus qu'une source de
  migration ponctuelle). `npx prisma migrate deploy` échouerait sur un fichier
  SQLite.
- **`PrismaNeon` en import paresseux** : le pilote reste chargé côté serveur,
  y compris pour les Server Actions appelées depuis des composants clients.
  Voir la section « Base de données ».
- **Build et serveurs locaux** : `next dev` écrit dans `.next` et le build
  de production dans `.next-production`. Un nouveau build remplace cependant
  les fichiers utilisés par un ancien `next start` : redémarrer ce dernier
  après compilation. Redémarrer aussi le serveur après un changement d'URL ou
  d'adaptateur Prisma pour renouveler le singleton. Le port 3012 est celui de
  PromptSport ; le port 3000 reste réservé à ClipMagic.
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

Le passage finished du cron sportif purge les journaux opérationnels SyncLog (live, upcoming, finished, request et caches logo:) dont finishedAt remonte à plus de 30 jours. Les tâches non terminées et les instantanés durables de classement/import sont conservés : ils servent de données applicatives et ne doivent pas disparaître avec les logs. La purge nécessite l’exécution du cron finished et une connexion fonctionnelle à la base ; elle ne s’exécute pas depuis une page publique.

### Limites des routes publiques

Par adresse IP et par minute : recherche 30, analytics 60, statut de synchronisation 30. Le dépassement renvoie HTTP 429 et Retry-After. Les fenêtres expirées sont nettoyées. Les compteurs en mémoire sont propres à chaque processus : sur Vercel, ils ne constituent pas une limite globale entre instances. Les en-têtes IP doivent être fournis par le proxy de confiance. Le statut conserve son cache serveur de 15 secondes, mais sa réponse HTTP est privée pour que le CDN ne contourne pas le contrôle par IP.

### Logos authentifiés

/api/logo/[teamId] accepte l’identifiant local ou l’identifiant externe numérique d’une équipe connue. L’hôte et le chemin fournisseur sont fixes ; aucune URL arbitraire n’est acceptée et la clé RapidAPI reste côté serveur. Seuls PNG, JPEG, WebP et GIF, de taille au plus 256 Kio, sont servis ; les redirections et SVG sont refusés. Le cache partagé en base et le cache HTTP durent 24 heures. Les appels sont comptés dans le même registre de quota que la synchronisation, sous verrou PostgreSQL, avec un maximum supplémentaire de cinq nouveaux logos par 24 h et une réserve fournisseur de vingt appels. Les logos publics existants restent utilisés sans appel RapidAPI. Une indisponibilité fournisseur ou un budget épuisé renvoie 503 sans exposer l’erreur interne.

La page historique /backoffice/sports/sync a été supprimée (WP30), avec le bouton « Synchroniser les données » qui y menait. La synchronisation des scores passe par AllSportsApi et le suivi des exécutions par GitHub Actions ; les Server Actions de synchronisation du backoffice restent en place, seuls la page dépréciée et son formulaire orphelin ont été retirés.

### Audit des dépendances WP23 — 16 octobre 2026

Les correctifs ont été isolés dans codex/wp23-dependency-fixes puis intégrés à la branche de finalisation. npm audit fix met à jour les dépendances compatibles ; les versions exactes ont été relevées vers Next.js / eslint-config-next 15.5.28 et Prisma / @prisma/client / @prisma/adapter-pg 7.10.1 (adaptateur remplacé par @prisma/adapter-neon dans WP35). L’override ciblé next@15.5.28 → postcss 8.5.30 corrige PostCSS sans migration majeure de Next.js. package-lock.json est versionné avec package.json.

Résultat de npm audit --package-lock-only --omit=dev : **0 vulnérabilité de production**, dont 0 high et 0 critical. L’audit complet garde **5 alertes high**, 0 moderate et 0 critical, sur la chaîne de développement eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces. Il s’agit de la chaîne affectée par [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), un épuisement de pile à partir de motifs imbriqués. La dernière version publiée de braces, 3.0.3, est encore affectée. Le correctif automatique forcé propose eslint-config-next 14.2.35, une rétrogradation majeure incompatible avec l’alignement Next.js 15 retenu : elle n’est pas appliquée. La levée de ces alertes exige un correctif amont ou un remplacement/migration de la chaîne de lint, à tester séparément. Le critère « aucune high dans l’audit complet » n’est donc pas atteint.

Le contrôle sur lockfile rend l’audit reproductible indépendamment des paquets natifs locaux. Les téléchargements natifs Windows ont été interrompus après blocage réseau ; l’installation complète des versions retenues et le build sont contrôlés en CI avec npm ci. Ne pas assimiler cette validation à une installation locale Windows terminée. Pour réinstaller localement quand le registre est accessible : npm ci, puis npm run build. Aucun nouveau service ni bibliothèque applicative n’est ajouté.

Réexamen WP30 (16 octobre 2026) : `npm audit fix` (sans `--force`) ne corrige rien de plus et laisse le lockfile inchangé ; les **5 alertes high** restent limitées à la chaîne de développement décrite ci-dessus (aucune dépendance embarquée ni de production concernée : 0 vulnérabilité de production). Le correctif sans rétrogradation majeure dépend toujours de l'amont.

### Rétention et sauvegardes — WP23 complété

AnalyticsPageView : les événements bruts de plus de 90 jours sont purgés par npm run analytics:aggregate (scripts/analytics-aggregate.ts). Les agrégats restent disponibles ; la purge dépend de l’exécution de cette commande. SyncLog : le cron sportif finished purge les journaux opérationnels terminés et les caches de logos de plus de 30 jours, en conservant les instantanés de classement/import utilisés par l’application et les tâches non terminées. Les compteurs de quota des dernières 24 heures ne sont pas concernés.

Politique de sauvegarde recommandée : archive PostgreSQL custom quotidienne et systématiquement avant une migration ou un import de remplacement ; garder 7 sauvegardes quotidiennes et 4 hebdomadaires, chiffrées dans un stockage distinct du poste et du dépôt, avec accès restreint. Tester la restauration dans une base vide au moins une fois par mois. Cette politique décrit les opérations à organiser ; aucun stockage externe ou planificateur de sauvegarde n’est créé par ce lot. La procédure de restauration est détaillée ci-dessus.

Nettoyage Git WP23 : 17 branches locales codex/* et sauvegarde/* déjà contenues dans origin/main ont été supprimées avec git branch -d. Les branches de travail sont conservées tant qu’elles ne sont pas fusionnées ; les branches distantes ne sont pas supprimées.

### Distribution sociale — WP42

La première publication d’un article génère après la réponse HTTP deux propositions (X et Facebook), à partir du titre et du résumé, avec DeepSeek (`DEEPSEEK_API_KEY`). L’onglet **Diffusion** de l’édition d’un article publié permet de copier chaque texte et de le marquer comme publié. Aucun appel de publication aux réseaux sociaux n’est effectué. Une republication conserve les propositions existantes ; une panne IA ne bloque pas l’article et les textes manquants peuvent être relancés dans cet onglet. `NEXT_PUBLIC_SITE_URL` doit désigner le site public pour les liens ajoutés aux posts.

Tests unitaires : `node --test tests/unit/distribution.test.cjs`.

E2E locaux : après les migrations et le seed des comptes E2E sur Docker (`localhost:5432`), lancer `node scripts/test-distribution.cjs` (parcours WP42) ou `node scripts/test-distribution.cjs tests/e2e` (suite complète). Le script démarre une IA simulée sur le port 5451 et un tunnel PostgreSQL WebSocket sur 5452 ; il neutralise les clés d’envoi et n’appelle pas DeepSeek. Le port 3002 doit être libre pour que le script démarre son serveur de test avec cette configuration.


### Automatisation de la veille — WP41-bis

`GET /api/cron/fetch-news` réutilise `src/lib/news-fetcher.ts`, comme `npm run news:fetch`. L’endpoint exige exclusivement `Authorization: Bearer <CRON_SECRET>` ; un secret absent côté serveur renvoie 503, un jeton absent ou invalide 401. Les paramètres `?token=` ne sont jamais acceptés. Les réponses ne sont pas mises en cache. Une collecte réussie renvoie `{ "success": true, "alertsCreated": 0 }`, avec le nombre réellement inséré (donc 0 si les alertes sont déjà connues). Une panne de toutes les sources renvoie 502 ; une panne globale renvoie 500.

Le workflow `.github/workflows/fetch-news.yml` appelle cet endpoint **toutes les 30 minutes**, aux minutes 13 et 43 UTC. Il réutilise le secret Actions `CRON_SECRET` (même valeur que sur Vercel) et la variable `SITE_URL` du dépôt, avec repli sur `https://www.promptsport.net`. Le workflow doit être sur `main` et GitHub Actions activé. Il peut aussi être lancé manuellement dans Actions → Collecte de la veille → Run workflow. Les exécutions de ce workflow sont sérialisées pour éviter les chevauchements.

La limite reste de 3 éléments par source (modifiable dans le CLI avec `--limit`) et la rétention de 48 h est conservée. Le cron traite jusqu’à 3 sources simultanément ; la traduction reste limitée aux alertes nouvelles. Le collecteur partagé ne déconnecte jamais Prisma et ne modifie pas le code de sortie du processus ; seul le CLI ferme son client à la fin.

Test manuel, sans placer le secret dans l’URL :

```bash
curl --fail-with-body --header "Authorization: Bearer $CRON_SECRET" \
  https://www.promptsport.net/api/cron/fetch-news
```

Tests isolés du collecteur et de l’authentification : `node --test tests/unit/news-fetcher.test.cjs`.
