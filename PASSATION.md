# Note de passation — PromptSport

> Rédigée le 07/10/2026 pour reprendre le travail dans une **session neuve**.
> Contexte : la session DSH précédente est devenue trop lourde (transcription de 17,3 Mo compressés)
> et figeait l'interface. Tout l'état utile est sur le disque : cette note suffit à redémarrer.

---

## 1. Où en est le dépôt (vérifié)

| Élément | Valeur |
| --- | --- |
| Branche | `main`, à jour avec `origin/main` (0 devant / 0 derrière) |
| Dernier commit | `95f7348 feat(theme): fondations clair/sombre/systeme (next-themes, palette semantique, toggle)` |
| Travail non commité | **169 entrées** : 128 fichiers modifiés + 41 nouveaux |
| Fichiers à 0 octet / écritures interrompues | aucun |
| Stack | Next.js 15.5.26 (App Router, Turbopack), React 19.1.0, Prisma 7.10.0, Tailwind v4, Auth.js v5 beta, next-themes 0.4.6 |
| Base locale | PostgreSQL 17 dans le conteneur Docker `promptsport-pg` (port 5432, démarré) |
| Serveur local | `npm run dev` sur **http://localhost:3002** (le port 3000 est occupé par ClipMagic) |

**Conséquence importante : `origin/main` est en retard, donc Vercel sert encore l'ancienne version du site.**

---

## 2. Ce qui est terminé et validé

- **WP1 → WP12a** : migration SQLite → PostgreSQL, suites de tests vertes, `npm run build` propre.
- **WP12b** : configuration de déploiement Vercel + Neon.
- **Identité** : logo « PromptSport » (jour/nuit), emplacements publicitaires, bandeau de scores en direct.
- **WP13a** : fondations du thème clair/sombre/système (`next-themes`, palette sémantique, `ThemeToggle`).
- **WP13b → WP13e** : thème appliqué aux composants et pages, refonte éditoriale de l'accueil,
  pages intérieures (compétition, match), comptes lecteurs + OAuth, CSS éditorial (`src/app/editorial.css`).
- **Rail de partage d'article** (dernier chantier, non commité) : voir §4.

Rapports détaillés présents à la racine : `RAPPORT-COMPTES-LECTEURS.md`, `RAPPORT-WP13b.md`,
`RAPPORT-WP13c.md`, `RAPPORT-WP13d.md`, `RAPPORT-WP13e.md`.

---

## 3. Décision en attente : commit + push

Rien n'est commité depuis `95f7348`. Proposition retenue mais **non exécutée** (en attente de l'accord
utilisateur) : **un commit par lot**, dans cet ordre :

1. `WP13b→WP13e` — thème des composants et pages + CSS éditorial + suites `check-wp13c/d/e`.
2. `Comptes lecteurs` — OAuth, `inscription`, `bienvenue`, `mon-compte`, migration `20261006100000_reader_oauth`.
3. `Rail de partage article` — `ArticleShareLinks.tsx`, `ShareButtons.tsx`, `src/app/article/[slug]/page.tsx`.
4. `Espace de travail` — `workspace.css`, `WorkspaceFrame.tsx`, `scripts/migrate-workspace-theme.cjs`.
5. `Espace abonné — mise en page` — `WorkspaceFrame.tsx` + `PublicShell.tsx` : **deux colonnes**, menu de
   gauche de 26 rem (`md:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]`), **collé en haut et de la hauteur de
   l'écran** (`md:sticky md:top-0 md:h-dvh`), bouton « Se déconnecter » **ancré en bas** (`mt-auto pt-6`) ;
   l'**en-tête du site est masqué** sur `/mon-compte` et la **croix de fermeture est fixée en haut à droite
   de l'écran** (`fixed right-4 top-4 z-40`), en lien vers l'accueil ; les rubriques d'équipe (Studio,
   Backoffice) sont petites, en haut à droite du contenu, décalées à gauche de la croix, et invisibles
   pour un lecteur. Les 4 pages `mon-compte` sont en `max-w-4xl`.
6. `Détails du compte — contenu` — `src/app/mon-compte/page.tsx` ne garde que **Profil** et **Sécurité**,
   présentés comme le formulaire de connexion (ni carte, ni ombre : champs `h-[60px] rounded-none
   border-muted-foreground`, boutons `min-h-[60px] bg-primary` en majuscules). L'**historique des
   paiements** a été déplacé vers `/mon-compte/abonnement` et l'**aperçu des notifications** supprimé
   (la liste complète reste sur `/mon-compte/notifications`). Suites adaptées en conséquence :
   `check-wp7d` (marqueurs et actions d'abonnement sur `/mon-compte/abonnement`, manifeste des actions
   client de cette page), `check-wp10d` (aperçu retiré), `check-wp9` (sections et tableau de défilement).
