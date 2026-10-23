import Link from "next/link";
import { ChevronRight } from "@/components/icons";
import { absoluteUrl, jsonLdString } from "@/lib/seo";

export type BreadcrumbItem = { label: string; href: string };

/** Explicit editorial ancestry; never infer names or parents from URL slugs. */
export function Breadcrumbs({ items, structuredData = true, className = "mb-6" }: { items: BreadcrumbItem[]; structuredData?: boolean; className?: string }) {
  if (!items.length) return null;
  const trail = [{ label: "Accueil", href: "/" }, ...items];
  return <>
    <nav aria-label="Fil d’Ariane" data-breadcrumb className={`min-w-0 text-xs text-muted-foreground sm:text-sm ${className}`}>
      <ol className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {trail.map((item, index) => <li key={`${item.href}-${index}`} className={`inline-flex max-w-full items-center gap-2 ${index === trail.length - 1 ? "min-w-[8rem] flex-1" : "shrink-0"}`}>
          {index > 0 && <ChevronRight aria-hidden="true" size={13} className="shrink-0 opacity-60" />}
          {index === trail.length - 1 ? <span aria-current="page" title={item.label} className="block truncate py-2 font-medium text-foreground">{item.label}</span> : <Link href={item.href} className="inline-flex min-h-9 items-center rounded-sm font-medium underline-offset-4 transition-colors hover:text-editorial-link hover:underline motion-reduce:transition-none">{item.label}</Link>}
        </li>)}
      </ol>
    </nav>
    {structuredData && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: trail.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.label, item: absoluteUrl(item.href) })) }) }} />}
  </>;
}
