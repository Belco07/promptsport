"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markSocialPostPosted, retrySocialPosts } from "@/app/studio/articles/distribution-actions";

type Post = { id: string; platform: "X" | "FACEBOOK"; content: string; status: "DRAFT" | "POSTED" };

export function DistributionPanel({ articleId, posts, editable }: { articleId: string; posts: Post[]; editable: boolean }) {
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return <section aria-label="Diffusion sociale" className="max-w-4xl space-y-6">
    <h2 className="text-xl font-bold text-foreground">Diffusion</h2>
    <p className="text-sm text-muted-foreground">Propositions à relire avant de les copier sur vos réseaux. Aucun post n’est envoyé automatiquement.</p>
    <p role="status" aria-live="polite" className="text-sm text-foreground">{message}</p>
    {(["X", "FACEBOOK"] as const).map(platform => {
      const post = posts.find(item => item.platform === platform);
      const name = platform === "X" ? "X" : "Facebook";
      return <section key={platform} aria-label={`Post ${name}`} className="space-y-4 rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-bold text-foreground">{name}</h3>{post && <span className="rounded-full bg-muted px-3 py-1 text-xs text-foreground">{post.status === "POSTED" ? "Publié" : "Brouillon"}</span>}</div>
        {post ? <>
          <p className="whitespace-pre-wrap break-words text-sm leading-7 text-foreground">{post.content}</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground" onClick={async () => {
              try { await navigator.clipboard.writeText(post.content); setMessage(`Texte ${name} copié.`); }
              catch { setMessage("Copie impossible : sélectionnez et copiez le texte manuellement."); }
            }}>Copier le texte {name}</button>
            {editable && post.status !== "POSTED" && <button type="button" disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50" onClick={() => startTransition(async () => {
              const result = await markSocialPostPosted(articleId, post.id);
              setMessage(result.error ?? `Post ${name} marqué comme publié.`);
              router.refresh();
            })}>Marquer comme publié sur {name}</button>}
          </div>
        </> : <p className="text-sm text-muted-foreground">Texte en cours de génération ou indisponible.</p>}
      </section>;
    })}
    {editable && posts.length < 2 && <button type="button" disabled={pending} className="rounded-md border border-border px-4 py-2 font-semibold text-foreground disabled:opacity-50" onClick={() => startTransition(async () => {
      const result = await retrySocialPosts(articleId);
      setMessage(result.error ?? "Textes générés.");
      router.refresh();
    })}>{pending ? "Génération…" : "Générer les textes manquants"}</button>}
  </section>;
}