7. `WP15c — embeds sociaux` — `react-social-media-embed`, `remark-directive`, `unist-util-visit` et
   `mdast-util-directive` installés ; `src/lib/social-embeds.ts` (registre des 8 plateformes),
   `src/lib/remark-social-embeds.ts` (plugin), `src/components/embeds/{SocialEmbed,SocialEmbedButton,
   social-embed-directive}.tsx`, branchements dans `RichTextEditor.tsx` et
   `src/app/article/[slug]/page.tsx`, styles dans `globals.css` et `editorial.css`,
   nouvelle suite `scripts/check-wp15c.cjs` (25/25) et `RAPPORT-WP15c.md`.
   Bluesky n'a pas de composant dans la bibliothèque : carte de lien à la place.
   `check-public-pages` corrigée au passage (elle sélectionnait un article sans mise en forme car son
   motif `*` captait les puces de liste) : 11/11.
8. `WP15b — upload d'images dans l'éditeur` — `src/components/editor/imageUploadPlugin.tsx` (bouton
   « Insérer une image », dialogue fichier + légende, validation MIME/5 Mo, état « Upload en cours… »),
   branché dans `RichTextEditor.tsx`, styles dans `globals.css` ; **`actions.ts` non modifié** (la
   Server Action `uploadImage` de WP12d est réutilisée telle quelle) ; nouvelle suite
   `scripts/check-wp15b.cjs` (29/29) et `RAPPORT-WP15b.md`. Le Markdown inséré est
   `![légende](URL "légende")` : le rendu public prend la légende visible du `title`.
   À savoir : `next.config.ts` sépare les builds (`.next` en dev, `.next-production` en production)
   et les identifiants de Server Action diffèrent entre les deux.
9. `WP15d — citations enrichies + aperçu live` — `src/lib/remark-quotes.ts` (plugin `::quote{…}`),
   `src/components/BlockquoteEnriched.tsx`, `src/components/editor/quoteDirective.tsx` (bouton +
   descripteur), **`src/components/MarkdownRenderer.tsx`** (rendu partagé, désormais utilisé aussi par
   `src/app/article/[slug]/page.tsx`), onglets Éditer/Aperçu avec débounce 500 ms dans
   `RichTextEditor.tsx`, styles dans `globals.css`, suite `scripts/check-wp15d.cjs` (36/36) et
   `RAPPORT-WP15d.md`. Les pages `studio/articles/new` et `[id]/edit` restent inchangées : l'état du
   contenu vit dans `ArticleForm.tsx`, les onglets sont donc dans l'éditeur.
10. `WP16a — modèle Themes` — `prisma/schema.prisma` (modèle `Theme` + `themes Theme[]` sur
    `Article`, many-to-many implicite `_ArticleToTheme`), migration
    `20261008122615_add_theme_model` (appliquée), `prisma/seed.cjs` (5 thèmes : mercato, tactique,
    interviews, competitions, transferts — idempotent), `src/lib/themes.ts` (helpers de badge),
    `src/app/backoffice/themes/page.tsx`, lien « Thèmes » dans `BackofficeNav.tsx`, suite
    `scripts/check-wp16a.cjs` (32/32) et `RAPPORT-WP16a.md`. `Category` non modifiée.
    À savoir : la migration a été créée avec `migrate dev --create-only` puis appliquée avec
    `migrate deploy` pour ne jamais risquer un reset de la base locale.
11. `WP16b — sélecteur de thèmes` — `src/components/studio/ThemeSelector.tsx` (badges cliquables,
    `role="checkbox"`, couleur + icône), `ArticleForm.tsx` (sélecteur après la catégorie + champ caché
    `themeIds`), `actions.ts` (`readThemeIds`, `keepExistingThemeIds`, `connect`/`set`),
    `new/page.tsx` / `[id]/edit/page.tsx` (chargement et pré-sélection), colonne « Thèmes » dans
    `studio/articles/page.tsx`, badges liés vers `/theme/[slug]` dans `ArticleMeta.tsx` + page article,
    styles `.theme-badge` dans `globals.css`, suite `scripts/check-wp16b.cjs` (40/40) et
    `RAPPORT-WP16b.md`. La page `/theme/[slug]` reste à créer (WP16c).
    Note : `lucide-react` n'a pas d'import dynamique par nom — les icônes de thèmes passent par le
    registre `THEME_ICONS` du sélecteur.
