import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Star, Newspaper, CalendarDays } from "@/components/icons";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { completeWelcome } from "./actions";

export const metadata = { title: "Bienvenue sur PromptSport" };
export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ etape?: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const user = await prisma.author.findUniqueOrThrow({ where: { id: session.user.id }, select: { welcomeCompleted: true, favoriteCompetitions: true } });
  const preferences = (await searchParams).etape === "preferences";
  if (user.welcomeCompleted && !preferences) redirect("/mon-compte");
  const competitions = preferences ? await prisma.competition.findMany({ orderBy: { name: "asc" }, select: { slug: true, name: true } }) : [];
  return <div className="public-site flex min-h-screen flex-col bg-background text-foreground">
    <header className="bg-foreground px-6 py-7 dark:bg-background"><Link href="/" aria-label="PromptSport — accueil"><Image src="/promptsport-logo-night.png" alt="PromptSport" width={4739} height={1044} priority className="h-auto w-44" /></Link></header>
    <main id="contenu" className="mx-auto my-auto w-full max-w-[1280px] px-5 py-14 text-center md:px-8">
      <h1 className="text-3xl font-black">{preferences ? "Vos compétitions préférées" : "Bienvenue sur PromptSport"}</h1>
      <p className="mt-4 text-xl font-bold">{preferences ? "Choisissez celles que vous souhaitez retrouver facilement" : "Votre actualité sportive, à votre rythme"}</p>
      {preferences ? <form action={completeWelcome} className="mt-10"><div className="grid gap-3 text-left sm:grid-cols-2 lg:grid-cols-3">{competitions.map(c => <label key={c.slug} className="flex cursor-pointer items-center gap-3 border border-border bg-muted p-5"><input type="checkbox" name="competition" value={c.slug} defaultChecked={user.favoriteCompetitions.includes(c.slug)} className="h-5 w-5" />{c.name}</label>)}</div><button name="intent" value="save" className="mt-8 min-h-14 bg-primary px-10 py-4 font-bold uppercase text-primary-foreground">Enregistrer mes préférences</button></form> : <>
        <p className="mt-4 text-muted-foreground">Retrouvez vos compétitions préférées et profitez de votre espace personnel.</p>
        <div className="my-8 grid gap-4 border-y border-accent py-6 text-left md:grid-cols-3">{[
          { Icon: Star, title: "Ajoutez vos favoris", text: "Enregistrez vos compétitions pour y accéder depuis votre compte." },
          { Icon: Newspaper, title: "Retrouvez vos articles", text: "Sauvegardez vos lectures et participez aux discussions." },
          { Icon: CalendarDays, title: "Calendrier et résultats", text: "Consultez les matchs, résultats et classements de vos compétitions." },
        ].map(({ Icon, title, text }) => <div key={title} className="flex gap-4 rounded bg-muted p-6"><Icon className="mt-1 shrink-0" /><div><h2 className="text-sm font-extrabold uppercase">{title}</h2><p className="mt-2 text-sm leading-6">{text}</p></div></div>)}</div>
        <Link href="/bienvenue?etape=preferences" className="mx-auto block max-w-md bg-primary px-8 py-4 text-lg font-bold uppercase text-primary-foreground">Personnaliser</Link>
        <form action={completeWelcome}><button name="intent" value="skip" className="mx-auto mt-4 block w-full max-w-md border-2 border-foreground px-8 py-4 text-lg font-bold uppercase">Peut-être plus tard</button></form>
      </>}
    </main>
  </div>;
}
