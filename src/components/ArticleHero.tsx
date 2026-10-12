import Image from "next/image";
import { PremiumBadge } from "@/components/PremiumBadge";
export function ArticleHero({ title, image, premium }: { title: string; image: string | null; premium: boolean }) {
  return <header className="relative isolate overflow-hidden bg-card text-foreground">
    {image && <div className="relative aspect-video"><Image src={image} alt="" fill priority sizes="(max-width: 1200px) 100vw, 1200px" className="object-cover" /></div>}
    <div className={image ? "absolute inset-0 bg-overlay bg-gradient-to-t from-overlay to-transparent" : "hidden"} aria-hidden="true" />
    <div className={image ? "absolute inset-x-0 bottom-0 p-4 text-primary-foreground md:p-8 lg:p-12" : "border-y border-border py-8"}>
      {premium && <PremiumBadge />}
      <h1 className="mt-2 max-w-4xl text-xl font-black leading-tight tracking-tight sm:text-3xl md:text-4xl lg:text-5xl">{title}</h1>
    </div>
  </header>;
}
