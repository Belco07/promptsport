import Image from "next/image";
import Link from "next/link";
import { FollowButton } from "@/components/FollowButton";
import { teamLogoSource } from "@/components/MatchCard";

export function ClubHeader({ club, competitions, signedIn, following }: {
  club: { id: string; name: string; logoUrl: string | null; country: string | null };
  competitions: { slug: string; name: string }[];
  signedIn: boolean; following: boolean;
}) {
  return <header className="flex flex-wrap items-center gap-6 border-b border-border pb-8">
    {club.logoUrl ? <Image src={teamLogoSource(club.logoUrl)} alt="" width={96} height={96} className="h-20 w-20 object-contain md:h-24 md:w-24"/> : <span aria-hidden="true" className="flex h-20 w-20 items-center justify-center rounded-full bg-muted text-3xl font-bold">{club.name[0]}</span>}
    <div className="min-w-0 flex-1"><h1 className="text-3xl font-black text-foreground md:text-4xl">{club.name}</h1>
      {club.country && <p className="mt-2 text-sm text-muted-foreground">{club.country}</p>}
      {!!competitions.length && <ul aria-label="Compétitions du club" className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">{competitions.map(competition => <li key={competition.slug}><Link href={`/competition/${competition.slug}`} className="font-semibold text-editorial-link hover:underline">{competition.name}</Link></li>)}</ul>}
    </div>
    {signedIn && <FollowButton id={club.id} kind="team" name={club.name} following={following} signedIn/>}
  </header>;
}
