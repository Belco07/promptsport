/**
 * Comptes de test E2E (E2E-1).
 *
 * Ces comptes sont créés et mis à jour par `scripts/seed-test-users.cjs`, à
 * lancer une fois avant les tests (`node scripts/seed-test-users.cjs`). Les
 * constantes ci-dessous doivent rester synchronisées avec ce script : c'est la
 * seule source d'identifiants partagée entre le seed et les specs.
 *
 * Adresses volontairement hors domaine réel (`.test`, réservé par la RFC 2606)
 * et mots de passe de test : aucun secret de production n'entre dans les tests.
 */

export type TestUser = {
  email: string;
  password: string;
  name: string;
};

/** Lecteur « classique » : accès aux commentaires, espace personnel. */
export const TEST_READER: TestUser = {
  email: "e2e-reader@example.test",
  password: "E2eReader-2026!pw",
  name: "Lecteur E2E",
};

/** Éditeur : accès au studio, création et publication d'articles. */
export const TEST_EDITOR: TestUser = {
  email: "e2e-editor@example.test",
  password: "E2eEditor-2026!pw",
  name: "Éditeur E2E",
};