12. `WP16c — pages publiques de thèmes` — `src/app/theme/[slug]/page.tsx` (en-tête, liste paginée de
    12, filtre par format, `generateMetadata`, JSON-LD `ItemList`, 404 si thème absent **ou inactif**,
    ISR 60 s), `src/components/ThemeHeader.tsx`, `src/components/FormatFilter.tsx`, thèmes actifs
    ajoutés au `sitemap.ts`, registre d'icônes déplacé dans `src/lib/themes.ts` (`themeIcon()` — d'où
    un ajustement de 2 lignes dans `ThemeSelector.tsx`), suite `scripts/check-wp16c.cjs` (38/38) et
    `RAPPORT-WP16c.md`. `Footer.tsx` volontairement non modifié (lien optionnel, coût d'une requête
    sur toutes les pages).
13. `WP16d — accueil thématique` — `src/components/ThemeTabs.tsx` (onglets accessibles au clavier,
    `tablist`/`tab`/`tabpanel`), `src/components/ThemeCard.tsx`, `src/app/themes/page.tsx` (index des
    thèmes actifs, comptage des articles publiés), `src/app/page.tsx` (bloc d'onglets sous le hero,
    bloc Mercato basé sur le **thème** `mercato`, bloc Analyses → `/theme/tactique`, lien « Tous les
    thèmes », filtre `?rubrique=mercato` désormais sur le thème), `SectionBlock.tsx` (`linkLabel`),
    suite `scripts/check-wp16d.cjs` (40/40) et `RAPPORT-WP16d.md`.
    Notes : les onglets viennent d'**une seule requête** (`ROW_NUMBER` + `LEFT JOIN` pour garder les
    thèmes vides) ; la clé `unstable_cache` de l'accueil est passée à `home-editorial-wp16d` ;
    `sitemap.ts` n'a pas été modifié (hors périmètre) donc `/themes` n'y figure pas.
14. `Hors brief — retouches demandées en direct` (après WP16d, sans document de lot) :
    - **pastille de compte** (`src/components/UserMenu.tsx`) : cercle avec l'icône seule, **sans nom
      affiché** (nom conservé en `aria-label`/`title`), **badge Premium en bas à gauche** du cercle,
      **compteur de notifications en haut à droite** ;
    - **badge Premium** (`src/components/PremiumBadge.tsx`) : rosette étoilée (lucide `Award`) au lieu
      du cadenas ;
    - **bandeau urgent** : `src/components/UrgentBanner.tsx` réécrit en **fine barre au-dessus de
      l'en-tête** sur toutes les pages publiques, avec point animé (`.urgent-pulse`, animation CSS
      neutralisée par `prefers-reduced-motion`). Article : `getUrgentArticle()` dans
      `src/lib/featured.ts` — **manuel** via l'emplacement `URGENT` du studio (`/studio/une`), sinon
      **automatique** = dernier `FLASH`/`NEWS` publié ; mis en cache 60 s dans `src/app/layout.tsx`.
      L'encart urgent de la page d'accueil a été retiré (doublon).
    - **alignement des largeurs** : conteneur unique `max-w-[1280px] px-4` pour l'en-tête, le pied de
      page, l'accueil, `/themes` et `/theme/[slug]` (il n'y avait plus de `max-w-6xl`).
    - `check-wp10d` corrigé au passage (93/93) : le contrôle « menu utilisateur et notifications »
      visait le mauvais fichier et datait d'avant la pastille.
15. `WP20 — thèmes éditoriaux (mise à jour)` — migration SQL manuelle
    `20261010120000_update_editorial_themes` (désactive `transferts`, réaffecte ses articles vers
    `mercato`, puis supprime les anciennes associations — dans cet ordre, avec une garde `EXISTS` pour
    éviter un `B` NULL sur une base non seedée), `prisma/seed.cjs` (9 thèmes : + Blessures, Polémiques,
    Power Ranking, Opinion ; `active` désormais mis à jour ; idempotent), `src/lib/themes.ts`
    (4 icônes : `HeartPulse`, `Flame`, `TrendingUp`, `MessageSquareQuote`), suite
    `scripts/check-wp20.cjs` (33/33) et `RAPPORT-WP20.md`. Résultat : **8 thèmes actifs**,
    `/theme/transferts` → 404, les 4 nouveaux accessibles, 8 onglets sur l'accueil et 8 cartes sur
    `/themes`. Les suites `check-wp16a/b/c/d` ont été mises à jour (9 en base, 8 actifs) — `check-wp16b`
    et `check-wp16c` ont même été réécrites après un incident de manipulation (voir §5).
