"use server";
import { auth } from "@/lib/auth";
import { canAccessStudio } from "@/lib/roles";

async function authorized() {
  const session = await auth();
  if (!session?.user?.id || !canAccessStudio(session.user.role)) throw Error("Accès Studio requis.");
  if (!process.env.UNSPLASH_ACCESS_KEY) throw Error("Unsplash n’est pas configuré.");
}
export async function searchComposerImages(query: string) {
  await authorized();
  if (typeof query !== "string" || query.trim().length < 2 || query.length > 100) return [];
  const url = new URL("https://api.unsplash.com/search/photos");
  url.searchParams.set("query", query.trim()); url.searchParams.set("per_page", "12");
  const response = await fetch(url, { headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` }, signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (!response.ok) throw Error("Recherche Unsplash indisponible. Réessayez plus tard.");
  const data = await response.json();
  return (data.results ?? []).map((photo: { id: string; urls: { small: string; regular: string }; user: { name: string; links: { html: string } } }) => ({ id: photo.id, preview: photo.urls.small, url: photo.urls.regular, author: photo.user.name, authorUrl: photo.user.links.html }));
}
export async function trackComposerImage(id: string) {
  await authorized();
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw Error("Photo invalide.");
  const response = await fetch(`https://api.unsplash.com/photos/${id}/download`, { headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` }, signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (!response.ok) throw Error("Import Unsplash indisponible.");
}
