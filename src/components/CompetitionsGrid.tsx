import Link from "next/link";

import { EntityLogo } from "@/components/EntityLogo";

/** Grille des compétitions de l'accueil : logo (composant commun) et nom. */
export function CompetitionsGrid({ competitions }: { competitions: { slug: string; name: string; logoUrl?: string | null }[] }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6" data-competitions-grid>{competitions.map(competition => <Link href={`/competition/${competition.slug}`} key={competition.slug} className="group flex flex-col items-center gap-3 rounded-[13px] border border-border bg-card p-4 text-center text-foreground shadow-[0_4px_20px_rgb(0_0_0/7%)] transition-shadow hover:shadow-[0_6px_28px_rgb(0_0_0/12%)]">
    <EntityLogo kind="competition" name={competition.name} logoUrl={competition.logoUrl} slug={competition.slug} size={64} />
    <h3 className="text-xs font-bold uppercase leading-snug group-hover:underline">{competition.name}</h3>
  </Link>)}</div>;
}
