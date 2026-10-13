import Link from "next/link";
import { LiveScoreRefresher } from "@/components/LiveScoreRefresher";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { buildPageMetadata, itemListJsonLd, jsonLdString } from "@/lib/seo";
import { ScoreRow } from "@/components/ScoreRow";
import { ScoresControls } from "@/components/ScoresControls";
import { AdSlot } from "@/components/AdSlot";
import { Footer } from "@/components/Footer";
import { auth } from "@/lib/auth";
import { CompetitionLogo } from "@/components/CompetitionLogo";
import { getLastSportsUpdate } from "@/lib/live-sync";
import { formatRelativeDate } from "@/lib/formatDate";
import { isFotmobLiveEnabled, withLocalFootballLive } from "@/lib/fotmob-live";
import { withStoredMatchClocks } from "@/lib/allsports-sync";

export const metadata=buildPageMetadata({title:"Scores en direct",description:"Résultats, matchs en direct et rencontres à venir de toutes les compétitions.",path:"/scores"});
export default async function ScoresPage({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}) {
  const params=await searchParams;
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Lagos",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const validDate=/^\d{4}-\d{2}-\d{2}$/.test(params.date??"") && Number.isFinite(Date.parse(`${params.date}T00:00:00Z`)) && new Date(`${params.date}T00:00:00Z`).toISOString().slice(0,10)===params.date;
  const date=validDate?params.date!:today;
  const start=new Date(`${date}T00:00:00+01:00`), end=new Date(start.getTime()+86400000);
  const view=["live","upcoming","finished"].includes(params.view??"")?params.view:"day";
  const where:Prisma.MatchWhereInput={
    competition:{...(params.sport?{sport:params.sport}:{}),...(params.competition?{slug:params.competition}:{})},
    ...(view==="day"?{scheduledAt:{gte:start,lt:end}}:view==="live"&&isFotmobLiveEnabled()?{OR:[{status:"LIVE"},{status:"SCHEDULED",scheduledAt:{gte:start,lt:end}}]}:{status:view==="live"?"LIVE":view==="finished"?"FINISHED":"SCHEDULED"}),
    ...(params.q?.trim()?{OR:[{homeTeam:{name:{contains:params.q.trim().slice(0,200),mode:"insensitive"}}},{awayTeam:{name:{contains:params.q.trim().slice(0,200),mode:"insensitive"}}}]}:{}),
  };
  const [storedMatches,competitions,session,lastUpdate]=await Promise.all([
    prisma.match.findMany({where,orderBy:{scheduledAt:view==="finished"?"desc":"asc"},...(view!=="day"?{take:100}:{}),include:{homeTeam:true,awayTeam:true,competition:true,events:{orderBy:[{minute:"desc"},{extraMinute:"desc"}],take:1,select:{minute:true,extraMinute:true,createdAt:true}}}}),
    prisma.competition.findMany({orderBy:{name:"asc"},select:{slug:true,name:true,sport:true}}),auth(),getLastSportsUpdate(),
  ]);
  const snapshots=await withLocalFootballLive(await withStoredMatchClocks(storedMatches));
  const matches=view==="live"?snapshots.filter(match=>match.status==="LIVE"):view==="upcoming"?snapshots.filter(match=>match.status==="SCHEDULED"):snapshots;
  const premium=session?.user?.isPremium===true;
  const groups=new Map<string,typeof matches>();for(const match of matches){const key=match.competitionId;groups.set(key,[...(groups.get(key)??[]),match]);}
  function href(day:string){const p=new URLSearchParams();for(const [k,v] of Object.entries(params))if(v&&k!=="view")p.set(k,v);p.set("date",day);return `/scores?${p}`;}
  return <><main id="contenu" className={`mx-auto max-w-[1280px] px-4 py-8 text-foreground ${premium?"":"lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-8"}`}>
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html:jsonLdString(itemListJsonLd({name:"Matchs",path:"/scores",items:matches.map(m=>({name:`${m.homeTeam.name} - ${m.awayTeam.name}`,url:`/match/${m.id}`}))}))}}/>
    <div className="min-w-0">
      <h1 className="mb-7 text-3xl font-black uppercase leading-tight tracking-tight sm:text-5xl">{view === "live" ? "Matchs en direct" : <>Scores en direct,<br/>calendrier et résultats</>}</h1>
      <p className="mb-4 text-sm text-muted-foreground">Dernière mise à jour serveur : {lastUpdate?.finishedAt ? <time dateTime={lastUpdate.finishedAt.toISOString()}>{formatRelativeDate(lastUpdate.finishedAt)}</time> : "aucune synchronisation enregistrée"}</p>
      <LiveScoreRefresher hasLiveMatches={matches.some(match=>match.status==="LIVE")} lastSync={lastUpdate?.finishedAt?.toISOString() ?? null} pauseWhenIdle={view!=="live"}/>
      <ScoresControls date={date} sports={[...new Set(competitions.map(c=>c.sport))]} competitions={competitions}/>
      {view !== "live" && <nav aria-label="Dates des matchs" className="my-6 grid grid-cols-7 overflow-hidden rounded-md bg-muted">{Array.from({length:7},(_,i)=>{const d=new Date(`${date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+i-3);const key=d.toISOString().slice(0,10);return <Link key={key} href={href(key)} aria-current={key===date?"date":undefined} className={`border-r border-border py-3 text-center last:border-r-0 ${key===date?"bg-foreground text-background":"hover:bg-card"}`}><span className="block text-[10px] font-semibold sm:text-xs">{key===today?"Auj.":d.toLocaleDateString("fr-FR",{weekday:"short",timeZone:"UTC"})}</span><span className="my-1 block text-lg font-black">{d.getUTCDate()}</span><span className="block text-[10px]">{d.toLocaleDateString("fr-FR",{month:"short",timeZone:"UTC"})}</span></Link>;})}</nav>}
      <div className="mb-6 flex items-center justify-between gap-3 text-sm"><p role="status">{matches.length} match{matches.length!==1?"s":""}{view!=="day"&&matches.length===100?" (100 premiers)":""}</p><Link href="/mon-compte/favoris" className="font-semibold text-editorial-link">★ Mes favoris</Link></div>
      {!matches.length&&<p className="rounded-md bg-muted p-6 text-center text-muted-foreground">Aucun match pour cette sélection. Choisissez une autre date ou modifiez les filtres.</p>}
      <div className="space-y-7">{[...groups.values()].map(rows=><section key={rows[0].competitionId}>
        {view==="live"&&!premium&&<AdSlot format="banner" className="mb-6"/>}
        <Link href={`/competition/${rows[0].competition.slug}`} className="mb-3 flex items-center gap-3"><CompetitionLogo slug={rows[0].competition.slug}/><span><h2 className="text-xl font-black">{rows[0].competition.name}</h2><span className="text-sm text-muted-foreground">{rows[0].competition.country??rows[0].competition.sport}</span></span></Link>
        <div className="overflow-hidden rounded-md bg-muted">{rows.map((match,i)=>{const day=match.scheduledAt.toLocaleDateString("fr-FR",{day:"numeric",month:"long",timeZone:"Africa/Lagos"});const previous=i?rows[i-1].scheduledAt.toLocaleDateString("fr-FR",{day:"numeric",month:"long",timeZone:"Africa/Lagos"}):null;return <div key={match.id}>{day!==previous&&<p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">{day}</p>}<div className="border-b border-border last:border-0"><ScoreRow match={{...match,minuteObservedAt:match.minuteObservedAt??match.events[0]?.createdAt?.toISOString()??null,minute:match.minute??(match.events[0]?String(match.events[0].minute)+(match.events[0].extraMinute?"+"+match.events[0].extraMinute:"")+"′":null)}}/></div></div>;})}</div>
      </section>)}</div>
    </div>
    {!premium&&<aside className="hidden lg:block"><div className="sticky top-28"><AdSlot format="skyscraper"/></div></aside>}
  </main><Footer/></>;
}
