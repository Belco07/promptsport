import Link from "next/link";

import { DEFAULT_COMPETITIONS } from "@/lib/sports";

import { SyncForm } from "./SyncForm";

export const dynamic = "force-dynamic";

export default function SyncPage() {
  const hasApiKey = Boolean(process.env.FOOTBALL_DATA_API_KEY);

  return (
    <div className="px-8 py-10">
      <Link
        href="/backoffice/sports"
        className="mb-4 inline-block text-sm text-blue-700 underline hover:text-blue-900"
      >
        ← Retour aux sports
      </Link>

      <h1 className="mb-2 text-2xl font-bold tracking-tight text-gray-900">
        Synchronisation Football-Data.org
      </h1>
      <p className="mb-6 max-w-3xl text-sm text-gray-600">
        Importe les compétitions, équipes et matchs (passés et à venir) depuis
        Football-Data.org. Les doublons sont évités grâce à l&apos;identifiant
        externe. Compétitions par défaut :{" "}
        {DEFAULT_COMPETITIONS.join(", ")}.
      </p>

      {!hasApiKey ? (
        <p
          role="alert"
          className="mb-6 max-w-3xl rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          <strong>FOOTBALL_DATA_API_KEY n&apos;est pas configurée.</strong> Créez une
          clé gratuite sur{" "}
          <a
            href="https://www.football-data.org/client/register"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            football-data.org/client/register
          </a>{" "}
          puis ajoutez-la dans <code className="font-mono">.env</code> et redémarrez
          le serveur.
        </p>
      ) : null}

      <SyncForm />
    </div>
  );
}
