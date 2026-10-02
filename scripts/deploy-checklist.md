# Checklist de déploiement — WP12b (Vercel + Neon)

Checklist manuelle à dérouler dans l'ordre. Ce qui est **fait par DSH** figure
dans le dépôt (vercel.json, .env.example, .gitignore, package.json, README) ;
tout ce qui demande un compte GitHub/Vercel/Neon reste à faire à la main.

> État au moment de la rédaction : `git`, `gh` et `vercel` ne sont pas
> disponibles dans l'environnement d'exécution de DSH (aucun CLI Vercel ni GitHub
> installé, aucun identifiant fourni). Les étapes 1 à 5 ci-dessous n'ont donc
> **pas** pu être exécutées ici : elles ont été préparées et vérifiées en local
> (build de production, endpoint cron, audit des secrets) mais pas déployées.

---

## 0. Fichiers déjà prêts dans le dépôt

| Fichier | Contenu |
| --- | --- |
| `vercel.json` | `framework`, `installCommand`, `buildCommand` (`prisma generate && next build`), cron quotidien `/api/cron/newsletter` |
| `.gitignore` | `.env` (et variantes) exclus, `!.env.example` ré-inclus, `.next/`, `node_modules/`, `prisma/*.db`, `src/generated/`, `/backups/`, `*.log` |
| `.env.example` | modèle documenté de toutes les variables (pooled/unpooled, secrets, noms réellement lus par le code) |
| `package.json` | `postinstall: prisma generate`, `db:deploy: prisma migrate deploy` |
| `README.md` | section « Déploiement (WP12b) » |

---

## 1. Préparer le dépôt Git (à faire une fois)

- [ ] `git init`
- [ ] `git add .`
- [ ] `git status --porcelain | findstr /I ".env"` → **seul `.env.example`** doit apparaître
- [ ] `git check-ignore -v .env` → confirme que `.env` est ignoré
- [ ] `git commit -m "promptsport : site d'actualité sportive"`
- [ ] `git branch -M main`
- [ ] Créer le dépôt vide sur <https://github.com/new> (privé recommandé)
- [ ] `git remote add origin https://github.com/<compte>/<dépôt>.git`
- [ ] `git push -u origin main`

Contrôle final côté GitHub : le dépôt **ne doit contenir aucun** `.env`, aucune
clé `sk_…` / `whsec_…` / `re_…`, ni `promptsport-pgdata`.

Audit en trois commandes (à relancer après toute modification) :

```bash
# 1) clés Stripe / Resend / Svix dans le contenu indexé
git grep -nE 'sk_(test|live)_[A-Za-z0-9]{10,}|whsec_[A-Za-z0-9+/=]{10,}|re_[A-Za-z0-9_]{16,}' -- . ':!package-lock.json' ':!.env.example'
# 2) chaînes de connexion PostgreSQL contenant des identifiants
git grep -nE 'postgres(ql)?://[^"[:space:]]*@' -- . ':!package-lock.json' ':!.env.example'
# 3) variables d'environnement versionnées par erreur
git ls-files | findstr /I ".env"
```

