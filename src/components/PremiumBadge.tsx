import { Award } from "@/components/icons";

import { Badge } from "@/components/ui/Badge";

/**
 * Badge signalant un article réservé aux abonnés (WP7c, refonte WP9).
 *
 * S'appuie sur la variante `premium` du composant Badge : couleurs dorées,
 * distinctes des rubriques (bleues) et des statuts. La rosette étoilée est
 * fournie par lucide-react (`Award`) : elle identifie l'abonnement mieux qu'un
 * cadenas, qui évoque plutôt un accès verrouillé.
 */
export function PremiumBadge({ className = "" }: { className?: string }) {
  return (
    <Badge variant="premium" className={className} title="Réservé aux abonnés">
      <Award aria-hidden="true" className="h-3.5 w-3.5" />
      Premium
    </Badge>
  );
}
