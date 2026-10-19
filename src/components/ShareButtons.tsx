"use client";
import { BookmarkButton } from "@/components/BookmarkButton";
import { useState, useTransition } from "react";
import { reactToArticle } from "@/app/article/[slug]/actions";
import { ARTICLE_REACTION_TYPES, PUBLIC_REACTION_COUNTERS, REACTION_EMOJI, REACTION_LABELS, type ReactionCounts, type ReactionType } from "@/lib/engagement";

/**
 * Barre de réactions d'un article : pouce, cœur et enregistrement (favori privé).
 *
 * Elle n'est rendue qu'**une fois**, en fin d'article : le partage est porté par
 * le rail latéral (`ArticleShareLinks`), qui suit la lecture jusqu'en bas.
 * L'ancienne barre horizontale de partage et la barre de réactions placée avant
 * le corps de l'article faisaient doublon et ont été retirées.
 *
 * Un seul état client et la Server Action existante : le bouton « Enregistrer »
 * reflète le favori privé renvoyé par l'action, sans requête supplémentaire.
 *
 * Les libellés accessibles reprennent le texte visible **sans parenthèses** :
 * axe vérifie que le texte visible est contenu dans le nom accessible et
 * retire le contenu entre parenthèses (label-content-name-mismatch, WP30).
 */
export function ArticleReactionBars({articleId,initialCounts,initialMine,canReact,disabledReason}:{articleId:string;initialCounts:ReactionCounts;initialMine:ReactionType|null;canReact:boolean;disabledReason:string}){
 const [state,setState]=useState({counts:initialCounts,mine:initialMine});const [pending,start]=useTransition();const [error,setError]=useState("");
 return <div className="flex flex-wrap items-center gap-2">{ARTICLE_REACTION_TYPES.filter(type=>type!=="BOOKMARK").map(type=>{const active=state.mine===type;const counted=PUBLIC_REACTION_COUNTERS.includes(type);return <button key={type} type="button" aria-pressed={active} aria-label={counted?`${REACTION_LABELS[type]} ${state.counts[type]??0}`:active?"Enregistré":"Enregistrer"} disabled={!canReact||pending} title={canReact?REACTION_LABELS[type]:disabledReason} onClick={()=>{setError("");start(async()=>{const result=await reactToArticle(articleId,type);if(result.ok&&result.state)setState(result.state);else if(!result.ok)setError(result.error);});}} className={`rounded-full border px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed ${active?"border-editorial-link bg-muted text-editorial-link":"border-border bg-card text-muted-foreground"}`}><span aria-hidden="true">{REACTION_EMOJI[type]}</span> {counted?state.counts[type]??0:active?"Enregistré":"Enregistrer"}</button>})}<BookmarkButton articleId={articleId} />{error&&<p role="alert" className="w-full text-sm text-status-error-foreground">{error}</p>}</div>;
}