16. `WP19a-bis — AllSportsApi` — Phase 1 validée (15/15) par `scripts/test-allsports.cjs` :
    la clé `ALLSPORTS_API_KEY` fonctionne **uniquement via RapidAPI**
    (`allsportsapi2.p.rapidapi.com`, en-têtes `x-rapidapi-key`/`x-rapidapi-host`) ; `allsportsapi.com`
    répond 404 et `apiv2.allsportsapi.com` « Wrong login credentials » (avec HTTP 200 !). Endpoints
    réels : `/api/tournament/categories`, `/api/tournament/all/category/{id}`, `/api/tournament/{id}/seasons`,
    `/api/tournament/{id}/season/{sid}/teams`, `/api/tournament/{id}/season/{sid}/matches/{last|next}/{page}`,
    `/api/matches/live`. Ids : FL1=34, PL=17, PD=8, SA=23, BL1=35, CL=7 ; saison 26/27.
    Phase 2 : `src/lib/allsports-sync.ts` (cache, registre de quota 100/24 h, 3 tentatives, mapping des
    statuts), `scripts/sync-football.ts` adapté (+ `--dry-run`), `.env.example` et `README.md` à jour ;
    `api-football-sync.ts` conservé en repli (non modifié). `RAPPORT-WP19a-bis.md`.
    **Base de test** : `promptsport_allsports` créée dans le conteneur et migrée ; l'import des 3 ligues
    reste à lancer car le quota RapidAPI (100/jour) a été consommé par la validation et les dry-runs
    (HTTP 429, réinitialisation le 10/10/2026 ~18 h 29). Commande :
    `DATABASE_URL="postgresql://promptsport:promptsport@localhost:5432/promptsport_allsports?schema=public" npx tsx scripts/sync-football.ts FL1 PL SA`.
    La base principale est intacte (6 compétitions / 111 équipes / 1 889 matchs).
17. `Rapports` — les `RAPPORT-*.md`.

Ne pas oublier `PASSATION.md` (ce fichier) : à committer ou à supprimer, au choix.

---

## 4. Dernier chantier : rail de partage de l'article

Fichiers : `src/components/ArticleShareLinks.tsx` (composant serveur, nouveau),
`src/components/ShareButtons.tsx` (réécrit), `src/app/article/[slug]/page.tsx`.

Comportement demandé et implémenté :

- 5 réseaux : X, Facebook, LinkedIn, WhatsApp, e-mail — icônes SVG en ligne, **couleurs de marque
  en mode jour**, repli sur la couleur de texte du thème en mode nuit.
- **Rail vertical unique** sur le bord gauche de l'article, structurellement aligné sur le début du
  premier paragraphe (colonne flex sœur du corps du texte, pas de marge calculée), `sticky top-32`
  avec un espace prévu sous l'en-tête.
- Sur le rail uniquement : un 6ᵉ bouton **Commentaires** avec le nombre de commentaires `APPROVED`
  (badge `bg-[#d7ff00]` + `text-[#111211]`, lisible dans les deux thèmes). Pas de bouton commentaires
  en bas d'article.
