"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useReaderJourney } from "@/components/ReaderJourney";
import { absoluteUrl, jsonLdString } from "@/lib/seo";

export type BreadcrumbItem = { label: string; href: string };

/** Explicit editorial ancestry; never infer names or parents from URL slugs. */
export function Breadcrumbs({ items, structuredData = true, className = "mb-6" }: { items: BreadcrumbItem[]; structuredData?: boolean; className?: string }) {
  const { steps: journey, labelCurrent } = useReaderJourney();
  const pathname = usePathname();
  const currentItem = items[items.length - 1];
  useEffect(() => {
    if (currentItem?.href.split("?")[0] === pathname) labelCurrent(pathname, currentItem.label);
  }, [currentItem?.href, currentItem?.label, pathname, labelCurrent]);
  if (!items.length) return null;
  const canonical = [{ label: "Accueil", href: "/" }, ...items];
  const latest = journey[journey.length - 1];
  const trail = latest?.href.split("?")[0] === pathname ? journey.map((step, index) => index === journey.length - 1 ? { ...step, label: items[items.length - 1].label } : step) : canonical;
  return <>
    <nav aria-label="Fil d’Ariane" data-breadcrumb className={`min-w-0 text-xs text-muted-foreground sm:text-sm ${className}`}>
      <ol className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {trail.map((item, index) => <li key={`${item.href}-${index}`} className={`inline-flex max-w-full items-center gap-2 ${index === trail.length - 1 ? "min-w-[8rem] flex-1" : "shrink-0"}`}>
          {index > 0 && <span aria-hidden="true" className="shrink-0 opacity-60">/</span>}
          {index === trail.length - 1 ? <span aria-current="page" title={item.label} className="block truncate py-2 font-medium text-foreground">{item.label}</span> : <Link href={item.href} title={item.label} className="inline-flex min-h-9 min-w-0 items-center rounded-sm font-medium underline-offset-4 transition-colors hover:text-editorial-link hover:underline motion-reduce:transition-none"><span className="max-w-[9rem] truncate sm:max-w-[16rem]">{item.label}</span></Link>}
        </li>)}
      </ol>
    </nav>
    {structuredData && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: canonical.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.label, item: absoluteUrl(item.href) })) }) }} />}
  </>;
}
