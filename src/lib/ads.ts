/**
 * Emplacements publicitaires : affichés seulement quand une régie est branchée.
 *
 * Tant qu'aucun annonceur n'occupe ces emplacements, ils ne montraient qu'un
 * bloc gris avec le logo du site, ce qui donnait au site un air inachevé. Ils
 * sont donc masqués par défaut ; `NEXT_PUBLIC_ADS_ENABLED="true"` les réactive
 * (variable publique : lue aussi par AdSlotGate, côté navigateur).
 */
export const ADS_ENABLED = process.env.NEXT_PUBLIC_ADS_ENABLED === "true";
