import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Abonnement confirmé",
};

export default function SubscriptionSuccessPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16 text-center">
      <p className="text-4xl">✅</p>
      <h1 className="mt-4 text-3xl font-bold tracking-tight text-foreground">
        Merci, votre abonnement est actif !
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Votre paiement a bien été pris en compte. Votre abonnement apparaîtra
        dans votre espace dans quelques instants (le temps que Stripe confirme
        l&apos;opération).
      </p>

      <div className="mt-8 flex flex-wrap justify-center gap-4">
        <Link
          href="/abonnement"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          Voir mon abonnement
        </Link>
        <Link
          href="/"
          className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          Retour à l&apos;accueil
        </Link>
      </div>
    </main>
  );
}
