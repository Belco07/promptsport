import Image from "next/image";
import Link from "next/link";
import { FollowPill } from "@/components/ui/FollowPill";
import { teamLogoSource } from "@/components/MatchCard";

/**
 * En-tête de club refondu (WP34).
 *
 * Logo géant à gauche, nom en police d'affichage (Sora) et pastille de suivi
 * `FollowPill` à droite. La couleur d'accent de la compétition peut être
 * utilisée pour le bord supérieur quand elle est fournie.
 */
export function ClubHeader({
  club,
  competitions,
  signedIn,
  following,
  accentColor,
}: {
  club: { id: string; name: string; slug: string; logoUrl: string | null; country: string | null };
  competitions: { slug: string; name: string }[];
  signedIn: boolean;
  following: boolean;
  accentColor?: string;
}) {
  return (
    <header
      className={`flex flex-wrap items-start gap-6 border-b border-border pb-8 ${accentColor ? `border-t-2 border-t-[#${accentColor}]` : ""} pt-4`}
    >
      {club.logoUrl ? (
        <Image
          src={teamLogoSource(club.logoUrl)}
          alt=""
          width={120}
          height={120}
          className="h-24 w-24 shrink-0 rounded-2xl object-contain border border-border bg-card shadow-md"
        />
      ) : (
        <div className="h-24 w-24 shrink-0 items-center justify-center rounded-2xl bg-muted text-4xl font-bold text-muted-foreground flex">
          {club.name[0]}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="text-4xl font-black text-foreground md:text-5xl tracking-tight">{club.name}</h1>
        {club.country && <p className="mt-2 text-sm text-muted-foreground">{club.country}</p>}
        {!!competitions.length && (
          <ul aria-label="Compétitions du club" className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {competitions.map((competition) => (
              <li key={competition.slug}>
                <Link href={`/competition/${competition.slug}`} className="font-semibold text-editorial-link hover:underline">
                  {competition.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="shrink-0 flex flex-col items-end gap-2">
        <FollowPill
          id={club.id}
          kind="team"
          name={club.name}
          logoUrl={club.logoUrl}
          slug={club.slug}
          following={following}
          signedIn={signedIn}
        />
      </div>
    </header>
  );
}
