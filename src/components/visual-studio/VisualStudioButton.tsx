"use client";

import { useEffect, useRef, useState } from "react";

/** Le résultat doit provenir de l'onglet ouvert et de notre stockage d'images. */
export function isVisualImageUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  if (/^\/uploads\/[a-zA-Z0-9_.-]+\.(png|webp)$/.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/.test(url.hostname)
      && !url.username && !url.password && /^\/uploads\/.+\.(png|webp)$/.test(url.pathname);
  } catch { return false; }
}

export function VisualStudioButton({ onImage, label = "Créer une image avec le Visual Studio" }: {
  onImage: (url: string) => void; label?: string;
}) {
  const popup = useRef<Window | null>(null);
  const channel = useRef("");
  const callback = useRef(onImage);
  const last = useRef("");
  const [message, setMessage] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => { callback.current = onImage; }, [onImage]);
  useEffect(() => {
    setReady(true);
    function receive(event: MessageEvent) {
      if (event.origin !== window.location.origin || !popup.current || event.source !== popup.current) return;
      const data = event.data;
      if (!data || data.type !== "visual-studio:saved" || data.channel !== channel.current || !isVisualImageUrl(data.url) || last.current === data.url) return;
      last.current = data.url;
      callback.current(data.url);
      setMessage("Image ajoutée à l’article. Pensez à enregistrer vos modifications.");
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  return <span className="inline-flex flex-col gap-1">
    <button type="button" disabled={!ready} className="rounded-md border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted" onClick={() => {
      channel.current = crypto.randomUUID(); last.current = "";
      popup.current = window.open(`/studio/visual-studio?channel=${channel.current}`, "_blank");
      setMessage(popup.current ? "Le Visual Studio est ouvert dans un nouvel onglet." : "Autorisez l’ouverture d’un nouvel onglet pour le Visual Studio.");
    }}>{label}</button>
    {message && <span role="status" className="text-xs text-muted-foreground">{message}</span>}
  </span>;
}
