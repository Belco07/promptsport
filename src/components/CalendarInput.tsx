"use client";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "@/components/icons";
import { useRef, useState } from "react";

type Props = { id?: string; name?: string; type?: string; value?: string; defaultValue?: string; onValueChange?: (value: string) => void; required?: boolean; className?: string; label?: string };
const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
export function CalendarInput({id, name, type, value, defaultValue = "", onValueChange, required, className = "", label = "Choisir une date"}: Props) {
  const [local, setLocal] = useState(defaultValue);
  const selected = value ?? local;
  const [month, setMonth] = useState(new Date());
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const withTime = type === "datetime-local";
  function change(next: string) { setLocal(next); onValueChange?.(next); }
  function close() { dialog.current?.close(); trigger.current?.focus(); }
  const start = new Date(month.getFullYear(),month.getMonth(),1);
  start.setDate(1-(start.getDay()+6)%7);
  return <div className="relative">
    <input type="hidden" name={name} value={selected} />
    <button id={id} ref={trigger} type="button" aria-label={label} aria-haspopup="dialog" onClick={() => {setMonth(selected ? new Date(`${selected.slice(0,10)}T12:00:00`) : new Date()); dialog.current?.showModal();}} className={`flex min-h-10 w-full items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground ${className}`}>
      <span>{selected ? new Date(`${selected.slice(0,10)}T12:00:00`).toLocaleDateString("fr-FR") : label}{withTime && selected ? ` · ${selected.slice(11,16)}` : ""}{required && !selected ? " *" : ""}</span><CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0" />
    </button>
    <dialog ref={dialog} aria-label={label} onCancel={event=>{event.preventDefault();close();}} className="m-auto w-[min(340px,94vw)] rounded-md border border-border bg-card p-5 text-foreground shadow-2xl backdrop:bg-black/40">
      <div className="mb-5 flex items-center justify-between"><button type="button" aria-label="Mois précédent" className="p-2" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}><ChevronLeft className="h-5 w-5" /></button><h2 aria-live="polite" className="font-bold capitalize">{month.toLocaleDateString("fr-FR",{month:"long",year:"numeric"})}</h2><button type="button" aria-label="Mois suivant" className="p-2" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}><ChevronRight className="h-5 w-5" /></button></div>
      <div className="grid grid-cols-7 text-center text-xs text-muted-foreground">{["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"].map(d=><span className="py-2" key={d}>{d}</span>)}</div>
      <div className="grid grid-cols-7 gap-1">{Array.from({length:42},(_,i)=>{const d=new Date(start);d.setDate(start.getDate()+i);const key=iso(d);return <button type="button" key={key} aria-label={d.toLocaleDateString("fr-FR",{dateStyle:"full"})} aria-pressed={selected.slice(0,10)===key} onClick={()=>{change(key+(withTime?`T${selected.slice(11,16)||"12:00"}`:""));if(!withTime)close();}} onKeyDown={event=>{const offset=({ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7} as Record<string,number>)[event.key];if(offset){event.preventDefault();const buttons=event.currentTarget.parentElement?.querySelectorAll('button');(buttons?.[i+offset] as HTMLButtonElement|undefined)?.focus();}}} className={`h-10 rounded-sm text-sm font-bold ${selected.slice(0,10)===key?"bg-editorial-action text-white":d.getMonth()!==month.getMonth()?"text-muted-foreground opacity-50 hover:bg-muted":"hover:bg-muted"}`}>{d.getDate()}</button>;})}</div>
      {withTime && <label className="mt-4 flex items-center justify-between text-sm">Heure<input type="time" aria-label="Heure" value={selected.slice(11,16)||"12:00"} onChange={e=>change(`${selected.slice(0,10)||iso(month)}T${e.target.value}`)} className="rounded-md border border-border bg-background p-2 text-foreground" /></label>}
      <div className="mt-4 flex justify-between border-t border-border pt-3">{!required?<button type="button" className="text-sm" onClick={()=>{change("");close();}}>Effacer</button>:<span/>}<button type="button" className="flex items-center gap-1 text-sm font-semibold" onClick={close}><X className="h-4 w-4" />{withTime?"Valider":"Fermer"}</button></div>
    </dialog>
  </div>;
}
