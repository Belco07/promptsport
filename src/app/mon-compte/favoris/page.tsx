import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { FavoriteCompetitions } from "@/components/FavoriteCompetitions";
export const metadata = { title: "Mes favoris" };
export default async function FavoritesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return <main id="contenu" className="py-10"><h1 className="text-3xl font-black">Mes favoris</h1><FavoriteCompetitions userId={session.user.id} /></main>;
}
