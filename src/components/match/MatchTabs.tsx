import Link from "next/link";
export const matchTabs = { resume: "Le Résumé", compositions: "Les Compositions", discussion: "Le Débat" } as const;
export function MatchTabs({ id, active }: { id: string; active: keyof typeof matchTabs }) {
  return <nav aria-label="Rubriques du match" className="my-8 hidden gap-8 border-b border-border lg:flex">{Object.entries(matchTabs).map(([key, label]) => <Link scroll={false} key={key} href={'/match/' + id + '?tab=' + key} aria-current={active === key ? "page" : undefined} className={'border-b-4 py-4 text-xl font-black transition-colors hover:text-editorial-link ' + (active === key ? 'border-editorial-link text-foreground' : 'border-transparent text-muted-foreground')}>{label}</Link>)}</nav>;
}
