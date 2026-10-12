import Image from "next/image";
import Link from "next/link";

import { themeBadgeStyle } from "@/lib/themes";

/**
 * Métadonnées d'un article : auteur, date, catégorie, durée de lecture et — WP16b —
 * thèmes éditoriaux en badges cliquables vers `/theme/[slug]`.
 *
 * Les thèmes sont optionnels : un article sans thème produit exactement le rendu
 * d'avant le WP16b.
 */
export function ArticleMeta({ author, category, themes = [], date, minutes }: { author: {name:string;slug:string|null;photoUrl:string|null}; category:{name:string;slug:string}; themes?: {name:string;slug:string;color:string|null}[]; date:Date|null; minutes:number }) {
  const days = date ? Math.max(0, Math.floor((Date.now()-date.getTime())/86400000)) : 0;
  const relative = days===0 ? "Aujourd’hui" : new Intl.RelativeTimeFormat("fr",{numeric:"auto"}).format(-days,"day");
  return <div className="my-6 flex flex-wrap items-center gap-x-6 gap-y-3 border-y border-border py-4 text-sm text-muted-foreground">
    <div className="flex items-center gap-3">{author.photoUrl ? <Image src={author.photoUrl} alt="" width={44} height={44} loading="lazy" className="h-11 w-11 rounded-full object-cover" /> : <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-full bg-muted font-bold text-foreground">{author.name.slice(0,1)}</span>}<span className="font-bold text-foreground">{author.slug ? <Link href={`/auteur/${author.slug}`}>{author.name}</Link> : author.name}</span></div>
    {date && <time dateTime={date.toISOString()} title={date.toLocaleString("fr-FR",{timeZone:"Africa/Lagos"})}>{relative}</time>}
    <Link href={`/rss/${category.slug}`} className="font-bold text-editorial-link">{category.name}</Link><span>{minutes} min de lecture</span>
    {themes.length > 0 && <ul aria-label="Thèmes de l’article" className="flex flex-wrap items-center gap-2">{themes.map((theme) => <li key={theme.slug}><Link href={`/theme/${theme.slug}`} className="theme-badge theme-badge--link" style={themeBadgeStyle(theme.color)}>{theme.name}</Link></li>)}</ul>}
  </div>;
}
