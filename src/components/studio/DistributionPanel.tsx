"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  markSocialPostPosted,
  publishSocialPostNow,
  retrySocialPosts,
} from "@/app/studio/articles/distribution-actions";

type Platform = "X" | "FACEBOOK" | "INSTAGRAM";
type PostStatus = "DRAFT" | "PUBLISHING" | "POSTED" | "FAILED";

type Post = {
  id: string;
  platform: Platform;
  content: string;
  status: PostStatus;
  error: string | null;
  externalId: string | null;
  autoPublished: boolean;
  publishedAt: string | null;
};

type Availability = { facebook: boolean; instagram: boolean };

const PLATFORMS: Platform[] = ["X", "FACEBOOK", "INSTAGRAM"];
const PLATFORM_NAMES: Record<Platform, string> = {
  X: "X",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
};

function statusLabel(post: Post | undefined, autoPublish: boolean, meta: boolean): string {
  if (!post) return "Texte indisponible";
  if (post.status === "POSTED") return "Publié";
  if (post.status === "PUBLISHING") return "Publication en cours";
  if (post.status === "FAILED") return "Échec";
  if (autoPublish && meta) return "En attente";
  return meta ? "Validation requise" : "Brouillon";
}

export function DistributionPanel({
  articleId,
  posts,
  editable,
  autoPublish,
  sourceName,
  availability,
}: {
  articleId: string;
  posts: Post[];
  editable: boolean;
  autoPublish: boolean;
  sourceName: string | null;
  availability: Availability;
}) {
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <section aria-label="Diffusion sociale" className="max-w-4xl space-y-6">
      <h2 className="text-xl font-bold text-foreground">Diffusion</h2>
      <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-4 text-sm leading-6 text-muted-foreground">
        <p>
          {autoPublish
            ? `Source officielle${sourceName ? ` (${sourceName})` : ""} : Facebook et Instagram sont publiés automatiquement après la publication de l’article.`
            : `Source non officielle${sourceName ? ` (${sourceName})` : ""} : une personne doit valider Facebook et Instagram avant leur envoi.`}
        </p>
        <p>
          X reste manuel : copiez le texte, publiez-le sur X, puis marquez-le comme publié.
          Un réseau dont l’API n’est pas configurée reste en brouillon.
        </p>
      </div>
      <p role="status" aria-live="polite" className="text-sm text-foreground">{message}</p>

      {PLATFORMS.map((platform) => {
        const post = posts.find((item) => item.platform === platform);
        const name = PLATFORM_NAMES[platform];
        const meta = platform !== "X";
        const ready = platform === "FACEBOOK"
          ? availability.facebook
          : platform === "INSTAGRAM"
            ? availability.instagram
            : true;

        return (
          <section key={platform} aria-label={`Post ${name}`} className="space-y-4 rounded-lg border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-bold text-foreground">{name}</h3>
                {post?.autoPublished && <span className="rounded-full bg-accent/20 px-3 py-1 text-xs font-semibold text-foreground">Automatique</span>}
              </div>
              {post && (
                <span className={`rounded-full px-3 py-1 text-xs ${post.status === "FAILED" ? "bg-status-error text-status-error-foreground" : "bg-muted text-foreground"}`}>
                  {statusLabel(post, autoPublish, meta)}
                </span>
              )}
            </div>

            {post ? (
              <>
                <p className="whitespace-pre-wrap break-words text-sm leading-7 text-foreground">{post.content}</p>
                {post.error && <p role="alert" className="rounded-md border border-status-error/40 bg-status-error/10 p-3 text-sm text-foreground">{post.error}</p>}
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(post.content);
                        setMessage(`Texte ${name} copié.`);
                      } catch {
                        setMessage("Copie impossible : sélectionnez et copiez le texte manuellement.");
                      }
                    }}
                  >
                    Copier le texte {name}
                  </button>

                  {editable && post.status !== "POSTED" && platform === "X" && (
                    <button
                      type="button"
                      disabled={pending}
                      className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
                      onClick={() => startTransition(async () => {
                        const result = await markSocialPostPosted(articleId, post.id);
                        setMessage(result.error ?? `Post ${name} marqué comme publié.`);
                        router.refresh();
                      })}
                    >
                      Marquer comme publié sur {name}
                    </button>
                  )}

                  {editable && meta && post.status !== "POSTED" && (
                    <>
                      {post.status !== "PUBLISHING" && ready && (
                        <button
                          type="button"
                          disabled={pending}
                          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
                          onClick={() => startTransition(async () => {
                            const result = await publishSocialPostNow(articleId, post.id);
                            setMessage(result.error ?? `Post ${name} publié.`);
                            router.refresh();
                          })}
                        >
                          Publier sur {name}
                        </button>
                      )}
                      {!ready && (
                        <p className="self-center text-xs text-muted-foreground">
                          Publication API non configurée pour {name}.
                        </p>
                      )}
                      {post.status !== "PUBLISHING" && (
                        <button
                          type="button"
                          disabled={pending}
                          className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground disabled:opacity-50"
                          onClick={() => startTransition(async () => {
                            const result = await markSocialPostPosted(articleId, post.id);
                            setMessage(result.error ?? `Post ${name} marqué comme publié manuellement.`);
                            router.refresh();
                          })}
                        >
                          Marquer comme publié sans API
                        </button>
                      )}
                    </>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Texte en cours de génération ou indisponible.</p>
            )}
          </section>
        );
      })}

      {editable && posts.length < PLATFORMS.length && (
        <button
          type="button"
          disabled={pending}
          className="rounded-md border border-border px-4 py-2 font-semibold text-foreground disabled:opacity-50"
          onClick={() => startTransition(async () => {
            const result = await retrySocialPosts(articleId);
            setMessage(result.error ?? "Textes générés.");
            router.refresh();
          })}
        >
          {pending ? "Génération…" : "Générer les textes manquants"}
        </button>
      )}
    </section>
  );
}
