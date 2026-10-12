# Rapport WP13c — Pages publiques Jour / Nuit

Date : 5 octobre 2026 · PromptSport · port **3002**

## Travail réalisé

Migration des couleurs fixes restantes vers les couleurs sémantiques sur les pages publiques : articles, scores, compétitions, matchs, auteur, abonnement et retours de paiement, quatre écrans de compte, connexion, newsletter et pages liées aux jetons, mentions légales et confidentialité. Les squelettes de chargement sont également harmonisés. L’accueil déjà habillé a été conservé.

Les changements concernent les fonds, textes, bordures, liens, champs, tableaux, états sélectionnés, messages de succès/erreur et survols. Les structures, contenus, contrôles d’accès, requêtes et actions métier restent identiques.

Composants secondaires traités : CommentsSection (incluant le rendu des commentaires ; aucun fichier CommentItem séparé n’existe), CommentForm, CommentReactions, ArticleReactions, ReportModal, NotificationItem, NotificationBadge, NotificationPreferences, NewsletterForm, SubscriptionStatus, SubscriptionTimeline, StandingsTable, UserMenu, apparence de ThemeToggle, LiveScoresBar, PlanCard et SportTabs. ScoresScroller a été contrôlé et conservé. AnalyticsChart est réservé au backoffice et n’a pas été modifié.

Les composants SubscriptionTimeline et SportTabs étant partagés avec le backoffice, leurs couleurs historiques restent intactes hors du conteneur public. Les adaptations y utilisent le sélecteur `.public-site`.

Tokens ajoutés dans la palette : surface secondaire, survol de l’action principale, voile de dialogue, action éditoriale et décoration des offres. Les couleurs des statuts conservent leur identité. Les fondations du thème, les trois choix Jour/Nuit/Système, Inter variable locale et les deux logos sont conservés.

## Défauts trouvés pendant les contrôles

- Le badge « Recommandé » présentait du texte blanc sur un fond orange clair en Nuit (1,69:1). La paire de couleurs a été corrigée pour utiliser les couleurs contrastées du statut.
- La légende d’article héritait encore d’un gris fixe (3,88:1 en Nuit). Elle utilise désormais `text-muted-foreground`, comme la légende de compétition.
- Les citations et blocs de code Markdown utilisent maintenant les variables sémantiques du thème ; les séparateurs ne gardent plus leur bordure claire fixe.

## Vérifications

### Suite reproductible

Fichier : `scripts/check-wp13c.cjs`.

```powershell
node scripts/check-wp13c.cjs --static
$env:PORT = '3002'
# Pour les contrôles authentifiés, définir les identifiants du compte de test :
$env:WP13C_TEST_EMAIL = 'adresse-du-compte-de-test'
$env:WP13C_TEST_PASSWORD = 'mot-de-passe-du-compte-de-test'
node scripts/check-wp13c.cjs
```

La suite contrôle les couleurs fixes dans 40 fichiers publics, l’isolation de deux composants partagés avec le CMS, 26 couples de contraste et les routes publiques/authentifiées. Les identifiants ne sont pas imprimés. Aucun formulaire métier n’est soumis.

Résultat de la passe complète : **92/92**. Les quatre routes authentifiées répondent 200 avec le compte de test. Les trois routes newsletter avec un jeton inexistant retournent 404 comme attendu. Les autres routes testées retournent 200.

### Contrastes et navigateur

Les 26 couples sémantiques mesurés dépassent 4,5:1. Le minimum est de 5,40:1 pour le texte secondaire sur surface en Jour ; les fonds d’action et les palettes de statut passent également.

Les couleurs calculées des textes présents dans le contenu principal ont été contrôlées dans le navigateur, avec le seuil de 4,5:1 ou 3:1 pour les grands textes. Après correction des défauts relevés, les pages suivantes ont été contrôlées dans **les deux thèmes**, sans échec sur les textes mesurés :

| Page | Textes mesurés par thème |
| --- | ---: |
| Accueil | 81 |
| Article | 47 |
| Newsletter | 21 |
| Offres d’abonnement | 29 |
| Compétition Bundesliga | 218 |
| Scores | 133 |
| Mon compte | 54 |
| Préférences de notification | 22 |
| Notifications | 10 |
| Mon abonnement | 31 |

L’article a été contrôlé de nouveau dans les deux thèmes après correction de sa légende : aucun défaut détecté sur les 47 textes mesurés. La connexion a été vérifiée en Nuit puis utilisée pour la session de test. Le compte de test a été déconnecté après inspection. Aucun profil, réglage, commentaire, notification ou abonnement n’a été modifié.

Ces mesures portent sur les textes effectivement rendus et les fonds opaques de leurs ancêtres. Elles ne constituent pas une certification exhaustive de tous les états, images, transparences, textes sur images et contenus futurs. La liste de notifications du compte de test était vide. Les écrans newsletter avec un jeton valide n’ont pas été activés, afin de ne pas modifier de consentement ; leurs sources et composants sont migrés, et leurs états de jeton invalide sont testés.

### Compilation et contrôles de code

- Lint des sources `src/app` et `src/components` : aucun défaut signalé. Le script CommonJS porte une exception documentée pour les imports `require`, puis passe son lint dédié.
- `git diff --check` : aucun défaut d’espacement ; avertissements de normalisation CRLF de Git uniquement.
- Build final : **réussi** : compilation, contrôles ESLint/TypeScript et génération des 28 pages statiques terminés, code de sortie 0.

## Périmètre préservé

Aucune modification des pages studio/backoffice, de `src/lib`, des Server Actions, du schéma Prisma, du middleware ni de ThemeProvider. Aucun ajout de bibliothèque ou fonctionnalité métier. Le composant ThemeToggle ne reçoit que des substitutions de classes de couleur dans ce lot. Aucun changement de Clipmagic ni du port 3000.

Les substitutions de couleurs conservent la structure et l’habillage Jour existants ; certains tons secondaires et de statut ont été harmonisés ou corrigés pour la lisibilité, sans prétendre à une identité pixel par pixel avec toutes les anciennes nuances fixes.

## Limite externe déjà connue

Le fournisseur `crests.football-data.org` présente encore des délais d’attente sur certains logos d’équipes. La migration ne supprime ni ne masque les images, mais ne résout pas cette indisponibilité distante. Les couvertures d’articles et les logos PromptSport locaux restent affichés.

## Livraison

Code local et suite de contrôle livrés avec ce rapport. Aucun déploiement, publication ou commit n’est inclus. Le serveur a été remis sur **3002** après le build et le mode Système a été rétabli à la fin des vérifications. La dernière passe statique, après les corrections finales, donne **68/68**.
