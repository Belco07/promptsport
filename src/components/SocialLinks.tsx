import { FacebookLogo, InstagramLogo, TiktokLogo, XLogo, YoutubeLogo } from "@phosphor-icons/react/ssr";
import { Rss } from "@/components/icons";

/**
 * Icônes « Suivez-nous », partagées par le pied de page et le menu mobile.
 *
 * Comptes du site : YouTube, Instagram, TikTok, Facebook et X. Leurs adresses ne sont pas
 * encore connues : les icônes sont affichées sans lien (`url: null`). Il suffira
 * de renseigner `url` ici pour qu'elles deviennent cliquables. Le flux RSS, lui,
 * pointe déjà vers /rss.xml.
 *
 * Fonctionne côté serveur comme côté client (icônes Phosphor `/ssr`).
 */
const ACCOUNTS: { label: string; Icon: typeof YoutubeLogo; url: string | null }[] = [
  { label: "YouTube", Icon: YoutubeLogo, url: null },
  { label: "Instagram", Icon: InstagramLogo, url: null },
  { label: "TikTok", Icon: TiktokLogo, url: null },
  { label: "Facebook", Icon: FacebookLogo, url: null },
  { label: "X (Twitter)", Icon: XLogo, url: null },
];

const ICON = "flex h-[30px] w-[30px] items-center justify-center text-foreground";

export function SocialLinks({ labelledBy, className = "", showRss = true }: { labelledBy?: string; className?: string; /** En-tête : réseaux seuls, sans le flux RSS. */ showRss?: boolean }) {
  return (
    <ul aria-labelledby={labelledBy} className={`flex flex-wrap items-center gap-1 ${className}`}>
      {showRss && <li>
        <a href="/rss.xml" type="application/rss+xml" aria-label="Flux RSS" title="Flux RSS" className={`${ICON} transition-colors hover:text-editorial-link`}>
          <Rss aria-hidden="true" className="h-5 w-5" />
        </a>
      </li>}
      {ACCOUNTS.map(({ label, Icon, url }) => (
        <li key={label}>
          {url ? (
            <a href={url} rel="me noopener noreferrer" target="_blank" aria-label={label} title={label} className={`${ICON} transition-colors hover:text-editorial-link`}>
              <Icon aria-hidden="true" size={20} />
            </a>
          ) : (
            <span role="img" aria-label={label} title={label} className={ICON}>
              <Icon aria-hidden="true" size={20} />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