- En fin d'article : **uniquement** la barre de réactions (J'aime / J'adore / Enregistrer).
- Les anciens blocs dupliqués (barre de partage en tête d'article, réactions en tête, partage en bas)
  ont été supprimés ; `ShareButtons.tsx` ne contient plus que `ArticleReactionBars`.
- Partages par e-mail : vraie icône d'enveloppe (tracé `fill-rule="evenodd"`).

Dernières vérifications passées : `check-wp13e` 62/62, `check-public-pages` 11/11, `npx tsc --noEmit`
et `npx eslint` propres, `/article/...` en 200, badge commentaires présent avec fond lime et la règle
CSS `bg-[#d7ff00]` bien générée.

---

## 5. Points ouverts / dette connue

- **Breakpoint du rail** : `xl` (1280 px). Passer à `lg` (1024 px) si on veut le rail sur écrans moyens.
- **Alignement** : le rail est aligné sur le premier paragraphe ; l'aligner sur le chapô est une variante possible.
- **`check-wp7c`** : 6–7 échecs en mode dev (contenu complet de l'article présent dans le payload RSC) —
  ces mêmes contrôles passent en production (30/30). Artefact connu, pas une régression.
- **`check-stripe-live.cjs`** : harnais interactif multi-étapes, ne produit pas de `RESULTAT` sans arguments.
- **`check-wp13b.cjs` n'existe pas** : la numérotation des suites saute de `check-wp13a` à `check-wp13c`.
- **`check-wp9` : 6 échecs préexistants** (81/87), dus à la refonte WP13b→WP13e, pas à l'espace abonné :
  le CSS ne contient plus `--font-inter: "Inter"` (polices locales), `PublicNav` n'utilise plus le motif
  `pathname.startsWith("/backoffice/")` cherché par la suite, les marqueurs de contenu de `/competition/[slug]`
  (« Diff », « J : joués ») et `/match/[id]` (« Informations du match », « Coup d'envoi », `text-5xl`) ont
  changé, et les deux listes d'autorisation (composants clients, icônes lucide) n'ont pas été mises à jour.
  À reprendre si ces garde-fous doivent rester verts.

---

## 6. Déploiement (quand le push sera fait)

1. Appliquer la migration sur Neon :
   `DATABASE_URL="<url-non-poolée>" npm run db:deploy`
   (migration en attente : `prisma/migrations/20261006100000_reader_oauth`).
2. Variables d'environnement **manquantes** pour l'OAuth : `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`,
   `AUTH_FACEBOOK_ID`, `AUTH_FACEBOOK_SECRET`. Sans elles, seuls e-mail/mot de passe fonctionnent.
3. Vérifier après déploiement que Vercel sert bien le nouveau `HEAD`.

---

## 7. Comment relancer l'environnement local

```powershell
# 1. Base de données
docker start promptsport-pg

# 2. Serveur de développement (le port 3002 est obligatoire)
$env:PORT="3002"
$env:RESEND_API_KEY="re_stub_local_test"
$env:RESEND_BASE_URL="http://127.0.0.1:3100"
npm run dev
```

**Suites de tests** : toutes celles qui utilisent `process.env.PORT || 3000` doivent être lancées avec
`PORT=3002`, sinon elles testent ClipMagic et échouent de façon trompeuse :

```powershell
$env:PORT="3002"
node scripts/check-wp13e.cjs
node scripts/check-public-pages.cjs
node scripts/check-reader-flow.cjs        # ajouter --keep-ui-fixture pour garder un compte de test
```

Suites disponibles : `check-articles-crud`, `check-auth-flow`, `check-auto-cancel`, `check-public-nav`,
`check-public-pages`, `check-reader-flow`, `check-stripe-live`, `check-upload`, `check-workflow`,
`check-workflow-roles`, `check-wp4`, `check-wp5`, `check-wp6a`, `check-wp6c`→`check-wp6e`,
`check-wp7a`→`check-wp7e`, `check-wp8a`, `check-wp8b`, `check-wp8d`, `check-wp9`,
`check-wp10a`→`check-wp10d`, `check-wp11a`→`check-wp11e`, `check-wp13a`, `check-wp13c`→`check-wp13e`.

Comptes de test (base locale) : `admin@example.com` / `admin123` (ADMIN),
`editor@example.com` / `password123`, `journalist@example.com` / `password123`.

---

## 8. Particularités de cet environnement

- **Le bac à sable de fichiers de DSH est inutilisable sur cette machine** :
  `windows-acl-run: --temp is not an existing directory: C:\Users\Belco\AppData\Local\Temp\dsh-00KgWO`.
  Toute commande shell doit donc être relancée avec `sandbox_permissions: danger-full-access`
  (le message d'erreur est explicite et n'est pas un bug de la commande).
  Les outils `read`, `grep`, `edit`, `write`, `glob` fonctionnent sans élévation.
- **Prisma** : le datasource n'a pas d'`url` (elle est dans `prisma.config.ts`), et `@prisma/adapter-pg`
  est chargé par un `require` **paresseux** dans `createPrismaClient()` — un import statique casse
  toutes les Server Actions (`Cannot read properties of undefined (reading 'bind')`).
- **Middleware Auth.js** : `getToken` doit recevoir `secureCookie: process.env.NODE_ENV === "production"`,
  sinon le cookie `__Secure-authjs.session-token` n'est pas lu en production.
- **Pages ISR** : les pages avec publicités ont `export const revalidate = 60` ; lire `auth()` côté
  serveur les rendrait dynamiques, d'où le composant client `AdSlotGate` (sauf la page article, déjà dynamique).
- **Tailwind v4** : configuration CSS-first avec `@config "../../tailwind.config.js"` ; le CSS écrit à la
  main doit utiliser `theme(--color-x)`.

---

## 9. Prochaine action recommandée

1. Ouvrir une session neuve sur `C:\Users\Belco\promptsport` (celle-ci est saturée).
2. Faire valider puis exécuter les commits du §3 (lot par lot), et pousser sur `origin/main`.
3. Enchaîner sur le déploiement du §6 (migration Neon + variables OAuth).
