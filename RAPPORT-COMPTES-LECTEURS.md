# Comptes lecteurs et publicité — 6 octobre 2026

## Changements

- Publicité verticale 300 × 600 à droite du texte de l’article sur ordinateur, logo centré et mention Publicité au-dessus. Masquée sur mobile et pour les abonnés premium. Le bandeau horizontal ajouté auparavant est retiré de l’article.
- Connexion et inscription avec l’identité PromptSport et les thèmes jour/nuit/système.
- Inscription par e-mail et mot de passe, connexion immédiate, rôle READER fixé côté serveur. Aucun droit de rédaction accordé aux inscriptions publiques.
- Écran de bienvenue après inscription. Personnalisation des compétitions, sauvegarde en base et possibilité de passer cette étape. L’écran ne revient plus après validation.
- Compétitions favorites et 50 derniers articles enregistrés accessibles dans Mon compte.
- Menu de compte plein écran : profil, favoris, préférences, abonnement, notifications, déconnexion. Accès rédaction réservés aux rôles existants. Dialogue natif pour le focus clavier et Échap.
- Adaptateur Auth.js pour Author et OAuthAccount. Google/Facebook disponibles uniquement lorsque leurs variables sont configurées. Aucune association automatique de comptes sur la seule base d’une adresse e-mail identique ; aucun jeton OAuth stocké.
- Contrôle du rôle ajouté aux actions de création et d’édition du studio et au layout. Correction de la détection du cookie sécurisé pour le serveur local HTTP en mode production.

## Base de données

Migration additive `20261006100000_reader_oauth`, appliquée à la base PostgreSQL locale PromptSport. Ajoute READER, OAuthAccount, welcomeCompleted et favoriteCompetitions. Les comptes existants sont considérés comme ayant déjà terminé l’accueil.

## Activation Google et Facebook

Les quatre variables suivantes sont absentes du fichier .env au moment du développement. Les définir localement avec les valeurs des applications des fournisseurs, puis reconstruire et redémarrer le site :

```dotenv
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
AUTH_FACEBOOK_ID=
AUTH_FACEBOOK_SECRET=
```

Configurer l’origine et les URI de retour correspondant au domaine utilisé :

- Google : `http://localhost:3002/api/auth/callback/google` pour le développement local.
- Facebook : `/api/auth/callback/facebook` sur une origine acceptée par la configuration Meta ; utiliser un domaine HTTPS pour le déploiement.
- En production, remplacer localhost par le véritable domaine HTTPS et configurer AUTH_URL en conséquence.

Ne pas partager les secrets dans le chat ni les committer. Les connexions externes ne sont pas validées de bout en bout tant que ces applications ne sont pas configurées. Sources : [Google Auth.js](https://authjs.dev/getting-started/providers/google), [Facebook Auth.js](https://authjs.dev/getting-started/providers/facebook), [adaptateurs Auth.js](https://authjs.dev/reference/core/adapters).

## Limites explicites

- La personnalisation fournit des raccourcis vers les compétitions ; elle ne crée pas un moteur de recommandation d’actualités.
- Inscription sans vérification d’adresse par e-mail. La récupération de mot de passe n’est pas ajoutée dans ce lot.
- Limitation des inscriptions : cinq tentatives par heure et par IP, en mémoire comme les autres limites du projet ; prévoir un stockage partagé pour un déploiement multi-instance.
- Les comptes OAuth utilisent leur fournisseur pour se connecter ; ils n’ont pas de mot de passe local connu.

## Validation

Exécutée le 6 octobre 2026 sur le serveur de développement (port 3002) et la base
PostgreSQL locale.

| Contrôle | Commande | Résultat |
| --- | --- | --- |
| Parcours lecteur complet | `node scripts/check-reader-flow.cjs` | **14/14** |
| Interface du compte lecteur et favoris | contrôle dédié (voir ci-dessous) | **8/8** |
| Thème et composants publics | `node scripts/check-wp13c.cjs` | **91/91** |
| Accueil éditorial | `node scripts/check-wp13d.cjs` | **31/31** |
| Pages intérieures | `node scripts/check-wp13e.cjs` | **61/61** |

Le parcours lecteur vérifie : inscription publique disponible, rôle `READER`
forcé côté serveur malgré un champ `role=ADMIN` forgé dans le formulaire, mot de
passe haché et vérifié, redirection de première connexion vers `/bienvenue`,
session active, `/studio` et `/backoffice` refusés (307), écran de bienvenue,
enregistrement et validation des compétitions favorites (une valeur inconnue est
écartée), `welcomeCompleted` positionné puis écran non répété, favoris visibles
dans `/mon-compte`, et refus d’une seconde inscription avec la même adresse.

Le contrôle d’interface, mené avec un compte lecteur jetable
(`check-reader-flow.cjs --keep-ui-fixture`), confirme : connexion du lecteur,
écran de bienvenue, compte accessible, bouton de favori **inactif** (« Enregistrer »)
avant enregistrement puis **actif** (« Enregistré », `aria-pressed="true"`) après,
et présence de l’article enregistré dans les favoris du compte.

Nettoyage : le compte de test et son favori sont supprimés en fin de contrôle. Les
reliquats d’une exécution interrompue (un compte `reader-test-…@example.invalid`
et sa ligne `ui-bookmark-…` dans `ArticleReaction`) ont également été supprimés —
vérifié ensuite : **0 compte de test** et **0 fixture** restants en base.

La colonne `updatedAt` n’existe pas sur `ArticleReaction` (5 colonnes : `id`,
`articleId`, `authorId`, `type`, `createdAt`) : la première commande d’insertion
d’une fixture de favori avait échoué pour cette raison. La base et le schéma
Prisma sont conformes, aucune dérive n’a été constatée.

Les vérifications visuelles et de contraste restent celles des rapports WP13b à
WP13e (captures jointes) ; les connexions OAuth Google/Facebook ne sont pas
validées de bout en bout, faute d’applications configurées.

