import type { Metadata } from "next";
import { ArrowLeft, Scale } from "lucide-react";
import Link from "next/link";

import { Footer } from "@/components/Footer";
import { Card, CardBody } from "@/components/ui/Card";
import { SITE_NAME, buildPageMetadata } from "@/lib/seo";

/**
 * Mentions légales (WP9). Page statique, sans donnée personnelle : elle
 * décrit honnêtement l'état du site (environnement de démonstration, contenus
 * et paiements fictifs).
 */
export const metadata: Metadata = buildPageMetadata({
  title: "Mentions légales",
  description: `Informations légales du site ${SITE_NAME} : éditeur, responsabilité, propriété intellectuelle et sources.`,
  path: "/mentions-legales",
});

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-neutral-200 pt-6 first:border-0 first:pt-0">
      <h2 className="text-lg font-bold tracking-tight text-primary-900">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-7 text-neutral-700">{children}</div>
    </section>
  );
}

export default function LegalNoticePage() {
  return (
    <>
      <main id="contenu" className="mx-auto w-full max-w-3xl px-4 py-10">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-primary-700 transition-colors hover:text-primary-900"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Retour à l&apos;accueil
        </Link>

        <header className="mb-8">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-accent-700">
            <Scale aria-hidden="true" className="h-4 w-4" />
            Informations légales
          </p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-primary-900 sm:text-4xl">
            Mentions légales
          </h1>
        </header>

        <Card>
          <CardBody className="space-y-8 p-6 sm:p-8">
            <Block title="Éditeur du site">
              <p>
                {SITE_NAME} est un <strong>site de démonstration</strong> d&apos;actualité
                sportive. Il n&apos;est pas encore exploité publiquement : il s&apos;exécute dans
                un environnement de développement local, à des fins de mise au point.
              </p>
              <p>
                Direction de la publication : la direction éditoriale du site. Aucune adresse de
                contact publique n&apos;est encore publiée.
              </p>
            </Block>

            <Block title="Hébergement">
              <p>
                Aucun hébergeur n&apos;est engagé à ce stade. Lors de la mise en ligne, cette page
                précisera le nom, l&apos;adresse et les coordonnées de l&apos;hébergeur retenu.
              </p>
            </Block>

            <Block title="Contenus et données de démonstration">
              <p>
                Les articles, scores, classements, noms d&apos;auteurs et abonnements présents sur
                ce site sont des <strong>contenus fictifs de démonstration</strong>. Les paiements
                sont effectués avec les moyens de test du prestataire Stripe : aucune somme réelle
                n&apos;est encaissée.
              </p>
            </Block>

            <Block title="Sources des données sportives">
              <p>
                Les compétitions, équipes, rencontres et scores proviennent de l&apos;API publique
                Football-Data.org. Les noms, écussons et marques des clubs et compétitions
                appartiennent à leurs détenteurs respectifs et sont utilisés à titre informatif.
              </p>
            </Block>

            <Block title="Propriété intellectuelle">
              <p>
                La structure du site, son design et ses composants sont protégés par le droit
                d&apos;auteur. Toute reproduction des contenus éditoriaux sans autorisation est
                interdite.
              </p>
            </Block>

            <Block title="Données personnelles et cookies">
              <p>
                Le traitement des données personnelles et les cookies utilisés sont décrits sur la
                page{" "}
                <Link
                  href="/confidentialite"
                  className="font-semibold text-primary-700 underline transition-colors hover:text-primary-900"
                >
                  Politique de confidentialité
                </Link>
                .
              </p>
            </Block>
          </CardBody>
        </Card>
      </main>

      <Footer />
    </>
  );
}
