import type { Metadata } from "next";
import Link from "next/link";

import { NewsletterForm } from "@/components/NewsletterForm";
import { Footer } from "@/components/Footer";
import { Card, CardBody } from "@/components/ui/Card";
import { availableLists } from "@/lib/newsletter-send";
import { PageBand } from "@/components/PageBand";

/**
 * Inscription publique à la newsletter (WP11c).
 *
 * La page ne fait que lire les listes actives et rendre le formulaire : toute la
 * logique (limitation de débit par IP, double opt-in, adresse déjà connue) vit
 * dans la Server Action `subscribeToNewsletter`, qui est un point d'entrée HTTP
 * à part entière.
 *
 * Aucun jeton n'est affiché ici : le lien de gestion des préférences n'arrive que
 * par e-mail, pour qu'on ne puisse pas obtenir les liens d'un tiers en saisissant
 * son adresse.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Newsletter",
  description:
    "Recevez l'essentiel de l'actualité sportive : analyses, résultats et classements, directement dans votre boîte mail.",
  alternates: { canonical: "/newsletter" },
};

const PROMISES = [
  "L'essentiel de l'actualité sportive, sans remplissage.",
  "Un rythme maîtrisé : pas plus d'un envoi par liste et par semaine.",
  "Désabonnement en un clic, sans justification, depuis chaque e-mail.",
];

export default async function NewsletterPage() {
  const lists = await availableLists();

  return (
    <>
      <main id="contenu" className="mx-auto w-full max-w-3xl px-4 pb-12">
        <PageBand
          kicker="Newsletter"
          title="Recevez l'essentiel de l'actualité sportive"
          description="Choisissez vos listes, confirmez votre adresse par e-mail, et c'est tout. Aucune donnée n'est revendue, aucun profil publicitaire n'est construit à partir de votre adresse."
        />

        <div className="grid gap-8 lg:grid-cols-[1fr_260px]">
          <Card>
            <CardBody>
              <NewsletterForm lists={lists} />
            </CardBody>
          </Card>

          <aside className="space-y-4 text-sm">
            <div className="rounded-xl border border-border bg-muted p-4">
              <h2 className="text-sm font-bold text-foreground">Ce que vous recevez</h2>
              <ul className="mt-2 space-y-2 text-muted-foreground">
                {PROMISES.map((promise) => (
                  <li key={promise} className="flex gap-2">
                    <span aria-hidden="true" className="text-editorial-link">
                      ·
                    </span>
                    <span>{promise}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 text-muted-foreground">
              <h2 className="text-sm font-bold text-foreground">Déjà inscrit ?</h2>
              <p className="mt-2">
                Chaque e-mail contient un lien pour gérer vos listes ou vous désabonner. Saisissez de
                nouveau votre adresse ci-contre : nous vous renvoyons ce lien.
              </p>
              <p className="mt-3">
                <Link
                  href="/confidentialite"
                  className="font-semibold text-editorial-link underline transition-colors hover:text-editorial-link"
                >
                  Politique de confidentialité
                </Link>
              </p>
            </div>
          </aside>
        </div>
      </main>

      <Footer />
    </>
  );
}
