import ScoresPage from "@/app/scores/page";
import { buildPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const metadata = buildPageMetadata({ title: "Matchs en direct", description: "Les matchs en cours : scores, événements et fiches matchs.", path: "/live" });

export default async function LivePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <ScoresPage searchParams={Promise.resolve({ ...await searchParams, view: "live" })}/>;
}
