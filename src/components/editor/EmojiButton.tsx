"use client";

import { insertMarkdown$, usePublisher } from "@mdxeditor/editor";
import { Smile } from "@/components/icons";
import { useEffect, useRef, useState } from "react";

const emojis = [
  ["😀", "Sourire"], ["😂", "Rire"], ["😍", "Adoration"], ["😎", "Lunettes de soleil"],
  ["😮", "Surprise"], ["😢", "Tristesse"], ["👏", "Applaudissements"], ["🙌", "Victoire"],
  ["👍", "Bravo"], ["💪", "Force"], ["❤️", "Cœur"], ["🔥", "Feu"],
  ["⚽", "Football"], ["🏀", "Basketball"], ["🎾", "Tennis"], ["🏉", "Rugby"],
  ["🏆", "Trophée"], ["🥇", "Médaille d’or"], ["🏅", "Médaille"], ["🏁", "Arrivée"],
  ["🚨", "Alerte"], ["📣", "Annonce"], ["✅", "Validation"], ["❌", "Croix"],
  ["📊", "Statistiques"], ["📅", "Calendrier"], ["⏱️", "Chronomètre"], ["🔴", "En direct"],
  ["⭐", "Étoile"], ["💥", "Explosion"], ["🎯", "Cible"], ["🤝", "Accord"],
] as const;

export function EmojiButton() {
  const insertMarkdown = usePublisher(insertMarkdown$);
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return <div className="relative" ref={wrapper}>
    <button ref={trigger} type="button" title="Insérer un emoji" aria-label="Insérer un emoji" aria-expanded={open} aria-haspopup="dialog"
      onMouseDown={(event) => event.preventDefault()} onClick={() => setOpen(!open)}>
      <Smile size={18} aria-hidden="true" />
    </button>
    {open && <div role="dialog" aria-label="Choisir un emoji" className="absolute left-0 top-full z-50 mt-2 w-64 rounded-md border border-border bg-card p-3 text-foreground shadow-lg">
      <p className="mb-2 text-xs font-semibold">Insérer un emoji</p>
      <div className="grid grid-cols-8 gap-1">
        {emojis.map(([emoji, label]) => <button key={label} type="button" title={label} aria-label={label} className="!h-7 !w-7 !text-xl hover:bg-muted focus-visible:outline-2"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => { insertMarkdown(emoji); setOpen(false); }}>{emoji}</button>)}
      </div>
    </div>}
  </div>;
}
