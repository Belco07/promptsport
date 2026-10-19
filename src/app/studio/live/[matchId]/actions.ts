"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { LiveUpdateType } from "@/generated/prisma/client";

type State = { ok: boolean; message: string };

const MINUTE_MAX = 150;
const LIVE_UPDATE_TYPES = ["TEXT", "GOAL", "CARD", "SUB", "KEY_MOMENT"] as const;

async function authorized() {
  const session = await auth();
  return Boolean(
    session?.user?.id &&
      ["ADMIN", "EDITOR", "JOURNALIST"].includes(session.user.role),
  );
}

/**
 * Publie une intervention éditoriale en direct sur un match (WP38).
 * L'intervention est immédiatement visible sur la fiche match publique.
 */
export async function createLiveUpdate(
  matchId: string,
  _previous: State,
  form: FormData,
): Promise<State> {
  if (!(await authorized())) {
    return { ok: false, message: "Accès réservé à la rédaction." };
  }
  if (
    typeof matchId !== "string" ||
    !matchId ||
    matchId.length > 128
  ) {
    return { ok: false, message: "Match invalide." };
  }

  const content = String(form.get("content") ?? "").trim();
  const minuteRaw = form.get("minute");
  const minute =
    minuteRaw === null || minuteRaw === undefined || minuteRaw === ""
      ? undefined
      : Number(minuteRaw);
  const type = String(form.get("type") ?? "");

  if (!content || content.length > 500) {
    return {
      ok: false,
      message: "Le commentaire est requis (500 caractères maximum).",
    };
  }
  if (
    minute !== undefined &&
    (!Number.isFinite(minute) || minute < 0 || minute > MINUTE_MAX)
  ) {
    return { ok: false, message: "Minute invalide (0 à 150)." };
  }
  if (!LIVE_UPDATE_TYPES.includes(type as (typeof LIVE_UPDATE_TYPES)[number])) {
    return { ok: false, message: "Type d'événement invalide." };
  }

  const session = await auth();
  const authorId = session?.user?.id;
  if (!authorId) {
    return { ok: false, message: "Connexion requise." };
  }

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { id: true, status: true },
  });
  if (!match) {
    return { ok: false, message: "Match introuvable." };
  }

  await prisma.matchLiveUpdate.create({
    data: {
      matchId,
      authorId,
      content,
      ...(minute !== undefined ? { minute } : {}),
      type: type as LiveUpdateType,
    },
  });

  revalidatePath(`/studio/live/${matchId}`);
  revalidatePath(`/match/${matchId}`);
  return { ok: true, message: "Intervention publiée en direct." };
}
