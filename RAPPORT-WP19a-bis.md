# Rapport WP19a-bis — Validation et intégration d'AllSportsApi

## Phase 1 — Validation : **OK (15/15)**

Script : `scripts/test-allsports.cjs` (exécution : `node scripts/test-allsports.cjs`).
3 tests demandés, 7 requêtes consommées sur un quota de 100/jour, débit limité à
5 req/s (espacement 320 ms) et plafond de 10 requêtes par exécution.

| Contrôle | Résultat |
| --- | --- |
| Liste des ligues | **272 catégories**, la France présente (id 7) |
| Ligues françaises | 13 ligues, **Ligue 1 = id 34** |
| Saison en cours | **26/27** (id 96127) parmi 57 saisons |
| Équipes de Ligue 1 | **18 équipes** (Olympique de Marseille, …) |
| Matchs de la saison | **30 joués + 30 à venir**, scores présents (Paris FC 3-0 Nice) |
| Scores en direct | **260 matchs en cours** (`/api/matches/live`, ex. Moreirense – Gil Vicente) |
| Quota restant | affiché à chaque appel (`x-ratelimit-requests-remaining`) |

**Décision : validation OK → Phase 2 autorisée.**

### Découverte décisive : l'accès passe par RapidAPI

- `https://allsportsapi.com/api/football/...` → HTTP 404 (« File not found »).
- `https://apiv2.allsportsapi.com/football/...` → `{"error":"1","result":[{"msg":"Wrong login credentials"}]}`
  (l'API renvoie **HTTP 200 même en erreur** : le script écarte explicitement ces
  charges utiles, sinon un échec passerait pour un succès).
- `https://allsportsapi2.p.rapidapi.com/...` avec `x-rapidapi-key` /
  `x-rapidapi-host` → **200**. C'est le mode retenu.

