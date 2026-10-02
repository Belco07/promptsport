import { Lock } from "lucide-react";

import { Badge } from "@/components/ui/Badge";

/**
 * Badge signalant un article réservé aux abonnés (WP7c, refonte WP9).
 *
 * S'appuie sur la variante `premium` du composant Badge : couleurs dorées,
 * distinctes des rubriques (bleues) et des statuts. Le cadenas est fourni par
 * lucide-react (icône SVG, ~1 Ko).
 */
export function PremiumBadge({ className = "" }: { className?: string }) {
  return (
    <Badge variant="premium" className={className} title="Réservé aux abonnés">
      <Lock aria-hidden="true" className="h-3.5 w-3.5" />
      Premium
    </Badge>
  );
}
