import { Envelope } from "@phosphor-icons/react/ssr";
import Image from "next/image";
import Link from "next/link";

import { FooterNewsletterForm } from "@/components/FooterNewsletterForm";
import { SocialLinks } from "@/components/SocialLinks";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/seo";

/**
 * Pied de page du site public, disposé comme la référence « Digital Haven »
 * (mesures relevées sur la référence, en desktop), sur deux rangées :
 *
 *  - rangée 1 : à gauche (406 px) logo, présentation, « Suivez-nous » et
 *    réseaux ; à droite (80 px plus loin) newsletter dans un encadré à fin
 *    liseré arrondi à 21 px, avec une grande enveloppe vert lime translucide
 *    inclinée qui déborde du coin supérieur droit ;
 *  - rangée 2 : à gauche la frise de parallélogrammes, alignée sur le menu en
 *    capitales (séparé par de petits carrés gris), puis le copyright, aligné
 *    sur la ligne de mentions en 13 px gris.
 *
 * Sur mobile, la frise et le copyright passent en dernier.
 *
 * Les couleurs restent celles du site (`.editorial-footer` dans editorial.css).
 * Le copyright utilise l'année du rendu : les pages publiques sont régénérées
 * (ISR), la date reste donc juste sans code client.
 */

/** Menu du pied de page : capitales séparées par de petits carrés (référence). */
const FOOTER_LINKS = [
  { href: "/abonnement", label: "Abonnement" },
  { href: "/scores", label: "Compétitions" },
  { href: "/mon-sport", label: "Mon actualité" },
  { href: "/themes", label: "Les thèmes" },
];

export function Footer() {
  return (
    <footer className="editorial-footer mt-16 overflow-x-clip border-t-4 border-t-accent bg-foreground text-background">
      <div className="mx-auto grid max-w-[1280px] gap-x-20 gap-y-12 px-5 pb-[50px] pt-[60px] lg:grid-cols-[406px_minmax(0,1fr)] lg:gap-y-[30px]">
        {/* Rangée 1, à gauche : identité et réseaux. */}
        <div className="flex flex-col">
          <Link href="/" aria-label={`${SITE_NAME} — retour à l'accueil`} className="inline-flex self-start">
            <Image src="/promptsport-logo.webp" alt="" width={900} height={198} className="editorial-logo-day h-[51px] w-auto" />
            <Image src="/promptsport-logo-night.png" alt="" width={4739} height={1044} className="editorial-logo-night h-[51px] w-auto" />
          </Link>
          <p className="mt-5 text-base leading-6 text-muted-foreground">{SITE_DESCRIPTION}</p>

          <h2 id="pied-suivez" className="mt-10 text-base font-extrabold leading-none text-muted-foreground">Suivez-nous</h2>
          <SocialLinks labelledBy="pied-suivez" className="mt-5" />
        </div>

        {/* Rangée 1, à droite : newsletter encadrée. */}
        <div className="relative min-w-0">
          {/* Décoration : grande enveloppe vert lime translucide, inclinée,
              qui déborde du coin supérieur droit de l'encadré. */}
          <Envelope
            aria-hidden="true"
            size={133}
            className="pointer-events-none absolute -right-9 -top-9 z-0 rotate-[25deg] text-accent opacity-[.27] max-sm:-right-4 max-sm:size-20"
          />
          <section aria-labelledby="pied-newsletter" className="relative z-[1] rounded-[21px] border border-[#88888840] p-[25px] pb-[38px]">
            <h2 id="pied-newsletter" className="text-[28px] font-extrabold leading-none tracking-[-1.5px] text-foreground">
              Ne restez pas sur la touche.
            </h2>
            <p className="mt-[15px] text-base leading-5 text-muted-foreground">
              Recevez l&apos;essentiel de l&apos;actualité sportive. Désabonnement en un clic.
            </p>
            <FooterNewsletterForm />
          </section>
        </div>

        {/* Rangée 2, à gauche : frise (à hauteur du menu) et copyright (à
            hauteur des mentions). En dernier sur mobile. */}
        <div className="order-last lg:order-none">
          <div className="flex h-[21px] items-center">
            <div aria-hidden="true" className="footer-pattern w-full" />
          </div>
          <p className="mt-2.5 text-[13px] text-muted-foreground">
            © {new Date().getFullYear()} {SITE_NAME} — l&apos;actualité sportive en continu.
          </p>
        </div>

        {/* Rangée 2, à droite : menu et mentions. */}
        <div className="min-w-0">
          <nav aria-label="Liens du pied de page">
            <ul className="footer-menu flex flex-wrap items-center gap-y-2">
              {FOOTER_LINKS.map((link) => (
                <li key={link.href} className="flex items-center">
                  <Link href={link.href} className="text-[13px] font-semibold uppercase text-foreground transition-colors hover:text-editorial-link">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <p className="mt-2.5 text-[13px] text-muted-foreground">
            Aucune donnée personnelle n&apos;est revendue ; mesure d&apos;audience sans cookie tiers.{" "}
            <Link href="/mentions-legales" className="underline hover:text-foreground">Mentions légales</Link>
            {" · "}
            <Link href="/confidentialite" className="underline hover:text-foreground">Politique de confidentialité</Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
