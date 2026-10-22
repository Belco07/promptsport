# Visual Studio avancé

## Configuration

- `UNSPLASH_ACCESS_KEY` : clé serveur Unsplash, jamais envoyée au navigateur.
- `BLOB_READ_WRITE_TOKEN` : stockage des fonds et des exports finaux en production.

Les templates utilisent Fabric, sans abonnement Polotno. Le détourage `@imgly/background-removal` est sous AGPL-3.0 ; une autre licence peut être demandée à IMG.LY. Voir https://github.com/imgly/background-removal-js#license.

## Parcours

1. Un administrateur ouvre `/studio/templates`, place les éléments et désigne les zones Titre et Sujet avec les boutons au-dessus du canvas. Il enregistre et active le template. Le JSON est conservé dans `VisualTemplate` (emplacement actif unique, remplacement atomique).
2. Le journaliste ouvre `/studio/visual-studio` et lance le Compositeur. Il charge des images, crée un collage, sélectionne une image pour la détourer, applique ses filtres et enregistre le fond.
3. Le fond revient dans le template par un message vérifié (origine, fenêtre source, canal aléatoire et URL de stockage).
4. Le journaliste renseigne Titre et Sujet puis génère le PNG final. La géométrie et les éléments de marque ne sont pas manipulables dans cet espace.
5. Depuis un article, le PNG final revient dans l’article par le mécanisme existant ; enregistrer également l’article.

Le premier détourage télécharge le modèle dans le navigateur : prévoir un délai et une connexion réseau. Les imports sont limités à 5 Mo et le compositeur refuse les images de plus de 40 mégapixels. Les collages acceptent jusqu’à huit images et gardent une séparation visible. Les photos Unsplash sont attribuées et leur import est enregistré auprès de l’API Unsplash.

## Migration et vérification

Appliquer `20261021200000_add_visual_templates` sur la base visée après les migrations précédentes. Pour les E2E, utiliser exclusivement PostgreSQL Docker et redéfinir DATABASE_URL, APP_DATABASE_URL et DIRECT_URL vers la base locale.

Après le build, `npm run test:visual-studio` utilise le build optimisé, PostgreSQL Docker et une API Blob HTTP locale simulée. Aucune clé Blob réelle n’est utilisée. Les fichiers d’export et les fixtures sont supprimés à la fin. Le port 3002 doit être libre pour ce lancement standard.

Vérifier : accès admin aux templates, refus pour un journaliste, sauvegarde puis rechargement du template, collage et détourage, retour du fond, modification des seuls textes, export PNG et retour dans un article. Aucune clé de SDK d’édition n’est nécessaire.
