# Rapport WP13e — Pages intérieures

Finalisation : 6 octobre 2026. Projet : PromptSport, port 3002.

## Réalisation

### Article

Hero de 1 200 px maximum au ratio 16/9, image prioritaire et titre superposé sur un dégradé sombre. Métadonnées avec photo auteur ou initiale, lien auteur, date relative, catégorie et estimation du temps de lecture. Le lien de catégorie mène au flux RSS de la rubrique, destination existante : aucune nouvelle page de catégorie n’a été inventée.

Colonne de lecture de 720 px maximum, texte de 18 px sur mobile et 20 px dès le breakpoint tablette, interligne 1,7. Les images Markdown autonomes deviennent des figures ; leur attribut title sert de légende lorsqu’il existe. Les citations gardent une bordure et un traitement sémantique.

Partage X/Twitter, Facebook et copie du lien. Deux barres de réactions partagent un seul état client et la Server Action existante ; celle du bas est rendue par portail, afin d’éviter deux états divergents et des requêtes dupliquées. Les favoris restent privés. Les commentaires, réponses, restrictions de bannissement et limites d’envoi sont conservés.

Le contrôle d’abonnement et le paywall existants sont conservés. Trois articles connexes maximum, issus de la même catégorie, avec images différées.

### Scores

Bandeau de direct, filtres de compétition en pastilles avec état actif, conservation du formulaire sport/compétition. Trois sections : En direct, À venir, Terminés récemment. Variante compacte de MatchCard avec deux lignes d’équipes, logos différés, score, statut et date. La variante existante reste utilisée par l’accueil. Publicité déplacée sous les sections pour rendre les scores accessibles plus tôt.

### Compétition

En-tête avec logo externe, nom, saison et pays lorsque renseigné. Onglets par query param : classement, résultats, calendrier. Tableau à dix colonnes avec logos et défilement horizontal au clavier. Résultats et calendrier : trente cartes maximum. Calcul du classement existant conservé.

Les positions sont colorées avec des repères visuels indicatifs : quatre premières, deux suivantes, trois dernières. La page précise que ces repères ne déterminent pas les qualifications européennes ni les relégations officielles. Le modèle ne contient pas les règles par ligue/saison ; les présenter comme des places officielles serait inexact. Ce choix reste une différence explicite avec le brief initial : sans précision supplémentaire, les couleurs restent indicatives et ne sont pas étiquetées LDC/Europa/relégation officielle.

### Match

Affiche avec logos, score agrandi, compétition, statut, date et lieu. Quatre onglets par query param : Résumé, Compositions, Statistiques, Commentaires. Les champs détaillés correspondants n’existent pas dans le modèle Match : messages « disponibles prochainement » affichés, sans fabrication de données ni nouveau système de commentaires. Composant EventTimeline préparé, actuellement dans son état vide. Articles liés recherchés par présence des deux noms courts d’équipe dans le titre.

## Périmètre

Quatre pages modifiées : article, scores, compétition et match. Neuf composants créés : ArticleHero, ArticleMeta, ShareButtons, RelatedArticles, CompetitionHeader, CompetitionTabs, MatchHeader, MatchTabs, EventTimeline. Deux composants existants adaptés : MatchCard et StandingsTable. Suite scripts/check-wp13e.cjs et ce rapport ajoutés.

Aucune modification de l’accueil, des autres pages publiques, du studio, du backoffice, du schéma, des Server Actions ou du système de thème dans ce lot. Aucune bibliothèque ajoutée. Les changements des lots précédents présents dans le dossier sont conservés. Port 3000 non utilisé.

Métadonnées conservées, ainsi que les JSON-LD NewsArticle, ItemList, SportsOrganization et SportsEvent. Requêtes groupées avec relations sélectionnées, sans boucle N+1. Aucun événement, composition ou résultat inventé.

## Vérifications

- TypeScript et ESLint : réussis avant le build.
- Suite d’intégration : 60 contrôles réussis en développement, dont paywall anonyme, structures, filtres, sept onglets compétition/match, JSON-LD et absence de couleurs en dur dans les quatre pages.
- Responsive : douze contrôles de largeur (quatre pages × 375, 768, 1440 px), sans débordement horizontal global, avec un seul h1 par page.
- Navigation clavier : onglet Résultats activé par Entrée, paramètre tab et cartes vérifiés.
- Copie du lien : message « Lien copié » observé.
- Réactions : trois boutons confirmés dans la barre basse. Aucun vote ni commentaire publié pendant les contrôles.
- Lisibilité nuit : vérification visuelle ; audit DOM sans défaut sur les textes de match (18), compétition (200) et scores (163). Les contrastes sur photos demandent une appréciation distincte ; le titre du hero repose sur un voile sombre.
- Logos match et compétition observés chargés. Leur disponibilité reste dépendante du fournisseur externe déjà utilisé par le projet.

Build final : npm run build réussi, code 0. Serveur relancé en production sur le port 3002.

Suite finale : node scripts/check-wp13e.cjs --production — 62 contrôles réussis. Le filtre Ligue 1 est vérifié sur les cartes rendues. Un fragment de fin du contenu premium et le texte intégral sont absents de la réponse HTML/RSC anonyme de production.

Limites : aucune publication de réaction/commentaire de test, aucun nouvel abonnement créé, pas de données de compositions ou statistiques à valider. Les états correspondants sont vérifiés vides. La vérification du contenu premium porte sur la version de production, les réponses de développement pouvant contenir des informations de débogage supplémentaires.

Captures :
- [Article en nuit](C:/Users/Belco/.codex/visualizations/2026/09/27/01a0e1cd-b1b3-7cc0-96ea-0d51afe9836b/wp13e-article-nuit.png)
- [Fiche match en nuit](C:/Users/Belco/.codex/visualizations/2026/09/27/01a0e1cd-b1b3-7cc0-96ea-0d51afe9836b/wp13e-match-nuit.png)

Le thème de vérification a été remis sur Système et les dimensions temporaires du navigateur ont été réinitialisées.
