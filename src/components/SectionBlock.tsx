import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

export function SectionBlock({ id, title, href, linkLabel = "Voir tout", children, description }: {
  id: string; title: string; href?: string; /** Libellé du lien d'en-tête (WP16d). */ linkLabel?: string; children: ReactNode; description?: string;
}) {
  return <section id={id} aria-labelledby={`${id}-title`} className="min-w-0 border-t-2 border-border pt-5">
    <div className="mb-5 flex items-baseline justify-between gap-4">
      <div><h2 id={`${id}-title`} className="text-2xl font-black uppercase tracking-tight text-foreground">{title}</h2>
        {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}</div>
      {href && <Link href={href} className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-foreground hover:underline">{linkLabel} <ArrowUpRight size={14} aria-hidden="true" /></Link>}
    </div>
    {children}
  </section>;
}
