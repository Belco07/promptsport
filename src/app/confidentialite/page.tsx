import type { Metadata } from "next";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { Footer } from "@/components/Footer";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody } from "@/components/ui/Card";
import { SITE_NAME, buildPageMetadata } from "@/lib/seo";

/**
 * Politique de confidentialité (WP9).
 *
 * Elle décrit ce que le site fait réellement : mesure d'audience maison sans
 * cookie tiers ni adresse IP (WP8d), comptes rédacteurs, abonnements traités
 * par Stripe. Aucune promesse qui ne serait pas tenue par le code.
 */
export const metadata: Metadata = buildPageMetadata({
  title: "Politique de confidentialité",
  description: `Quelles données ${SITE_NAME} collecte, pourquoi, combien de temps, et comment exercer vos droits.`,
  path: "/confidentialite",
});

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-neutral-200 pt-6 first:border-0 first:pt-0">
      <h2 className="text-lg font-bold tracking-tight text-primary-900">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-7 text-neutral-700">{children}</div>
    </section>
  );
}

/** Tableau des cookies déposés par le site. */
const COOKIES = [
  {
    name: "ps_vid",
    purpose: "Mesure d'audience anonyme (identifiant visiteur aléatoire)",
    life: "30 jours",
    type: "First-party, HttpOnly",
  },
  {
    name: "authjs.session-token",
    purpose: "Maintien de votre session lorsque vous êtes connecté",
    life: "Session / 30 jours",
    type: "First-party, HttpOnly",
  },
  {
    name: "authjs.csrf-token",
    purpose: "Protection des formulaires contre les requêtes falsifiées",
    life: "Session",
    type: "First-party",
  },
];

export default function PrivacyPage() {
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
            <ShieldCheck aria-hidden="true" className="h-4 w-4" />
            Vie privée
          </p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-primary-900 sm:text-4xl">
            Politique de confidentialité
          </h1>
          <p className="mt-3 text-sm text-neutral-600">
            Principe directeur : collecter le minimum, ne rien revendre, et ne pas suivre les
            lecteurs d&apos;un site à l&apos;autre.
          </p>
        </header>

        <Card>
          <CardBody className="space-y-8 p-6 sm:p-8">
            <Block title="Mesure d'audience">
              <p>
                L&apos;audience est mesurée par un outil <strong>interne au site</strong>, sans
                Google Analytics ni aucun service tiers. Aucune adresse IP n&apos;est enregistrée,
                aucun profil publicitaire n&apos;est constitué, aucune donnée n&apos;est revendue.
              </p>
              <p>
                Chaque visite reçoit un identifiant visiteur aléatoire (UUID) conservé dans un
                cookie. Il permet de compter des visiteurs uniques et de distinguer un nouveau
                visiteur d&apos;un habitué, rien de plus. Les événements bruts (pages vues) sont
                purgés au-delà de <strong>90 jours</strong> ; seuls des agrégats journaliers
                anonymes (nombre de visiteurs, pages et sources les plus consultées) sont conservés
                sans limite.
              </p>
            </Block>

            <Block title="Cookies utilisés">
              <div className="scroll-x">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                      <th scope="col" className="py-2 pr-4 font-semibold">
                        Cookie
                      </th>
                      <th scope="col" className="py-2 pr-4 font-semibold">
                        Finalité
                      </th>
                      <th scope="col" className="py-2 pr-4 font-semibold">
                        Durée
                      </th>
                      <th scope="col" className="py-2 font-semibold">
                        Type
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {COOKIES.map((cookie) => (
                      <tr key={cookie.name} className="border-b border-neutral-100 last:border-0">
                        <td className="py-2.5 pr-4 font-mono text-xs text-neutral-900">
                          {cookie.name}
                        </td>
                        <td className="py-2.5 pr-4 text-neutral-700">{cookie.purpose}</td>
                        <td className="py-2.5 pr-4 whitespace-nowrap text-neutral-700">
                          {cookie.life}
                        </td>
                        <td className="py-2.5">
                          <Badge variant="status" tone="primary">
                            {cookie.type}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>
                Aucun cookie tiers, aucun pixel publicitaire, aucun traceur de réseau social
                n&apos;est déposé.
              </p>
            </Block>

            <Block title="Compte et abonnement">
              <p>
                La création d&apos;un compte rédacteur enregistre un nom, une adresse e-mail, un
                rôle et un mot de passe <strong>haché</strong> (bcrypt) : le mot de passe en clair
                n&apos;est jamais stocké.
              </p>
              <p>
                Les abonnements et paiements sont traités par <strong>Stripe</strong>. Le site
                conserve l&apos;identifiant du client et de l&apos;abonnement, le montant, la date
                et le statut ; <strong>aucun numéro de carte bancaire</strong> ne transite ni n&apos;est
                stocké sur nos serveurs.
              </p>
            </Block>

            <Block title="Vos droits">
              <p>
                Vous pouvez consulter et corriger votre nom depuis la page{" "}
                <Link
                  href="/mon-compte"
                  className="font-semibold text-primary-700 underline transition-colors hover:text-primary-900"
                >
                  Mon compte
                </Link>
                . Pour obtenir une copie de vos données, demander leur suppression ou vous opposer à
                un traitement, adressez votre demande à la direction de la publication : elle sera
                traitée dans un délai d&apos;un mois.
              </p>
              <p>
                Ce site étant un environnement de démonstration, les comptes et abonnements qui y
                figurent sont fictifs.
              </p>
            </Block>
          </CardBody>
        </Card>
      </main>

      <Footer />
    </>
  );
}
