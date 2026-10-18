import Link from "next/link";
export const clubTabs = { actualites: "Actualités", calendrier: "Calendrier", resultats: "Résultats", effectif: "Effectif" };
export type ClubTab = keyof typeof clubTabs;
export function ClubTabs({ slug, active }: { slug: string; active: ClubTab }) {
  return <nav aria-label="Rubriques du club" className="my-8 flex gap-6 overflow-x-auto border-b border-border">{Object.entries(clubTabs).map(([key, label]) => <Link scroll={false} key={key} href={`/club/${slug}?tab=${key}`} aria-current={active === key ? "page" : undefined} className={`whitespace-nowrap border-b-2 pb-4 font-bold focus-visible:outline-2 focus-visible:outline-offset-4 ${active === key ? "border-primary text-editorial-link" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{label}</Link>)}</nav>;
}
