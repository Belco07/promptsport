"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { clearFeaturedSlot, setFeaturedSlot, swapSecondarySlots } from "@/app/studio/une/actions";
import type { FeaturedSlotName, PickerArticle } from "@/lib/featured";
import { ArticlePickerModal } from "./ArticlePickerModal";

export function FeaturedSlotCard({ slot, label, article, canSwap, unavailable }: { slot: FeaturedSlotName; label: string; article: PickerArticle | null; canSwap: boolean; unavailable: boolean }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const button = "rounded-md border border-border px-3 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50";
  async function run(action: () => Promise<{ error?: string; success?: boolean }>) {
    try {
      const result = await action();
      if (result.error) { setMessage(result.error); return; }
      setMessage("Une mise à jour."); setOpen(false); router.refresh();
    } catch { setMessage("Enregistrement impossible. Réessayez."); }
  }
  return <section className="rounded-md border border-border bg-card p-5 text-foreground">
    <h2 className="mb-4 text-xl font-bold">{label}</h2>
    {slot === "URGENT" && <p className="-mt-2 mb-4 text-sm text-muted-foreground">Réservé aux informations de dernière minute : le bandeau s’affiche 24 h après le choix, puis disparaît de lui-même.</p>}
    {article ? <div className="mb-4 flex items-start gap-4">
      {article.coverImageUrl && <Image src={article.coverImageUrl} alt="" width={120} height={75} className="h-20 w-28 rounded object-cover" />}
      <div><p className="font-semibold">{article.title}</p><p className="mt-1 text-sm text-muted-foreground">{article.publishedAt ? new Date(article.publishedAt).toLocaleDateString("fr-FR", { timeZone: "UTC" }) : "Non publié"}</p>{unavailable && <p className="mt-2 text-sm text-status-error-foreground">Cet article n’est plus public : le choix automatique est utilisé.</p>}</div>
    </div> : <p className="mb-4 text-sm text-muted-foreground">{slot === "URGENT" ? "Aucun bandeau urgent." : "Sélection automatique active."}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={pending} onClick={() => { setMessage(""); setOpen(true); }} aria-label={`Choisir un article pour ${label}`} className={button}>Choisir un article</button>
      {article && <button type="button" disabled={pending} onClick={() => startTransition(() => run(() => clearFeaturedSlot(slot)))} aria-label={`Retirer l’article de ${label}`} className={button}>Retirer</button>}
      {(slot === "SECONDARY_1" || slot === "SECONDARY_2") && <button type="button" disabled={!canSwap || pending} onClick={() => startTransition(() => run(swapSecondarySlots))} aria-label={`Déplacer ${label} ${slot === "SECONDARY_1" ? "vers le bas" : "vers le haut"}`} className={button}>{slot === "SECONDARY_1" ? "Descendre ↓" : "Monter ↑"}</button>}
    </div>
    <p role="status" className="mt-3 text-sm">{pending ? "Enregistrement…" : message}</p>
    {open && <ArticlePickerModal label={label} feedback={message} onClose={() => setOpen(false)} onSelect={id => run(() => setFeaturedSlot(slot, id))} />}
  </section>;
}
