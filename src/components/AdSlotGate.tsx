"use client";

import { useEffect, useState } from "react";

/**
 * Masque un emplacement publicitaire aux abonnés premium.
 *
 * Les pages publiques (accueil, scores, compétition, match) sont **prérendues**
 * (`export const revalidate = 60`, WP8c) : y lire la session côté serveur avec
 * `auth()` les rendrait dynamiques et ferait perdre le prérendu, donc le gain de
 * performance qui a motivé le WP8c. Le contrôle est donc fait après montage, via
 * `/api/auth/session` — la même source que le menu utilisateur.
 *
 * Quand le serveur connaît déjà la réponse (page dynamique, comme un article qui
 * lit la session pour les commentaires), passer `premium` évite l'aller-retour et
 * l'affichage transitoire : l'emplacement n'est alors jamais envoyé à l'abonné.
 *
 * Contrepartie assumée : sur les pages prérendues, l'abonné reçoit la place
 * réservée dans le HTML et la voit disparaître au montage. À revoir si une régie
 * réelle facture les impressions — il faudra alors accepter des pages dynamiques
 * ou activer le rendu partiel (PPR), désactivé dans ce projet.
 */
export function AdSlotGate({
  premium,
  children,
}: {
  premium?: boolean;
  children: React.ReactNode;
}) {
  const [hidden, setHidden] = useState(premium === true);

  useEffect(() => {
    if (premium !== undefined) {
      setHidden(premium);
      return;
    }

    let active = true;
    fetch("/api/auth/session")
      .then((response) => (response.ok ? response.json() : null))
      .then((session) => {
        if (active) {
          setHidden(session?.user?.isPremium === true);
        }
      })
      .catch(() => {
        // Session illisible (réseau, hors ligne) : on laisse l'emplacement.
      });

    return () => {
      active = false;
    };
  }, [premium]);

  if (hidden) {
    return null;
  }
  return <>{children}</>;
}
