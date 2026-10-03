# promptsport

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

## Déploiement (WP12b — Vercel + Neon)

Le site se déploie sur **Vercel**, avec la base **Neon** (PostgreSQL serverless).
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
| `DATABASE_URL` | chaîne **pooled** de Neon (l'hôte contient `-pooler`), avec `?sslmode=require` |
| `DIRECT_URL` | chaîne **unpooled** de Neon (sans `-pooler`), pour les migrations |
| `AUTH_SECRET` | secret de signature des JWT (`openssl rand -base64 32`) |
| `NEXT_PUBLIC_SITE_URL` | `https://<projet>.vercel.app` (sans barre oblique finale) |
| `CRON_SECRET` | secret du cron (`openssl rand -base64 32`) |
| `FOOTBALL_DATA_API_KEY` | clé Football-Data.org |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | clés Stripe (test ou live) |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME` | envoi des e-mails |

Deux remarques sur les noms : le code lit `AUTH_SECRET` (Auth.js v5 accepte
`NEXTAUTH_SECRET` comme ancien nom, sans que ce projet en dépende) et
`FOOTBALL_DATA_API_KEY` (et non `SPORTS_API_KEY`). `AUTH_URL` / `NEXTAUTH_URL`
sont inutiles ici : `trustHost: true` déduit l'URL de la requête.

### 4. Migrations en production

`prisma migrate deploy` utilise la chaîne **directe** (les migrations ne passent
pas par un pooler en mode transaction) :

```bash
# PowerShell
$env:DATABASE_URL=$env:DIRECT_URL; npm run db:deploy
# bash
DATABASE_URL="$DIRECT_URL" npm run db:deploy
```

`postinstall: prisma generate` régénère le client Prisma à chaque installation :
c'est indispensable sur Vercel, où `src/generated/` n'est pas versionné.
Ne jamais utiliser `prisma migrate dev` en production.

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

`src/components/AdSlot.tsx` réserve la place d'un bandeau commercial. Ce n'est
**pas** un script de régie : le bloc impose le ratio du bandeau de référence
(1838 × 340) au lieu d'une hauteur en pixels, pour que la surface soit identique
à toutes les largeurs d'écran et qu'aucun contenu ne se décale le jour où une
annonce est servie (protection du CLS mesuré au WP8c). Aucun JavaScript n'est
chargé : le bandeau n'ajoute rien au poids de la page.

Deux emplacements sont posés aujourd'hui :

| Page | Position | Composant |
| --- | --- | --- |
| Accueil (`src/app/page.tsx`) | sous la manchette, avant la une | `<AdSlot className="mb-[30px]" />` |
| Article (`src/app/article/[slug]/page.tsx`) | après le corps de l'article | `<AdSlot className="mt-10" />` |

Pour diffuser une annonce, remplacer le contenu de l'`<aside>` par l'`<ins>` ou
l'`<iframe>` du partenaire : la mise en page ne bouge pas. Le libellé
« Publicité » est visible (mention obligatoire pour une insertion commerciale) ;
il se remplace via la propriété `label`. Le repère `data-ad-slot="banner"`
permet de compter ou de cibler les emplacements.

À prévoir si la régie l'exige : bandeau latéral 300 × 250 dans la colonne de
droite de l'accueil (l'`<aside>` existant fait 310 px), emplacements sur
`/scores`, `/competition/[slug]` et `/match/[id]`, et masquage pour les abonnés
premium — aucune de ces variantes n'est implémentée à ce stade.

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
