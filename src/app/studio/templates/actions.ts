"use server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { lockTemplate, validateTemplate } from "@/lib/visual-template";

export async function saveVisualTemplate(name: string, raw: string) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return { ok: false as const, error: "Accès administrateur requis." };
  if (!name.trim() || name.length > 100 || raw.length > 1_000_000) return { ok: false as const, error: "Nom ou template invalide." };
  try {
    const document: unknown = JSON.parse(raw);
    if (!validateTemplate(document)) return { ok: false as const, error: "Template invalide : 150 éléments et 4096 px maximum." };
    for (const field of ["title", "subject"]) {
      if (document.objects.filter(object => object.field === field && ["textbox", "text", "i-text"].includes(object.type.toLowerCase())).length !== 1) return { ok: false as const, error: "Associez une zone de texte au Titre et une autre au Sujet avant d’enregistrer." };
    }
    // A fixed active slot avoids races between two simultaneous admin saves.
    await prisma.visualTemplate.upsert({ where: { id: "active" }, create: { id: "active", name: name.trim(), document: JSON.parse(JSON.stringify(lockTemplate(document))) }, update: { name: name.trim(), document: JSON.parse(JSON.stringify(lockTemplate(document))) } });
    revalidatePath("/studio/visual-studio"); revalidatePath("/studio/templates");
    return { ok: true as const };
  } catch { return { ok: false as const, error: "Impossible d’enregistrer le template." }; }
}
