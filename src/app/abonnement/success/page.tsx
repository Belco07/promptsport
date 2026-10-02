import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Abonnement confirmé — Mon Site d'Actualités",
};

export default function SubscriptionSuccessPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16 text-center">
      <p className="text-4xl">✅</p>
      <h1 className="mt-4 text-3xl font-bold tracking-tight text-gray-900">
        Merci, votre abonnement est actif !
      </h1>
      <p className="mt-3 text-sm leading-6 text-gray-600">
        Votre paiement a bien été pris en compte. Votre abonnement apparaîtra
        dans votre espace dans quelques instants (le temps que Stripe confirme
        l&apos;opération).
      </p>

      <div className="mt-8 flex flex-wrap justify-center gap-4">
        <Link
          href="/abonnement"
          className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-800"
        >
          Voir mon abonnement
        </Link>
        <Link
          href="/"
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100"
        >
          Retour à l&apos;accueil
        </Link>
      </div>
    </main>
  );
}
