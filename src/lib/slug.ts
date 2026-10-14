/**
 * Génération de slug pour les articles.
 *
 * Exemple : « Équipe de France : la victoire ! » -> "equipe-de-france-la-victoire"
 */

/** Transforme un titre en slug : minuscules, sans accents, séparé par des tirets. */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    // Retire les diacritiques (é -> e, à -> a, ç -> c…)
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    // Tout ce qui n'est pas lettre/chiffre devient un tiret
    .replace(/[^a-z0-9]+/g, "-")
    // Pas de tirets en début/fin, ni de séries de tirets
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

/**
 * Détermine le slug à utiliser : celui saisi s'il existe, sinon généré
 * depuis le titre. Renvoie une chaîne vide si aucun des deux ne produit
 * un slug exploitable.
 */
export function resolveSlug(slugInput: string, title: string): string {
  const provided = slugInput.trim();
  if (provided) {
    return slugify(provided);
  }
  return slugify(title);
}

/** Identity is scoped to a club: names alone cannot distinguish homonyms. */
export function playerProfileKey(teamId: string, name: string): string {
  const normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr").trim().replace(/\s+/g, " ");
  return `${teamId}/${normalized}`;
}

export function cleanPlayerName(name: string | null | undefined): string | null {
  const value = name?.trim().replace(/\s+/g, " ");
  return value && !/\((entra[iî]neur|coach|manager)\)/i.test(value) ? value : null;
}
