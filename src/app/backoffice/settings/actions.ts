"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SITE_CONFIG_ID, SITE_CONFIG_TAG } from "@/lib/site-config";

/**
 * Server Action des paramètres globaux (WP43).
 *
 * La vérification du rôle est refaite ici : une Server Action est un point
 * d'entrée HTTP à part entière, indépendant du layout du backoffice.
 */

const SETTINGS_PATH = "/backoffice/settings";
const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 300;

function readText(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

/** Case décochée : absente du FormData. */
function readCheckbox(formData: FormData, field: string): boolean {
  const value = formData.get(field);
  if (typeof value !== "string") return false;
  return !["", "false", "off", "0"].includes(value.toLowerCase());
}

function settingsUrl(params: { saved?: boolean; error?: string } = {}): string {
  const search = new URLSearchParams();
  if (params.saved) search.set("saved", "1");
  if (params.error) search.set("error", params.error.slice(0, 300));
  const query = search.toString();
  return `${SETTINGS_PATH}${query ? `?${query}` : ""}`;
}

async function requireAdmin(): Promise<void> {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/studio");
}

/** Enregistre la configuration globale puis invalide les métadonnées. */
export async function updateSiteConfig(formData: FormData): Promise<void> {
  await requireAdmin();

  const siteName = readText(formData, "siteName");
  const siteDescription = readText(formData, "siteDescription");
  const maintenanceMode = readCheckbox(formData, "maintenanceMode");

  if (siteName.length < 2) {
    redirect(settingsUrl({ error: "Le nom du site doit contenir au moins 2 caractères." }));
  }
  if (siteName.length > MAX_NAME_LENGTH) {
    redirect(
      settingsUrl({
        error: `Le nom du site ne peut pas dépasser ${MAX_NAME_LENGTH} caractères.`,
      }),
    );
  }
  if (siteDescription.length < 10) {
    redirect(
      settingsUrl({
        error: "La description SEO doit contenir au moins 10 caractères.",
      }),
    );
  }
  if (siteDescription.length > MAX_DESCRIPTION_LENGTH) {
    redirect(
      settingsUrl({
        error: `La description SEO ne peut pas dépasser ${MAX_DESCRIPTION_LENGTH} caractères.`,
      }),
    );
  }

  let saved = false;
  try {
    await prisma.siteConfig.upsert({
      where: { id: SITE_CONFIG_ID },
      create: {
        id: SITE_CONFIG_ID,
        siteName,
        siteDescription,
        maintenanceMode,
      },
      update: {
        siteName,
        siteDescription,
        maintenanceMode,
      },
    });
    saved = true;
  } catch (error) {
    console.error(
      "[settings] enregistrement impossible :",
      error instanceof Error ? error.message : error,
    );
  }

  if (!saved) {
    redirect(settingsUrl({ error: "L'enregistrement a échoué. Réessayez." }));
  }

  revalidateTag(SITE_CONFIG_TAG);
  revalidatePath(SETTINGS_PATH);
  revalidatePath("/", "layout");
  redirect(settingsUrl({ saved: true }));
}
