"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Actions de l'espace notifications (WP10d).
 *
 * Chaque action ne touche que les notifications de la personne connectée : le
 * filtre `userId` de la session est toujours appliqué, y compris sur les mises à
 * jour groupées.
 */

const NOTIFICATIONS_PATH = "/mon-compte/notifications";

/** Marque une notification comme lue (la sienne uniquement). */
export async function markAsRead(notificationId: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  await prisma.notification.updateMany({
    where: { id: notificationId, userId: session.user.id },
    data: { read: true, readAt: new Date() },
  });

  revalidatePath(NOTIFICATIONS_PATH);
  revalidatePath("/mon-compte");
}

/** Marque toutes les notifications non lues de la personne connectée. */
export async function markAllAsRead(): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  await prisma.notification.updateMany({
    where: { userId: session.user.id, read: false },
    data: { read: true, readAt: new Date() },
  });

  revalidatePath(NOTIFICATIONS_PATH);
  revalidatePath("/mon-compte");
}

/**
 * Nombre de notifications non lues, pour le badge du menu utilisateur.
 *
 * Appelée par le composant client à chaque navigation (aucun temps réel : ni
 * WebSocket, ni polling).
 */
export async function unreadNotificationCount(): Promise<number> {
  const session = await auth();
  if (!session?.user?.id) {
    return 0;
  }

  return prisma.notification.count({
    where: { userId: session.user.id, read: false },
  });
}
