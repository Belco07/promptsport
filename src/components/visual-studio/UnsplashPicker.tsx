"use client";
import { useState } from "react";
import { searchComposerImages, trackComposerImage } from "@/app/studio/composer/actions";
type Photo = { id: string; preview: string; url: string; author: string; authorUrl: string };
export default function UnsplashPicker({ onImage }: { onImage: (url: string) => Promise<void> }) {
  const [query, setQuery] = useState(""); const [photos, setPhotos] = useState<Photo[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function run(action: () => Promise<void>) { setBusy(true); setError(""); try { await action(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Unsplash indisponible."); } finally { setBusy(false); } }
  return <div className="space-y-2"><label className="block text-sm">Chercher sur Unsplash<input className="w-full rounded border border-border bg-background p-2" value={query} onChange={event => setQuery(event.target.value)} maxLength={100} /></label>
    <button type="button" disabled={busy || query.trim().length < 2} className="rounded border border-border px-3 py-2" onClick={() => void run(async () => setPhotos(await searchComposerImages(query)))}>{busy ? "Chargement…" : "Rechercher des images"}</button>
    {error && <p role="alert">{error}</p>}
    <div className="grid grid-cols-2 gap-2">{photos.map(photo => <div key={photo.id}><button type="button" disabled={busy} aria-label={`Importer la photo de ${photo.author}`} onClick={() => void run(async () => { await trackComposerImage(photo.id); await onImage(photo.url); })}>{/* Hotlink required by the Unsplash API. */}<img src={photo.preview} alt={`Photo de ${photo.author}`} loading="lazy" className="aspect-square w-full object-cover" /></button><a href={`${photo.authorUrl}?utm_source=promptsport&utm_medium=referral`} target="_blank" rel="noopener noreferrer" className="text-xs underline">{photo.author}</a></div>)}</div>
    {!!photos.length && <a href="https://unsplash.com/?utm_source=promptsport&utm_medium=referral" target="_blank" rel="noopener noreferrer" className="text-xs underline">Photos sur Unsplash</a>}
  </div>;
}
