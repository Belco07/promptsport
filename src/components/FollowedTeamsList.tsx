import Link from "next/link";
import { EntityLogo } from "@/components/EntityLogo";
import { FollowButton } from "@/components/FollowButton";
import { getReaderFollows } from "@/lib/follows";

export async function FollowedTeamsList({ userId }: { userId: string }) {
  const follows = await getReaderFollows(userId);
  return <section className="mt-12 border-t border-border pt-8" aria-labelledby="followed-clubs">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="followed-clubs" className="text-xl font-bold">Mes clubs suivis</h2>
      <Link href="/mon-sport#decouvrir" className="font-semibold text-editorial-link hover:underline">Ajouter des clubs</Link>
    </div>
    {follows?.followedTeams.length ? <ul className="mt-4 divide-y divide-border">
      {follows.followedTeams.map(team => <li key={team.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <Link href={`/club/${team.slug}`} className="flex items-center gap-3 font-semibold hover:underline"><EntityLogo kind="team" name={team.name} logoUrl={team.logoUrl} slug={team.slug} size={32} />{team.name}</Link>
        <FollowButton id={team.id} kind="team" name={team.name} following signedIn unfollowLabel />
      </li>)}
    </ul> : <p className="mt-4 text-muted-foreground">Vous ne suivez encore aucun club.</p>}
    <Link href="/mon-sport" className="mt-5 inline-block font-semibold text-editorial-link hover:underline">Ouvrir Mon Sport →</Link>
  </section>;
}
