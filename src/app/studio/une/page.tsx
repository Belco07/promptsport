import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FEATURED_SLOTS, FEATURED_LABELS, getHomepageFeatured } from "@/lib/featured";
import { FeaturedSlotCard } from "@/components/studio/FeaturedSlotCard";
import { HeroArticle } from "@/components/HeroArticle";
import { SecondaryArticle } from "@/components/SecondaryArticle";
import { UrgentBanner } from "@/components/UrgentBanner";

export const dynamic = "force-dynamic";
export default async function FeaturedPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!["ADMIN", "EDITOR"].includes(session.user.role)) redirect("/studio");
  const [slots, preview] = await Promise.all([
    prisma.featuredSlot.findMany({ include: { article: { select: { id: true, title: true, coverImageUrl: true, publishedAt: true, status: true } } } }),
    getHomepageFeatured(),
  ]);
  const canSwap = slots.some(row => row.slot === "SECONDARY_1") && slots.some(row => row.slot === "SECONDARY_2");
  const [hero, ...secondary] = preview.articles;
  return <main className="space-y-8 px-6 py-10 text-foreground">
    <header><h1 className="text-3xl font-bold">Piloter la une</h1><p className="mt-2 text-muted-foreground">Choisissez les articles mis en avant. Retirer une sélection réactive le choix automatique, sauf pour le bandeau urgent.</p></header>
    <div className="grid gap-5 xl:grid-cols-2">{FEATURED_SLOTS.map(slot => {
      const article = slots.find(row => row.slot === slot)?.article;
      return <FeaturedSlotCard key={slot} slot={slot} label={FEATURED_LABELS[slot]} canSwap={canSwap} unavailable={Boolean(article && (article.status !== "PUBLISHED" || !article.publishedAt || article.publishedAt > new Date()))} article={article ? { id: article.id, title: article.title, coverImageUrl: article.coverImageUrl, publishedAt: article.publishedAt?.toISOString() ?? null } : null} />;
    })}</div>
    <section aria-labelledby="featured-preview" className="space-y-4 rounded-md border border-border bg-background p-5">
      <h2 id="featured-preview" className="text-xl font-bold">Aperçu de l’accueil</h2>
      {preview.urgent && <UrgentBanner article={preview.urgent} />}
      {hero ? <div className="grid gap-4 lg:grid-cols-[2fr_1fr]"><HeroArticle article={hero} /><div className="space-y-4">{secondary.map(article => <SecondaryArticle key={article.id} article={article} />)}</div></div> : <p className="text-muted-foreground">Aucun article disponible pour la une.</p>}
    </section>
  </main>;
}
