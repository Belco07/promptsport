import type { Metadata } from "next";
import { ArrowRight, Radio, Trophy } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { ArticleCard, type ArticleCardData } from "@/components/ArticleCard";
import { Footer } from "@/components/Footer";
import { PremiumBadge } from "@/components/PremiumBadge";
import { formatDate } from "@/lib/formatDate";
import { prisma } from "@/lib/prisma";
import {
  HOME_TITLE,
  SITE_DESCRIPTION,
  buildPageMetadata,
  jsonLdString,
  organizationJsonLd,
} from "@/lib/seo";

/**
 * Une éditoriale (WP9).
 *
 * À la une à gauche, fil d'actualité et encart abonnement à droite ; la grille
 * des dernières actualités ferme la page. Tout le style vient des jetons du
 * design system (`brand` pour le rouge éditorial, `ink` pour les noirs,
 * `heavy` et `strong` pour les graisses intermédiaires) : plus aucune classe
 * `news-*` n'est nécessaire.
 */

export const metadata: Metadata = buildPageMetadata({
  title: { absolute: HOME_TITLE },
  description: SITE_DESCRIPTION,
  path: "/",
});

// Les articles publiés doivent apparaître sans reconstruire le site.
export const revalidate = 60;

/** Date courte du fil d'actualité (jour/mois). */
const WIRE_DATE = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
});

async function getPublishedArticles(): Promise<ArticleCardData[]> {
  return prisma.article.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { publishedAt: "desc" },
    // La une affiche l'article le plus récent puis une grille : on borne la
    // liste pour que le poids de la page ne croisse pas avec les archives
    // (au-delà, le fil info et les rubriques prennent le relais).
    take: 12,
    select: {
      slug: true,
      title: true,
      excerpt: true,
      coverImageUrl: true,
      publishedAt: true,
      isPremium: true,
      category: { select: { name: true } },
      author: { select: { name: true, slug: true } },
    },
  });
}

