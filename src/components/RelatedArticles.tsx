import { ArticleCard } from "@/components/ArticleCard";
import { prisma } from "@/lib/prisma";
export async function RelatedArticles({ slug, categorySlug, teams }: { slug?:string; categorySlug?:string|null; teams?:string[] }) {
  const names = [...new Set(teams?.map(name => name.trim()).filter(Boolean))];
  const articles = await prisma.article.findMany({where:{status:"PUBLISHED",publishedAt:{lte:new Date()},...(slug?{slug:{not:slug}}:{}),...(teams?{OR:names.map(name=>({title:{contains:name,mode:"insensitive" as const}}))}:categorySlug?{category:{slug:categorySlug}}:{})},orderBy:{publishedAt:"desc"},take:3,select:{slug:true,title:true,excerpt:true,coverImageUrl:true,publishedAt:true,isPremium:true,author:{select:{name:true,slug:true}},category:{select:{name:true}}}});
  return <section aria-labelledby="articles-connexes" className="mt-12"><h2 id="articles-connexes" className="mb-6 section-title">{teams ? "Articles liés au match" : "À lire aussi"}</h2>{articles.length ? <div className="grid gap-5 md:grid-cols-3">{articles.map(article=><ArticleCard key={article.slug} article={article} headingLevel={3}/>)}</div> : <p className="text-sm text-muted-foreground">Aucun article connexe pour le moment.</p>}</section>;
}
