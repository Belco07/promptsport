# Rapport WP13b — Cohérence Jour / Nuit des composants publics

Date : 5 octobre 2026. Projet : PromptSport, port **3002**.

## Résultat et périmètre

Les composants publics ont été harmonisés avec l’habillage éditorial existant. Le sélecteur conserve **Jour, Nuit et Système** : Système suit la préférence de l’appareil, y compris ses changements automatiques ; un choix manuel est mémorisé. Aucune fonctionnalité métier n’a été retirée.

Ce rapport couvre le travail WP13b et les compléments demandés pendant sa réalisation : barre des scores, Inter variable de Clipmagic et logo blanc du thème Nuit. Il ne constitue pas une certification exhaustive de toutes les pages et de tous les états authentifiés.

## Modifications livrées

| Élément | Intervention |
| --- | --- |
| Button, Card, Input | Couleurs sémantiques appliquées dans le périmètre public : fonds, textes, bordures, placeholders et états désactivés. Les classes historiques restent disponibles hors de ce périmètre pour préserver le CMS. |
| Select, Textarea | Bénéficient des styles communs `fieldStyles` et `Field` modifiés dans Input ; pas de duplication de code. |
| Badge | Palettes adaptées pour les statuts neutre, succès, erreur, avertissement, direct et premium. Le doré du premium est conservé. |
| PremiumBadge, StatusBadge | Héritent des changements de Badge ; leurs règles métier sont inchangées. |
| ArticleCard, MatchCard | Fonds, titres, extraits, métadonnées et scores adaptés au thème. |
| Paywall | Fondu vers le fond courant plutôt que vers un blanc fixe ; encart et badge dorés adaptés à Nuit. |
| Navigation et pied de page | Conservation de l’harmonisation réalisée avant ce lot ; surfaces liées au thème. Le pied de page reste clair en Jour conformément à la correction demandée contre l’alternance de gros blocs noirs et blancs. |
| Connexion | Champs, carte, titres, bordures et message d’erreur adaptés, sans modification de l’action de connexion. |
| Barre des scores | Présentation sur deux lignes, score encadré, scrollbar native masquée, flèches précédent/suivant désactivées aux extrémités. Glissement tactile, liens et navigation clavier conservés. Respect de la préférence de mouvement réduit. |
| Navigation des compétitions | Scrollbar native masquée sur mobile ; liens et défilement conservés. |
| Inter variable | Copie locale des fichiers normal/italique de Clipmagic, graisses 100–900, licence conservée, variable `--font-inter`. Aucun téléchargement Google Fonts requis pour cette police. |
| Alternantes Inter | Le CSS généré ne contenait pas le réglage `salt` fourni à `localFont`. Application explicite de `font-feature-settings: "salt" 1` au site public ; héritage vérifié sur le titre. |
| Logo Nuit | Fichier utilisateur `Nouveau Blanc.png` copié dans `public/promptsport-logo-night.png`, transparence conservée. Affichage conditionnel par CSS ; logo original en Jour et logo blanc en Nuit, également en mode Système. Suppression du filtre de couleur précédemment utilisé. |

## Fichiers principaux

- `src/components/ui/{Button,Card,Input,Badge}.tsx`
- `src/components/{ArticleCard,MatchCard,Paywall,LiveScoresBar,PublicNav}.tsx`
- `src/components/ScoresScroller.tsx` : commandes de défilement uniquement ; données des matchs toujours rendues côté serveur.
- `src/app/login/LoginForm.tsx`
- `src/app/globals.css`, `src/app/editorial.css`, `tailwind.config.js`
- `src/app/layout.tsx`, `src/app/fonts/Inter-roman.var.woff2`, `src/app/fonts/Inter-italic.var.woff2`, `src/app/fonts/Inter-LICENSE.txt`
- `public/promptsport-logo-night.png`

## Vérifications réalisées

- **Build de production : réussi** après intégration d’Inter locale ; compilation, lint, types et génération des 28 pages statiques terminés. Le premier essai avec Google Fonts avait échoué sur le téléchargement d’Inter. Le dernier ajout du logo et la correction CSS `salt` ont ensuite été vérifiés dans le serveur de développement, sans relancer le build complet. Le lint ciblé de PublicNav et du layout passe après ce complément.
- **TypeScript et lint ciblé : réussis** sur les composants migrés et le défilement des scores avant le complément logo.
- **Suite WP13a : 20/20** lors des contrôles de la base de thèmes ; elle ne remplace pas une validation visuelle complète de WP13b.
- **Barre des scores :** vérification des flèches, de leur désactivation à la fin, du défilement clavier, de `scrollbar-width: none` et de l’absence de débordement de page à 390 px. Rendus Jour/Nuit et ordinateur/mobile inspectés.
- **Pages HTTP :** 200 sur accueil, scores, compétition Bundesliga, fiche match existante, article premium existant, abonnement, connexion, auteur existant, mentions légales et confidentialité. `/mon-compte` retourne 307 sans session, conformément à la protection de la page. Le contenu authentifié de Mon compte n’a pas été validé visuellement dans ce lot.
- **Paywall Nuit :** fond du fondu vérifié à `rgb(17,18,17)` ; badge premium à `rgb(53,40,17)` avec texte `rgb(252,216,117)`.
- **Contrastes des badges, calcul WCAG local :** Jour de 6,88:1 à 8,15:1 ; Nuit de 8,16:1 à 10,40:1 pour premium, avertissement, succès et erreur. Au-dessus de 4,5:1. Le service WebAIM n’était pas accessible depuis l’outil ; ces mesures ne constituent pas un audit exhaustif de tous les textes et états.
- **Police :** fichiers copiés identiques aux sources Clipmagic par SHA-256. Dans le navigateur : famille calculée `inter, system-ui, sans-serif`, réglage `salt` présent sur le conteneur public et le titre, `document.fonts.check` vrai en normal, gras et italique.
- **Logo Nuit :** image chargée et visible sur fond sombre ; logo Jour masqué. Source PNG avec canal alpha. Le fichier Inter normal est également servi en HTTP 200 (227 688 octets).

## Préservation et limites

- Aucun changement des pages studio/backoffice, du schéma Prisma, du middleware ou des Server Actions. Les adaptations des composants partagés sont limitées au conteneur public. La police globale a été remplacée à la demande explicite de l’utilisateur.
- Aucun ajout de bibliothèque. Aucun achat, envoi de newsletter, déploiement ou modification de données métier effectué.
- Clipmagic a uniquement été lu et ses fichiers de police copiés. Son code et son serveur sur le port 3000 n’ont pas été modifiés.
- Certains logos d’équipes ne se chargent pas : après rétablissement de l’accès réseau du serveur, le fournisseur `crests.football-data.org` présente encore des délais d’attente. Problème externe non résolu dans ce lot ; pas de remplacement des données des équipes.
- L’ancien onglet localhost avait conservé des ressources de développement périmées. Les derniers contrôles visuels ont utilisé `127.0.0.1:3002`, qui désigne le même serveur. Si l’ancien rendu persiste dans un onglet, effectuer un rechargement forcé.
- Le serveur de développement a été remis en route sur **3002** après les builds. Aucun déploiement de production n’est inclus.

## État de livraison

Implémentation livrée et vérifications ci-dessus réalisées, avec réserve explicite sur les logos externes et sur l’absence d’un audit visuel exhaustif de tous les écrans authentifiés. Les éléments déjà fonctionnels ont été conservés ou améliorés selon la consigne de l’utilisateur.
