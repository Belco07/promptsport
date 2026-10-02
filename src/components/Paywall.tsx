import { Lock } from "lucide-react";
import Link from "next/link";

import { buttonStyles } from "@/components/ui/Button";

/**
 * Paywall visuel (WP7c, refonte WP9).
 *
 * Affiché à la place du contenu d'un article premium pour les visiteurs et les
 * utilisateurs sans abonnement actif : un dégradé blanc fait disparaître la fin
 * du texte tronqué, puis l'appel à l'action propose les offres d'abonnement.
 *
 * Les libellés sont inchangés depuis le WP7c : ils sont vérifiés par la suite
 * scripts/check-wp7c.cjs.
 */
export function Paywall({ isLoggedIn }: { isLoggedIn: boolean }) {
  return (
    <div className="relative">
      {/* Fondu : recouvre la fin du texte tronqué qui précède. */}
      <div
        aria-hidden="true"
        className="pointer-events-none -mt-24 h-24 w-full bg-gradient-to-b from-transparent to-white"
      />

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center shadow-card sm:p-8">
        <span
          aria-hidden="true"
          className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-800"
        >
          <Lock className="h-6 w-6" />
        </span>

        <p className="text-xl font-extrabold tracking-tight text-primary-900">
          Cet article est réservé aux abonnés
        </p>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-neutral-600">
          Abonnez-vous pour lire l&apos;intégralité de cet article et soutenir un
          journalisme sportif indépendant.
        </p>

        <Link
          href="/abonnement"
          className={`mt-6 ${buttonStyles({ variant: "primary", size: "lg" })}`}
        >
          Voir les offres d&apos;abonnement
        </Link>

        {!isLoggedIn ? (
          <p className="mt-4 text-sm">
            <Link
              href="/login"
              className="font-semibold text-primary-700 underline transition-colors hover:text-primary-900"
            >
              Déjà abonné ? Se connecter
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}
