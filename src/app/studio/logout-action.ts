"use server";

import { signOut } from "@/lib/auth";

/**
 * Déconnexion depuis la barre latérale (studio et backoffice).
 */
export async function logout(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
