import type { Metadata } from "next";
import { MailPlus } from "lucide-react";
import Link from "next/link";

import { NewsletterForm } from "@/components/NewsletterForm";
import { Footer } from "@/components/Footer";
import { Card, CardBody } from "@/components/ui/Card";
import { availableLists } from "@/lib/newsletter-send";

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
  title: "Newsletter — Mon Site d'Actualités",
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
      <main id="contenu" className="mx-auto w-full max-w-3xl px-4 py-12">
        <header className="mb-8 border-b border-neutral-200 pb-6">
          <p className="inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-800">
            <MailPlus aria-hidden="true" className="h-3.5 w-3.5" />
            Newsletter
          </p>
          <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-primary-900 sm:text-4xl">
            Recevez l&apos;essentiel de l&apos;actualité sportive
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-600">
            Choisissez vos listes, confirmez votre adresse par e-mail, et c&apos;est tout. Aucune
            donnée n&apos;est revendue, aucun profil publicitaire n&apos;est construit à partir de
            votre adresse.
          </p>
        </header>

        <div className="grid gap-8 lg:grid-cols-[1fr_260px]">
          <Card>
            <CardBody>
              <NewsletterForm lists={lists} />
            </CardBody>
          </Card>

          <aside className="space-y-4 text-sm">
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
              <h2 className="text-sm font-bold text-neutral-800">Ce que vous recevez</h2>
              <ul className="mt-2 space-y-2 text-neutral-600">
                {PROMISES.map((promise) => (
                  <li key={promise} className="flex gap-2">
                    <span aria-hidden="true" className="text-primary-700">
                      ·
                    </span>
                    <span>{promise}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-4 text-neutral-600">
              <h2 className="text-sm font-bold text-neutral-800">Déjà inscrit ?</h2>
              <p className="mt-2">
                Chaque e-mail contient un lien pour gérer vos listes ou vous désabonner. Saisissez de
                nouveau votre adresse ci-contre : nous vous renvoyons ce lien.
              </p>
              <p className="mt-3">
                <Link
                  href="/confidentialite"
                  className="font-semibold text-primary-700 underline transition-colors hover:text-primary-900"
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
