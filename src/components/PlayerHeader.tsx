import Link from "next/link";
import { EntityLogo } from "@/components/EntityLogo";
export function PlayerHeader({ player }: { player: { name: string; position: string | null; team: { name: string; slug: string; logoUrl?: string | null } } }) {
  return <header className="border-b border-border pb-8"><h1 className="text-3xl font-black text-foreground md:text-4xl">{player.name}</h1><p className="mt-3 text-muted-foreground">Club : <Link href={`/club/${player.team.slug}`} className="inline-flex items-center gap-2 align-middle font-semibold text-editorial-link hover:underline"><EntityLogo kind="team" name={player.team.name} logoUrl={player.team.logoUrl} slug={player.team.slug} size={24} />{player.team.name}</Link></p>{player.position && <p className="mt-2 text-sm text-muted-foreground">{player.position}</p>}</header>;
}
