import Link from "next/link";
export function PlayerHeader({ player }: { player: { name: string; position: string | null; team: { name: string; slug: string } } }) {
  return <header className="border-b border-border pb-8"><h1 className="text-3xl font-black text-foreground md:text-4xl">{player.name}</h1><p className="mt-3 text-muted-foreground">Club : <Link href={`/club/${player.team.slug}`} className="font-semibold text-editorial-link hover:underline">{player.team.name}</Link></p>{player.position && <p className="mt-2 text-sm text-muted-foreground">{player.position}</p>}</header>;
}
