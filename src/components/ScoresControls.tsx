"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarInput } from "./CalendarInput";
export function ScoresControls({date,sports,competitions}:{date:string;sports:string[];competitions:{slug:string;name:string}[]}) {
  const params=useSearchParams(),router=useRouter();
  function update(key:string,value:string){const next=new URLSearchParams(params.toString());if(value)next.set(key,value);else next.delete(key);router.push(`/scores?${next}`,{scroll:false});}
  return <div className="space-y-4"><form action="/scores" className="flex flex-wrap items-center gap-3">
    <input type="hidden" name="date" value={date}/><input name="q" aria-label="Rechercher une équipe" placeholder="Rechercher une équipe…" defaultValue={params.get("q")??""} className="min-w-40 flex-1 rounded-md border border-border bg-card px-4 py-3 text-sm"/>
    {["sport","competition","view"].map(key=>params.get(key)?<input key={key} type="hidden" name={key} value={params.get(key)!}/>:null)}
    <button className="rounded-md border border-border px-4 py-3 text-sm font-bold">Rechercher</button><CalendarInput value={date} label="Date des matchs" onValueChange={value=>update("date",value)}/>
    </form><div className="flex flex-wrap gap-3">
    <select aria-label="Sport" value={params.get("sport")??""} onChange={e=>update("sport",e.target.value)} className="rounded-md border border-border bg-card p-2 text-sm"><option value="">Tous les sports</option>{sports.map(s=><option key={s}>{s}</option>)}</select>
    <select aria-label="Compétition" value={params.get("competition")??""} onChange={e=>update("competition",e.target.value)} className="min-w-0 max-w-full rounded-md border border-border bg-card p-2 text-sm"><option value="">Toutes les compétitions</option>{competitions.map(c=><option key={c.slug} value={c.slug}>{c.name}</option>)}</select>
    <select aria-label="Afficher les matchs" value={params.get("view")??"day"} onChange={e=>update("view",e.target.value)} className="rounded-md border border-border bg-card p-2 text-sm"><option value="day">À cette date</option><option value="live">En direct</option><option value="upcoming">À venir</option><option value="finished">Derniers résultats</option></select>
    </div></div>;
}
