/**
 * Politique de publication (WP49).
 *
 * La couverture reste obligatoire pour tout article éditorial. Une seule
 * exception est admise : un brouillon issu de la veille peut être publié sans
 * visuel lorsque l'utilisateur confirme explicitement son choix. Cette
 * exception couvre notamment les 5 🔥 générés sans photo source exploitable.
 */

export const PUBLISH_WITHOUT_COVER_MESSAGE =
  "Ajoutez une photo de couverture avant de publier, ou cochez « Publier sans visuel » pour un brouillon de veille.";

export const PUBLISH_WITHOUT_COVER_RESERVED_MESSAGE =
  "La publication sans visuel est réservée aux brouillons issus de la veille.";

export type PublishWithoutCoverInput = {
  /** Statut demandé (« PUBLISHED » pour une publication). */
  status: string;
  coverImageUrl: string | null;
  /** L'utilisateur a coché la confirmation explicite. */
  confirmed: boolean;
  /** L'article provient de la veille (NewsSource). */
  isVeille: boolean;
};

/** L'exception « publication sans visuel » est-elle applicable ? */
export function canPublishWithoutCover(input: PublishWithoutCoverInput): boolean {
  return (
    input.status === "PUBLISHED" &&
    !input.coverImageUrl &&
    input.isVeille &&
    input.confirmed
  );
}
