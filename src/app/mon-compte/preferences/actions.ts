"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { Prisma } from "@/generated/prisma/client";
import { auth } from "@/lib/auth";
import { EMAIL_NOTIFICATION_TYPES, isEmailNotificationType } from "@/lib/notification-email";
import { prisma } from "@/lib/prisma";

/**
 * Server Action des préférences de notification (WP11e).
 *
 * Le compte est modifié **uniquement** pour l'utilisateur de la session : ni le
 * formulaire ni l'URL ne transportent d'identifiant de compte, ce qui rend
 * impossible l'écriture dans les préférences d'un tiers.
 *
 * Convention de stockage : `emailNotificationTypes` contient les types
 * **désactivés** (brief WP11e). Une case décochée y entre, une case cochée en
 * sort ; la liste vide est enregistrée à `null`, qui signifie « tout activé ».
 */

const PREFERENCES_PATH = "/mon-compte/preferences";

export async function updateNotificationPreferences(
  _previousState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const enabled = formData.get("emailNotificationsEnabled") === "on";
  const checked = formData
    .getAll("types")
    .filter((value): value is string => typeof value === "string" && isEmailNotificationType(value));

  // Un type non coché est un type désactivé.
  const disabled = EMAIL_NOTIFICATION_TYPES.filter((type) => !checked.includes(type));

  try {
    await prisma.author.update({
      where: { id: session.user.id },
      data: {
        emailNotificationsEnabled: enabled,
        // `Prisma.DbNull` écrit un vrai NULL SQL (« aucun type désactivé ») ;
        // un `null` JavaScript serait refusé par Prisma sur un champ Json.
        emailNotificationTypes: disabled.length > 0 ? disabled : Prisma.DbNull,
      },
    });
  } catch (error) {
    console.warn(
      "[preferences] enregistrement impossible :",
      error instanceof Error ? error.message : error,
    );
    return "Vos préférences n'ont pas pu être enregistrées. Merci de réessayer.";
  }

  revalidatePath(PREFERENCES_PATH);
  revalidatePath("/mon-compte");
  redirect(`${PREFERENCES_PATH}?enregistre=1`);
}
