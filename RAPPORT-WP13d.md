# Rapport WP13d — Accueil éditorial

Date : 5 octobre 2026. Projet : PromptSport, port 3002.

## Livraison

Refonte de l’accueil en huit blocs : matchs du jour, une et deux sujets secondaires, fil info, Mercato, Analyses, six compétitions, articles les plus lus et derniers articles paginés par douze. Le fil info précède la une sur mobile, passe sous la une sur tablette et reste sticky à droite sur ordinateur. Newsletter, abonnement, publicités conditionnelles et pied de page conservés.

Six composants serveur créés : TodayMatchesBar, HeroArticle, SecondaryArticle, MostReadList, CompetitionsGrid et SectionBlock. ArticleCard reçoit une option headingLevel, sans changer son niveau par défaut sur les autres pages. Les images de la une et des deux secondaires sont prioritaires ; les autres images sont différées.

Logos externes choisis explicitement par l’utilisateur. Source : https://crests.football-data.org/ ; les six URL FL1, PL, PD, SA, BL1 et CL ont répondu HTTP 200 avec un contenu image/png lors du contrôle réseau. Aucun fichier image local modifié.

## Données et fonctionnement

- Une : dernier article publié possédant une couverture, puis deux articles publiés distincts ; repli sans couverture si nécessaire.
- Mercato : catégorie mercato si elle existe, sinon football, maximum cinq articles.
- Analyses : catégorie analyses si elle existe, sinon contenu de plus de 1 000 caractères, maximum quatre articles.
- Fil info : huit dernières publications, tri stable par date puis identifiant. Le modèle ne possède pas de type brève/article : la distinction visuelle est une convention fondée sur la longueur (brève jusqu’à 1 000 caractères).
- Plus lus : groupBy AnalyticsPageView sur les sept derniers jours, cinq identifiants maximum ; seconde requête groupée pour leurs métadonnées. Cette exception à « une requête par bloc » est nécessaire car groupBy n’inclut pas les relations ; aucun N+1.
- Pagination : douze cartes et une treizième ligne de détection du bouton Voir plus, sans requête count. Les filtres Mercato/Analyses sont conservés dans la pagination.
- Cache éditorial : 60 secondes ; matchs : 30 secondes. Dates restaurées après désérialisation. Le contenu intégral, notamment premium, n’est pas envoyé à l’accueil.
- Journée des matchs calculée dans Africa/Lagos (UTC+1). Les scores reflètent les données en base au chargement ; aucun nouveau mécanisme de synchronisation ou polling ajouté.

La base observée contient six publications : cinq cartes Mercato via le repli Football, quatre Analyses et cinq articles classés. Aucun match du jour. Les états vides sont explicites ; aucun contenu fictif ajouté pour remplir les quotas.

## Périmètre

Modifications de ce lot : src/app/page.tsx, les six composants ci-dessus, src/components/ArticleCard.tsx, scripts/check-wp13d.cjs et ce rapport. Métadonnées et JSON-LD conservés. Pas de bibliothèque ajoutée, migration, Server Action, modification du thème ni écriture en base. Les modifications antérieures WP13a/b/c présentes dans Git sont conservées. Le projet du port 3000 n’a pas été modifié.

## Validation

- TypeScript et ESLint : réussis.
- Suite node scripts/check-wp13d.cjs : 31 contrôles réussis sur le serveur de production (structure, titres, SEO, filtres, pagination et conservation des liens).
- Responsive : contrôlé à 390 px, 820 px et largeur bureau. Aucun débordement horizontal ; ordre mobile et tablette confirmé par les positions réelles.
- Contrastes : audit DOM de 173 éléments textuels en nuit sans échec ; en jour seuls les séparateurs décoratifs et le pictogramme de remplacement sont signalés, aucun texte informatif. Ce contrôle ne constitue pas un audit exhaustif de toutes les interactions.
- Police calculée : Inter ; logo blanc présent en nuit.
- LCP inférieur à 2,5 s : NON VALIDÉ. Lighthouse n’est pas installé et le navigateur de vérification n’expose pas PerformanceObserver dans son interface de lecture. Aucun score inventé ; une mesure Lighthouse de production reste nécessaire.
- Taille de première charge annoncée par Next pour / : 133 kB ; composants de page côté serveur (0 B de JavaScript propre à la route).
- Les logos passent par le proxy images Next déjà autorisé, afin de ne pas dépendre d’un accès direct du navigateur au fournisseur.

### Vérification des logos et limites de recette

Les six images ont été confirmées chargées dans le navigateur (dimensions naturelles non nulles), après passage par l’optimiseur Next. Les marques sombres disposent d’un support circulaire clair uniforme en mode nuit ; leurs couleurs originales sont préservées. Les emblèmes sont ceux distribués par football-data.org : leur millésime graphique dépend du fournisseur.

La base actuelle ne permet pas d’exercer le bouton Voir plus avec plus de douze publications ni un match réellement en direct. Le contrôle de pagination couvre une deuxième page vide, le retour précédent et un paramètre invalide. La logique des limites est implémentée, mais ces scénarios avec données supplémentaires ne sont pas déclarés testés en situation réelle.

Captures de recette :
- [Accueil jour](C:/Users/Belco/.codex/visualizations/2026/09/27/01a0e1cd-b1b3-7cc0-96ea-0d51afe9836b/wp13d-jour.png)
- [Ordre mobile nuit](C:/Users/Belco/.codex/visualizations/2026/09/27/01a0e1cd-b1b3-7cc0-96ea-0d51afe9836b/wp13d-mobile-nuit.png)

Build final : npm run build réussi (code 0), après la correction de chargement et de lisibilité des logos. Serveur livré en mode production sur le port 3002.

Contrôle après signalement « c’est bloqué » : localhost:3002 répond HTTP 200 en environ 2,2 s. L’onglet utilisateur a été rechargé ; le sélecteur de thème apparaît et son menu Jour/Nuit/Système répond. Les journaux signalent des délais dépassés pour certains anciens logos d’équipes distants, sans erreur HTTP de l’accueil. Les six logos de compétitions du nouveau bloc sont bien chargés. Ce temps HTTP ne mesure pas le LCP.