Les chemins du brief (`/v1/json/3/all_leagues.php`) n'existent pas sur ce
fournisseur — ce sont ceux de TheSportsDB, dont l'abonnement n'est d'ailleurs pas
le nôtre (`403 You are not subscribed to this API`). Les vrais endpoints ont été
relevés dans la spécification OpenAPI publiée par l'éditeur de l'API
([recodexapicodeexamples/allsportsapi/openapi](https://github.com/lacassef/recodexapicodeexamples/tree/master/allsportsapi/openapi)
et [fiche RapidAPI](https://rapidapi.com/fluis.lacasse/api/allsportsapi2)) :

| Besoin | Endpoint |
| --- | --- |
| Catégories (pays) | `/api/tournament/categories` |
| Ligues d'un pays | `/api/tournament/all/category/{id}` |
| Recherche d'une ligue | `/api/search/unique-tournaments?q=…` |
| Saisons | `/api/tournament/{id}/seasons` |
| Équipes d'une saison | `/api/tournament/{id}/season/{seasonId}/teams` |
| Matchs | `/api/tournament/{id}/season/{seasonId}/matches/{last\|next}/{page}` |
| Direct | `/api/matches/live` |

## Phase 2 — Adaptation du service

| Fichier | Nature |
| --- | --- |
| `src/lib/allsports-sync.ts` | **créé** — service AllSportsApi (`syncCompetition`, `syncAllCompetitions`) |
| `scripts/sync-football.ts` | modifié — utilise le nouveau service, option `--dry-run` |
| `.env.example` | modifié — `ALLSPORTS_API_KEY`, `ALLSPORTS_SEASON`, `ALLSPORTS_MATCH_PAGES` |
| `README.md` | modifié — section WP19a-bis (hôte, quotas, endpoints, bascule à confirmer) |
| `scripts/test-allsports.cjs` | **créé** — Phase 1 |
| `src/lib/api-football-sync.ts` | **non modifié** (conservé comme repli) |

Identifiants retenus (relevés via l'API) : **FL1 = 34**, PL = 17, PD = 8 (LaLiga),
SA = 23, BL1 = 35, CL = 7 (UEFA Champions League).

Mapping implémenté :

- `Competition` : nom, `externalId` (id de tournoi), pays, sport `football`, saison (`26/27`) ;
- `Team` : nom, `externalId`, `logoUrl` (**null** : l'API n'expose pas d'URL de logo
  exploitable côté navigateur), pays, sport ;
- `Match` : `scheduledAt` (depuis `startTimestamp`), `homeScore` / `awayScore`
  (`…Score.current`), `status`, `venue` (`venue.stadium.name`) ;
- statuts : `finished/ft` → FINISHED · `notstarted/ns` → SCHEDULED ·
  `inprogress/1st half/2nd half/halftime/live` → LIVE · `postponed/suspended/interrupted` → POSTPONED ·
  `canceled` → CANCELLED. La détection lit `status.type` **et** `status.description`,
  et un statut inconnu fait échouer l'import plutôt que d'écrire un statut faux.

Le service reprend l'architecture de WP19a : cache mémoire (30 s pour le direct,
1 min pour les matchs, 5 min sinon), registre de quota partagé entre processus
(100 requêtes/24 h, répertoire dérivé du SHA-256 de la clé), verrou consultatif
PostgreSQL pendant l'écriture, et **reprises automatiques** (3 tentatives) — l'API
a renvoyé plusieurs fois des réponses vides ou expirées pendant la mise au point.

### Deux bugs corrigés avant d'écrire quoi que ce soit

1. **Saison 1999-2000 importée au lieu de 2026-2027** : les libellés de saison
   (`26/27`, `99/00`) se triaient comme des chaînes, donc « 99/00 » passait en
   premier. Le tri convertit désormais le libellé en année sur quatre chiffres.
2. **« Unexpected end of JSON input »** : l'API renvoie parfois HTTP 200 avec un
   corps vide. Les réponses vides, illisibles ou 5xx sont maintenant retentées, et
   une page de matchs en échec n'interrompt plus la compétition.

### Vérification sans écriture (`--dry-run`)

```
OK | FL1 — Ligue 1 (id 34) · saison 26/27 (id 96127)
     équipes : 18 | matchs : 106 (46 avec score, 1 en direct) | FINISHED=45, LIVE=1, SCHEDULED=60
OK | PL  — Premier League (id 17) · saison 26/27 (id 96668)
     équipes : 20 | matchs : 110 (50 avec score) | FINISHED=50, SCHEDULED=60
OK | SA  — Serie A (id 23) · saison 26/27 (id 95836)
     équipes : 20 | matchs : 110 (50 avec score) | FINISHED=50, SCHEDULED=60
```

### Les données existantes sont protégées

`assertMigrated()` refuse d'écrire tant que des compétitions d'un autre
fournisseur sont présentes. Vérifié en lançant une synchronisation réelle :

```
Ligue 1 : Des compétitions d'un autre fournisseur sont présentes (identifiants
football-data.org). La bascule vers AllSportsApi doit être confirmée explicitement :
sauvegardez la base puis exécutez le script de migration avant de synchroniser.
0 compétition(s), 0 équipe(s), 0 match(s), 1 erreur(s).
```

Aucune requête API n'a été consommée par cette tentative et **aucune donnée n'a
été modifiée** (6 compétitions, 111 équipes, 1 889 matchs toujours en base).

## Vérifications

| Contrôle | Résultat |
| --- | --- |
| `npm run build` | **réussi** |
| `npx tsc --noEmit` | exit 0 |
| `npx eslint` (`allsports-sync.ts`, `sync-football.ts`) | exit 0, aucun avertissement |
| `node scripts/test-allsports.cjs` (Phase 1) | 15/15 |
| `npx tsx scripts/sync-football.ts FL1 PL SA --dry-run` | 3 ligues, 0 erreur |
| Synchronisation réelle (garde-fou) | refusée, base intacte |

## Base de test séparée — créée, import en attente du quota

Décision retenue : **base de test séparée** (la base principale n'est pas touchée).

| Élément | État |
| --- | --- |
| Base `promptsport_allsports` (conteneur `promptsport-pg`) | **créée** |
| Migrations Prisma | **appliquées** (`prisma migrate deploy` sur cette base) |
| Import des 3 ligues | **à relancer** : quota RapidAPI épuisé (HTTP 429, `remaining: 0`, réinitialisation le **samedi 10 octobre 2026 vers 18 h 29**) |
| Base principale | intacte : 6 compétitions, 111 équipes, 1 889 matchs |

Le quota de 100 requêtes/jour a été consommé par la validation Phase 1, la
découverte des identifiants et les trois passes de `--dry-run`. Le registre local
du service ne compte que les requêtes qu'il émet lui-même : les scripts
d'exploration ponctuels ne le traversent pas, il ne faut donc pas s'y fier comme
autorité (l'en-tête `x-ratelimit-requests-remaining` de RapidAPI reste la source).

Commande à lancer une fois le quota revenu (aucune autre modification requise) :

```bash
DATABASE_URL="postgresql://promptsport:promptsport@localhost:5432/promptsport_allsports?schema=public" \
  npx tsx scripts/sync-football.ts FL1 PL SA
```

Puis, pour contrôler le résultat :

```bash
DATABASE_URL="postgresql://promptsport:promptsport@localhost:5432/promptsport_allsports?schema=public" \
  npx prisma studio      # ou une requête count sur Competition / Team / Match
```

## Points ouverts / limites


- **Bascule à confirmer** : Phase 2 n'écrit rien pour l'instant. Deux options à
  valider : (a) synchroniser dans une **base de test séparée**, ou (b) migrer la
  base actuelle après sauvegarde (`backups/`, dossier ignoré par Git).
- **Logos d'équipes** : non fournis par l'API (`logoUrl` restera `null`) ; les
  pages publiques utilisent déjà un visuel de repli.
- **Matchs partiels** : l'import parcourt `matches/last|next/{page}` (30 matchs
  par page et par sens, 4 pages par défaut → jusqu'à ~240 matchs par ligue, donc
  une saison complète n'est pas garantie). Réglable par `ALLSPORTS_MATCH_PAGES`.
- `next.config.ts` doit autoriser l'hôte des images si des logos distants
  arrivent un jour (aujourd'hui sans objet).