export default async function Home() {
  const articles = await getPublishedArticles();
  const [lead, ...rest] = articles;

  return (
    <>
      <main id="contenu" className="mx-auto w-full max-w-6xl px-4 pt-[27px] max-[600px]:pt-5">
        {/* Données structurées : le site et son éditeur (WP8a). */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdString(organizationJsonLd()) }}
        />

        {/* Manchette : titre de une et accès direct aux scores. */}
        <div className="mb-6 flex items-center justify-between gap-5 border-b-[3px] border-b-ink-800 pb-5 max-[600px]:mb-[18px] max-[600px]:gap-3">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[1.7px] text-ink-600 max-[600px]:text-[8px]">
              Le sport, au cœur du jeu
            </p>
            <h1 className="mt-[5px] text-[clamp(34px,5vw,48px)] font-black leading-[1.1] tracking-[-2px] text-ink-950">
              À la une<span className="text-brand-500">.</span>
            </h1>
          </div>
          <Link
            href="/scores"
            className="flex shrink-0 items-center gap-[9px] text-xs font-strong transition-colors hover:text-brand-600 max-[600px]:gap-[5px] max-[600px]:text-[10px]"
          >
            <Trophy aria-hidden="true" size={17} className="max-[600px]:hidden" />
            Scores &amp; résultats
            <ArrowRight aria-hidden="true" size={16} />
          </Link>
        </div>

        {lead ? (
          <div className="grid grid-cols-[minmax(0,1fr)_310px] gap-[30px] max-[900px]:grid-cols-1">
            <div className="min-w-0">
              <section aria-label="L'article à la une">
                <Link
                  href={`/article/${lead.slug}`}
                  className="group block border-b border-b-ink-200 bg-white"
                >
                  <div className="relative aspect-video overflow-hidden bg-ink-800">
                    {lead.coverImageUrl ? (
                      <Image
                        src={lead.coverImageUrl}
                        alt=""
                        fill
                        priority
                        fetchPriority="high"
                        // Le créneau réel de la une fait ~780 px, mais la
                        // variante 768 px pèse ~2 Ko de plus que la 640 px sur
                        // la page la plus lourde du site : on déclare 640 px
                        // (les écrans haute densité choisissent de toute façon
                        // une variante supérieure).
                        sizes="(max-width: 900px) 94vw, 640px"
                        // Qualité 70 : ~15 % d'octets en moins en AVIF, écart
                        // invisible sur une photographie d'illustration.
                        quality={70}
                        className="object-cover transition-transform duration-500 group-hover:scale-[1.025] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                      />
                    ) : (
                      <div className="grid h-full w-full place-items-center bg-gradient-to-br from-ink-950 to-ink-700 text-white">
                        <Trophy aria-hidden="true" size={72} />
                      </div>
                    )}
                    <span className="absolute bottom-0 left-0 bg-brand-500 px-[15px] py-[7px] text-[11px] font-extrabold uppercase tracking-[1px] text-white">
                      À la une
                    </span>
                  </div>

                  <div className="px-[22px] pb-[22px] pt-[23px] max-[600px]:px-[15px] max-[600px]:py-[19px]">
                    <div className="flex items-center gap-[10px] text-[11px] font-extrabold uppercase tracking-[.6px] text-brand-600">
                      {lead.category?.name ?? "Actualité"}
                      {lead.isPremium ? <PremiumBadge /> : null}
                    </div>
                    <h2 className="mt-[9px] text-[clamp(26px,3vw,38px)] font-heavy leading-[1.1] tracking-[-1.3px] text-ink-950 [text-wrap:pretty] transition-colors group-hover:text-brand-700">
                      {lead.title}
                    </h2>
                    {lead.excerpt ? (
                      <p className="mt-[13px] text-sm leading-[1.7] text-ink-600">
                        {lead.excerpt}
                      </p>
                    ) : null}
                    <p className="mt-4 flex flex-wrap gap-2 text-[10px] text-ink-500">
                      Par {lead.author?.name ?? "la rédaction"}
                      <span aria-hidden="true">·</span>
                      <time dateTime={lead.publishedAt?.toISOString()}>
                        {formatDate(lead.publishedAt)}
                      </time>
                    </p>
                  </div>
                </Link>
              </section>

              {rest.length > 0 ? (
                <section aria-labelledby="derniers-articles" className="mt-[34px]">
                  <div className="mb-5 flex items-baseline justify-between gap-[15px] border-t-[3px] border-t-ink-800 pt-[14px]">
                    <h2 id="derniers-articles" className="text-[23px] font-heavy">
                      Dernières actualités
                    </h2>
                    <span className="text-[10px] text-ink-500 max-[600px]:hidden">
                      Le regard de la rédaction
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-x-5 gap-y-7 sm:grid-cols-2">
                    {rest.map((article) => (
                      <ArticleCard key={article.slug} article={article} />
                    ))}
                  </div>
                </section>
              ) : null}
            </div>

            <aside
              aria-label="Fil d'actualité et abonnement"
              className="max-[900px]:grid max-[900px]:grid-cols-2 max-[900px]:items-start max-[900px]:gap-[22px] max-[600px]:grid-cols-1"
            >
              <section
                aria-labelledby="fil-info"
                className="border border-ink-200 border-t-[3px] border-t-brand-500 bg-white"
              >
                <div className="flex items-center justify-between border-b border-b-ink-100 px-[17px] py-[17px]">
                  <h2 id="fil-info" className="flex items-center gap-2 text-[19px] font-heavy">
                    <Radio aria-hidden="true" size={18} className="text-brand-500" />
                    Le fil info
                  </h2>
                  <span className="text-[8px] font-extrabold tracking-[.5px] text-brand-700">
                    EN CONTINU
                  </span>
                </div>

                <ol className="px-[17px]">
                  {articles.slice(0, 8).map((article) => (
                    <li
                      key={article.slug}
                      className="grid grid-cols-[37px_minmax(0,1fr)] gap-[10px] border-b border-b-ink-100 py-4 last:border-b-0"
                    >
                      <time
                        dateTime={article.publishedAt?.toISOString()}
                        className="pt-[3px] text-[10px] font-extrabold tabular-nums text-brand-600"
                      >
                        {article.publishedAt ? WIRE_DATE.format(article.publishedAt) : "—"}
                      </time>
                      <Link href={`/article/${article.slug}`} className="group">
                        <span className="mb-1 block text-[9px] font-bold uppercase text-ink-400">
                          {article.category?.name ?? "Actualité"}
                        </span>
                        <h3 className="text-[13px] leading-[1.4] tracking-[-.2px] [text-wrap:pretty] transition-colors group-hover:text-brand-600">
                          {article.title}
                        </h3>
                      </Link>
                    </li>
                  ))}
                </ol>

                {rest.length > 0 ? (
                  <a
                    href="#derniers-articles"
                    className="flex items-center justify-center gap-[10px] p-4 text-[11px] font-extrabold transition-colors hover:text-brand-600"
                  >
                    Toute l&apos;actualité
                    <ArrowRight aria-hidden="true" size={15} />
                  </a>
                ) : null}
              </section>

              <section className="mt-[23px] border-t-[3px] border-t-brand-500 bg-ink-900 px-[23px] py-[25px] text-white max-[900px]:mt-0">
                <span className="text-[10px] font-extrabold uppercase tracking-[1.7px] text-brand-300">
                  L&apos;espace abonnés
                </span>
                <h2 className="mt-[15px] text-[27px] leading-[1.1] tracking-[-.8px]">
                  Vivez le sport.
                  <br />
                  Comprenez le jeu.
                </h2>
                <p className="mt-[14px] text-xs leading-[1.7] text-ink-300">
                  Analyses, décryptages et articles premium : allez plus loin avec notre
                  rédaction.
                </p>
                <Link
                  href="/abonnement"
                  className="mt-[22px] flex items-center justify-between gap-2 bg-brand-500 px-[15px] py-3 text-xs font-strong transition-colors hover:bg-brand-700"
                >
                  Découvrir les offres
                  <ArrowRight aria-hidden="true" size={16} />
                </Link>
              </section>
            </aside>
          </div>
        ) : (
          <p className="border border-dashed border-neutral-300 bg-white p-10 text-center text-neutral-600">
            Aucun article publié pour le moment.
          </p>
        )}

        {/* Encart newsletter (WP11c) : discret, sous la une, et affiché même
            quand aucun article n'est publié. */}
        <section
          aria-labelledby="encart-newsletter"
          className="mt-[30px] flex flex-wrap items-center justify-between gap-[18px] border border-ink-200 bg-white px-[23px] py-[20px]"
        >
          <div className="min-w-0">
            <h2
              id="encart-newsletter"
              className="text-[17px] font-extrabold tracking-[-.3px] text-ink-950"
            >
              Recevez l&apos;essentiel de l&apos;actualité sportive
            </h2>
            <p className="mt-[6px] text-xs leading-[1.7] text-neutral-600">
              Un e-mail quand l&apos;actualité le mérite, pas tous les jours. Désabonnement en un
              clic.
            </p>
          </div>
          <Link
            href="/newsletter"
            className="flex shrink-0 items-center gap-[9px] border border-ink-950 px-[15px] py-3 text-xs font-strong transition-colors hover:bg-ink-950 hover:text-white"
          >
            S&apos;inscrire à la newsletter
            <ArrowRight aria-hidden="true" size={15} />
          </Link>
        </section>
      </main>
      <Footer />
    </>
  );
}
