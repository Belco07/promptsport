import Link from "next/link";

/** Keep the old navigation destination without exposing the obsolete importer. */
export default function DeprecatedSportsSyncPage() {
  return <div className="px-8 py-10">
    <Link href="/backoffice/sports" className="mb-4 inline-block text-sm text-editorial-link underline">← Retour aux sports</Link>
    <h1 className="mb-4 text-2xl font-bold text-foreground">Ancien outil de synchronisation retiré</h1>
    <p className="max-w-3xl text-muted-foreground">Cette page est dépréciée. Les scores sont synchronisés automatiquement via AllSportsApi. Le suivi des exécutions est disponible dans GitHub Actions, sous « Synchronisation des scores ».</p>
    <Link href="/backoffice/sports/competitions" className="mt-6 inline-block text-editorial-link underline">Gérer les compétitions</Link>
  </div>;
}
