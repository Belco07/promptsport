import Image from "next/image";
import type { ReactNode } from "react";
import { Trophy } from "lucide-react";

const logos: Record<string, string> = {
  "ligue-1": "FL1",
  "premier-league": "PL",
  liga: "PD",
  "serie-a": "SA",
  bundesliga: "BL1",
  "uefa-champions-league": "CL",
};

/**
 * En-tête de compétition refondu (WP34).
 *
 * Logo à gauche, nom en police d'affichage (Sora), et la couleur d'accent de
 * la compétition appliquée sur le bord supérieur et le libellé du sport.
 * L'action (bouton Follow) est passée en prop `action`.
 */
export function CompetitionHeader({
  competition: c,
  action,
  accentColor,
}: {
  competition: {
    name: string;
    slug: string;
    country: string | null;
    season: string | null;
    sport: string;
    color?: string | null;
  };
  action?: ReactNode;
  accentColor?: string;
}) {
  const color = accentColor ?? c.color;
  return (
    <header
      className={`mb-7 flex items-start gap-5 border-b border-border pb-7 ${color ? `border-t-2 border-t-[#${color}] pt-4` : ""}`}
    >
      <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-background dark:bg-foreground">
        {logos[c.slug] ? (
          <Image
            src={`https://crests.football-data.org/${logos[c.slug]}.png`}
            alt=""
            width={72}
            height={72}
            loading="lazy"
            className="h-16 w-16 object-contain"
          />
        ) : (
          <Trophy aria-hidden="true" className="text-muted-foreground" size={40} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={`text-xs font-bold uppercase tracking-wider ${color ? `text-[#${color}]` : "text-editorial-link"}`}
        >
          {c.sport}{c.season ? ` · Saison ${c.season}` : ""}
        </p>
        <div className="my-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <h1 className={`min-w-0 break-words text-4xl font-black text-foreground md:text-5xl tracking-tight`}>
            {c.name}
          </h1>
          {action && <div className="ml-auto shrink-0">{action}</div>}
        </div>
        {c.country && <p className="text-sm text-muted-foreground">{c.country}</p>}
      </div>
    </header>
  );
}
