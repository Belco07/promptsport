# Rapport de migration sportive vers AllSportsApi

Migration autorisée et réalisée sur la base principale `promptsport`, saison 26/27.

## Résultat

| Donnée | Avant | Après |
| --- | ---: | ---: |
| Compétitions | 6 | 6 |
| Équipes | 111 | 161 |
| Matchs | 1 889 | 1 089 |

| Compétition | ID AllSportsApi | Matchs |
| --- | ---: | ---: |
| Ligue 1 | 34 | 166 |
| Premier League | 17 | 176 |
| LaLiga | 8 | 192 |
| Serie A | 23 | 170 |
| Bundesliga | 35 | 157 |
| Ligue des champions | 7 | 228 |

Les identifiants internes des six compétitions, de 105 équipes et de 881 matchs sont conservés. Les six anciens clubs sans correspondance sont conservés avec un identifiant externe préfixé `legacy:football-data:`. Les logos existants des équipes rapprochées sont conservés ; les nouvelles équipes utilisent le visuel de repli. Les suivis des lecteurs et leurs préférences sont identiques à la sauvegarde.

L'historique disponible de la saison est récupéré jusqu'à la fin de pagination. Les matchs à venir correspondent à la fenêtre configurée (quatre pages par compétition), et non nécessairement à toute la saison. Les anciens matchs absents de ce nouveau jeu sont retirés. La Ligue des champions inclut les qualifications.

## Sauvegardes

- `backups/promptsport-before-allsports-1791708954790.dump` : sauvegarde PostgreSQL complète, inventaire vérifié avec `pg_restore --list` avant écriture.
- `backups/sports-before-allsports-1791708954790.json` : données sportives et suivis avant migration.
- `backups/allsports-migration-result-1791708954790.json` : bilan et correspondances.

Ces fichiers restent locaux et ignorés par Git. La sauvegarde complète doit rester privée.

## Vérifications

- Test PostgreSQL avec annulation automatique : correspondances, logos, liens et suivis ; données initiales identiques après rollback.
- Quota RapidAPI vérifié avant import : 88 requêtes restantes lors de la tentative réussie (minimum requis : 40).
- Première tentative interrompue par délai réseau, sans écriture en base.
- 384 matchs terminés : cohérence du nombre de matchs joués et des totaux de buts dans le calcul des classements. Pas de comparaison avec un classement officiel externe.
- HTTP 200 sur l'accueil, les scores, les six pages compétition et une fiche match, port 3002. Pas de validation visuelle exhaustive.
- ESLint des fichiers concernés et TypeScript sans cache : réussis.
- `npm run build` : réussi à la seconde tentative ; première tentative interrompue par un crash natif de Turbopack.

## Exploitation

`scripts/sync-football.ts` respecte en priorité le `DATABASE_URL` fourni par le processus appelant. La compatibilité `football-sync.ts` utilise désormais AllSportsApi. Les données sont préparées avant une transaction unique ; une page API invalide ou en erreur empêche de valider un import incomplet.

Pour les mises à jour suivantes : `npx tsx scripts/sync-football.ts FL1 PL PD SA BL1 CL`. Ne pas relancer le script de migration sur une base déjà migrée. Ce lot n'ajoute pas de planification automatique des scores en direct.
