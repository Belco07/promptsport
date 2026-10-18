import Link from "next/link";
import { Radio } from "lucide-react";

export const competitionTabs = {
  live: "Live",
  actualites: "Actu",
  classement: "Classement",
  effectif: "Effectif",
  resultats: "Résultats",
  calendrier: "Calendrier",
};
export function CompetitionTabs({slug,active,hasLiveMatches=false,liveCount=0}:{slug:string;active:keyof typeof competitionTabs;hasLiveMatches?:boolean;liveCount?:number}) {return <nav aria-label="Rubriques de la compétition" className="mb-8 flex gap-6 overflow-x-auto border-b border-border [scrollbar-width:none]">{Object.entries(competitionTabs).filter(([key])=>key!=="live"||(hasLiveMatches&&liveCount>0)).map(([key,label])=><Link key={key} href={`/competition/${slug}?tab=${key}`} aria-current={active===key?"page":undefined} className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-1 py-4 text-sm font-bold ${active===key?"border-editorial-link text-editorial-link":"border-transparent text-muted-foreground hover:text-foreground"}`}>{key==="live"?<><Radio aria-hidden="true" size={16} className="text-status-danger"/><span className="animate-pulse whitespace-nowrap rounded-md bg-red-600 px-2 py-1 text-white motion-reduce:animate-none">Live ({liveCount})</span></>:label}</Link>)}</nav>;}