Les commandes 1 et 2 doivent ne rien retourner (`git grep` sort en code 1 quand il
ne trouve rien — c'est le résultat attendu), et la commande 3 ne doit lister que
`.env.example`. Note : `git grep` utilise des expressions régulières POSIX (pas de
`\b`, ni de lookahead).

## 2. Base Neon

- [ ] Vérifier le projet Neon et relever les deux chaînes (bouton **Connect**) :
  - **pooled** (l'hôte contient `-pooler`) → `DATABASE_URL`
  - **unpooled** (sans `-pooler`) → `DIRECT_URL`
- [ ] Ajouter `?sslmode=require` à chacune si absent
- [ ] Appliquer le schéma sur Neon (migrations, jamais `migrate dev`) :

```powershell
# PowerShell
$env:DATABASE_URL="<chaîne unpooled>"; npm run db:deploy
```

```bash
# bash
DATABASE_URL="<chaîne unpooled>" npm run db:deploy
```

- [ ] Vérifier : `No pending migrations` puis, dans la console Neon,
      `select count(*) from information_schema.tables where table_schema='public';` → 24

### Deux options pour le contenu

- **A. Repartir d'une base vide** (le plus propre) :
  - [ ] Créer le compte admin : `$env:DATABASE_URL="<unpooled>"; npm run db:seed`
    (crée `admin@example.com` / `admin123` — **à changer ensuite**)
  - [ ] Créer les catégories et les articles depuis `/studio` après le déploiement.
- **B. Recopier le contenu local** (articles, matchs, comptes) :

```powershell
$env:DATABASE_URL="<chaîne unpooled>"; $env:SQLITE_DATABASE_URL="file:./prisma/dev.db"
npx tsx scripts/migrate-sqlite-to-postgres.ts
```

  Le script vide puis réinsère les 23 tables et affiche le comparatif de
  comptages ; il sort en erreur si les totaux diffèrent.

## 3. Projet Vercel

- [ ] Compte créé sur <https://vercel.com/signup>, connecté à GitHub
- [ ] **Add New Project** → import du dépôt
- [ ] Framework Preset : `Next.js` — Root Directory : `.` — Output Directory : `.next`
- [ ] Build Command : laisser `vercel.json` s'appliquer (`prisma generate && next build`)
- [ ] Install Command : `npm install` (défaut)
- [ ] Premier déploiement : il peut échouer faute de variables — c'est attendu

## 4. Variables d'environnement (Production **et** Preview)

À déclarer dans **Settings → Environment Variables** :

- [ ] `DATABASE_URL` — chaîne pooled (avec `-pooler`)
- [ ] `DIRECT_URL` — chaîne unpooled
- [ ] `AUTH_SECRET` — `openssl rand -base64 32`
- [ ] `NEXT_PUBLIC_SITE_URL` — `https://<projet>.vercel.app` (sans `/` final)
- [ ] `CRON_SECRET` — `openssl rand -base64 32`
- [ ] `FOOTBALL_DATA_API_KEY`
- [ ] `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- [ ] `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME`
- [ ] Redéployer (**Deployments → ⋯ → Redeploy**) pour prendre en compte les variables

Notes de nommage : l'application lit `AUTH_SECRET` (Auth.js v5 accepte
`NEXTAUTH_SECRET` comme ancien nom) et `FOOTBALL_DATA_API_KEY` (et non
`SPORTS_API_KEY`). `AUTH_URL` / `NEXTAUTH_URL` sont inutiles (`trustHost: true`).

## 5. Tâches planifiées

- [ ] Newsletter : rien à faire, `vercel.json` déclare
      `{ "path": "/api/cron/newsletter", "schedule": "0 6 * * *" }` (06:00 UTC)
      et Vercel ajoute l'en-tête `Authorization: Bearer $CRON_SECRET`.
- [ ] Vérifier dans **Settings → Cron Jobs** que la tâche est listée.
- [ ] Synchronisation sportive : la créer via GitHub Actions (le plan Hobby ne
      permet qu'un cron quotidien par tâche, et la synchronisation n'existe
      qu'en script CLI). Créer `.github/workflows/sync-football.yml` :

```yaml
name: Synchronisation football

on:
  schedule:
    - cron: "15 */6 * * *"   # toutes les 6 heures (UTC)
  workflow_dispatch:          # déclenchement manuel depuis l'onglet Actions

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run sync:football
        env:
          # Chaîne unpooled : un job CI ne bénéficie pas du pooler
          DATABASE_URL: ${{ secrets.NEON_DIRECT_URL }}
          FOOTBALL_DATA_API_KEY: ${{ secrets.FOOTBALL_DATA_API_KEY }}
```

- [ ] Déclarer les deux secrets du dépôt (**Settings → Secrets and variables →
      Actions**) : `NEON_DIRECT_URL`, `FOOTBALL_DATA_API_KEY`.
- [ ] Lancer une fois le workflow à la main (`workflow_dispatch`) pour valider.

*Variante sans GitHub Actions* : un service externe (cron-job.org) ne peut
appeler qu'une URL HTTP ; il n'existe pas d'endpoint de synchronisation (elle est
réservée au backoffice). Utiliser GitHub Actions, ou planifier la synchronisation
depuis le backoffice (`/backoffice/sports/sync`).

## 6. Vérifications d'acceptation (sur l'URL Vercel)

- [ ] `https://<projet>.vercel.app/` → accueil avec articles
- [ ] `/login` → connexion `admin@example.com`
- [ ] `/studio/articles/new` → publication d'un article, visible sur l'accueil
- [ ] Un commentaire se poste sur un article (et s'affiche après validation)
- [ ] Inscription à la newsletter depuis `/newsletter` (200 + e-mail de confirmation si Resend configuré)
- [ ] `/scores`, `/competition/<slug>`, `/match/<id>` → 200 et contenu
- [ ] `/sitemap.xml`, `/robots.txt`, `/rss.xml` → 200
- [ ] `/api/cron/newsletter` sans jeton → **401** ; avec
      `Authorization: Bearer <CRON_SECRET>` → **200** `{"ok":true,…}`
- [ ] **Logs Vercel** : aucune erreur 500 sur les pages visitées
- [ ] `/backoffice` accessible en ADMIN ; `/studio` en JOURNALIST

## 7. Dépannage

| Symptôme | Cause probable | Correctif |
| --- | --- | --- |
| `npm install` s'arrête sur `PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL` | `postinstall: prisma generate` s'exécute avant que `.env` existe | copier `.env.example` en `.env` **avant** `npm install` (ou lancer `npm run db:generate` ensuite). Sans objet sur Vercel, où les variables sont déjà définies |
| Build : `@/generated/prisma/client` introuvable | `postinstall` non exécuté ou échec de `prisma generate` | vérifier la Build Command (`prisma generate && next build`) et les logs d'installation |
| 500 sur toutes les pages | `DATABASE_URL` absente ou fausse | revérifier l'URL pooled (`-pooler`) et `?sslmode=require` |
| `P1001: Can't reach database server` | compute Neon en veille | ajouter `&connect_timeout=15` à l'URL |
| Erreur de préparation de requête / connexions épuisées | URL unpooled utilisée par l'application | remettre la chaîne **pooled** dans `DATABASE_URL` |
| `migrate deploy` échoue | migration lancée avec la chaîne pooled | utiliser `DATABASE_URL=$DIRECT_URL` (étape 2) |
| Liens canoniques ou e-mails pointant vers `localhost` | `NEXT_PUBLIC_SITE_URL` absente au build | la définir puis **redéployer** (variable lue à la compilation) |
| Connexion impossible après login | cookie `Secure`/domaine ou `AUTH_SECRET` changé | vérifier `AUTH_SECRET` identique entre les déploiements |
| Cron en 401 | `CRON_SECRET` absent côté Vercel | ajouter la variable puis redéployer |
| Formulaire d'upload en échec | écriture dans `public/uploads/` : système de fichiers Vercel en lecture seule | limite connue (WP12d/WP12f : stockage objet) |

## 8. Hors périmètre de ce lot

- Webhooks Stripe/Resend en production → **WP12d**
- Domaine personnalisé → **WP12f**
- Monitoring avancé (Sentry, Speed Insights) → **WP12f**
