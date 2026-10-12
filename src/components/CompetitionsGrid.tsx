import Image from "next/image";
import Link from "next/link";

// Emblems published by the same provider as the existing team crests.
const emblems: Record<string, string> = { "ligue-1": "FL1", "premier-league": "PL", liga: "PD", "serie-a": "SA", bundesliga: "BL1", "uefa-champions-league": "CL" };
export function CompetitionsGrid({ competitions }: { competitions: { slug: string; name: string }[] }) {
  return <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6" data-competitions-grid>{competitions.map(competition => <Link href={`/competition/${competition.slug}`} key={competition.slug} className="group flex items-center gap-4 border border-border bg-card p-4 text-foreground hover:bg-background md:flex-col md:text-center">
    <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-background dark:bg-foreground">
      <Image src={`https://crests.football-data.org/${emblems[competition.slug]}.png`} alt={`Logo ${competition.name}`} width={64} height={64} sizes="64px" loading="lazy" className="h-16 w-16 object-contain p-1" />
    </span>
    <h3 className="text-xs font-bold uppercase leading-snug group-hover:underline">{competition.name}</h3>
  </Link>)}</div>;
}
