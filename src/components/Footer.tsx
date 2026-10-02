import { Rss } from "lucide-react";
import Link from "next/link";

import { SITE_DESCRIPTION, SITE_NAME, SOCIAL_LINKS } from "@/lib/seo";

/**
 * Pied de page du site public (refonte WP9).
 *
 * Trois colonnes : Navigation, À propos (avec les pages légales) et
 * Suivez-nous (flux RSS et réseaux déclarés dans src/lib/seo.ts). Le bloc est
 * pleine largeur et sur fond bleu profond : il ferme la page et se distingue
 * nettement du contenu.
 *
 * Le copyright utilise l'année du rendu : les pages publiques sont régénérées
 * (ISR), la date reste donc juste sans code client.
 */

/** Libellés lisibles des réseaux sociaux déclarés (URL → nom). */
function socialLabel(url: string): string {
  if (url.includes("twitter.com") || url.includes("x.com")) return "X (Twitter)";
  if (url.includes("facebook.com")) return "Facebook";
  if (url.includes("instagram.com")) return "Instagram";
  if (url.includes("youtube.com")) return "YouTube";
  return new URL(url).hostname.replace(/^www\./, "");
}

export function Footer() {
  return (
    <footer className="mt-16 border-t-4 border-t-brand-500 bg-ink-900 text-neutral-300">
      <div className="mx-auto max-w-6xl px-4 py-12">
        <div className="flex flex-col gap-2 border-b border-white/10 pb-8">
          <p className="text-lg font-extrabold tracking-tight text-white">{SITE_NAME}</p>
          <p className="max-w-xl text-sm text-neutral-400">{SITE_DESCRIPTION}</p>
        </div>

        <div className="grid gap-8 pt-8 sm:grid-cols-2 lg:grid-cols-3">
          <nav aria-labelledby="pied-navigation">
            <h2
              id="pied-navigation"
              className="text-xs font-bold uppercase tracking-wider text-white"
            >
              Navigation
            </h2>
            <ul className="mt-4 flex flex-col gap-2.5 text-sm">
              <li>
                <Link href="/" className="transition-colors hover:text-brand-300">
                  Accueil
                </Link>
              </li>
              <li>
                <Link href="/scores" className="transition-colors hover:text-brand-300">
                  Scores et résultats
                </Link>
              </li>
              <li>
                <Link href="/abonnement" className="transition-colors hover:text-brand-300">
                  Abonnement
                </Link>
              </li>
              <li>
                <Link href="/newsletter" className="transition-colors hover:text-brand-300">
                  Newsletter
                </Link>
              </li>
              <li>
                <Link href="/mon-compte" className="transition-colors hover:text-brand-300">
                  Mon compte
                </Link>
              </li>
            </ul>
          </nav>

          <div>
            <h2
              id="pied-a-propos"
              className="text-xs font-bold uppercase tracking-wider text-white"
            >
              À propos
            </h2>
            <ul className="mt-4 flex flex-col gap-2.5 text-sm">
              <li>
                <Link
                  href="/mentions-legales"
                  className="transition-colors hover:text-brand-300"
                >
                  Mentions légales
                </Link>
              </li>
              <li>
                <Link
                  href="/confidentialite"
                  className="transition-colors hover:text-brand-300"
                >
                  Politique de confidentialité
                </Link>
              </li>
            </ul>
            <p className="mt-4 text-xs text-neutral-400">
              Aucune donnée personnelle n&apos;est revendue. Mesure d&apos;audience sans cookie
              tiers.
            </p>
          </div>

          <div>
            <h2 id="pied-suivez" className="text-xs font-bold uppercase tracking-wider text-white">
              Suivez-nous
            </h2>
            <ul className="mt-4 flex flex-col gap-2.5 text-sm">
              <li>
                <a
                  href="/rss.xml"
                  type="application/rss+xml"
                  className="inline-flex items-center gap-2 transition-colors hover:text-brand-300"
                >
                  <Rss aria-hidden="true" className="h-4 w-4" />
                  Flux RSS
                </a>
              </li>
              {SOCIAL_LINKS.map((url) => (
                <li key={url}>
                  <a
                    href={url}
                    rel="me noopener noreferrer"
                    target="_blank"
                    className="transition-colors hover:text-brand-300"
                  >
                    {socialLabel(url)}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-5 text-xs text-neutral-400 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {SITE_NAME} — l&apos;actualité sportive en continu.
          </p>
          <p>Site de démonstration : les contenus et les scores sont fictifs.</p>
        </div>
      </div>
    </footer>
  );
}

