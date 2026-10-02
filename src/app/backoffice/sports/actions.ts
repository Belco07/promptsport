"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { Prisma } from "@/generated/prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveSlug } from "@/lib/slug";
import {
  syncAllCompetitions as runSyncAllCompetitions,
  syncCompetition as runSyncCompetition,
} from "@/lib/football-sync";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";
const FOREIGN_KEY_VIOLATION = "P2003";

const MATCH_STATUSES = ["SCHEDULED", "LIVE", "FINISHED", "POSTPONED", "CANCELLED"] as const;
type MatchStatus = (typeof MATCH_STATUSES)[number];

function readText(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_CONSTRAINT_VIOLATION
  );
}

function isForeignKeyError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === FOREIGN_KEY_VIOLATION
  );
}

/** Vérifie que l'appelant est ADMIN ; redirige sinon. */
async function requireAdmin() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.role !== "ADMIN") {
    redirect("/studio");
  }
  return session;
}

function isValidName(name: string): boolean {
  return name.length >= 2 && name.length <= 100;
}

function isMatchStatus(value: string): value is MatchStatus {
  return (MATCH_STATUSES as readonly string[]).includes(value);
}

function toNullableInt(value: string | null): number | null {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/* -------------------------------------------------------------------------- */
/* Synchronisation (WP6e — Football-Data.org)                                 */
/* -------------------------------------------------------------------------- */

export type SyncAllResult =
  | {
      ok: true;
      competitions: number;
      teams: number;
      matches: number;
      results: { code: string; name: string; teams: number; matches: number }[];
      errors: string[];
    }
  | { ok: false; error: string };

/** Synchronise toutes les compétitions par défaut en une seule action. */
export async function syncAllCompetitions(): Promise<SyncAllResult> {
  await requireAdmin();

  try {
    const summary = await runSyncAllCompetitions();
    revalidatePath("/backoffice/sports");
    revalidatePath("/backoffice/sports/sync");
    revalidatePath("/scores");
    revalidatePath("/competition");
    return {
      ok: true,
      competitions: summary.competitions,
      teams: summary.teams,
      matches: summary.matches,
      results: summary.results,
      errors: summary.errors,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Erreur inconnue lors de la synchronisation.",
    };
  }
}

export type SyncOneResult =
  | { ok: true; code: string; name: string; teams: number; matches: number }
  | { ok: false; error: string };

/** Synchronise une seule compétition (utile pour tester / la progression). */
export async function syncOneCompetition(code: string): Promise<SyncOneResult> {
  await requireAdmin();

  if (!code) {
    return { ok: false, error: "Code de compétition manquant." };
  }

  try {
    const detail = await runSyncCompetition(code);
    revalidatePath("/backoffice/sports");
    revalidatePath("/backoffice/sports/sync");
    revalidatePath("/scores");
    revalidatePath("/competition");
    return { ok: true, ...detail };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Erreur inconnue lors de la synchronisation.",
    };
  }
}

/* -------------------------------------------------------------------------- */
/* CRUD Compétitions                                                          */
/* -------------------------------------------------------------------------- */

type CompetitionInput = { name: string; slug: string; sport: string; country: string | null; season: string | null };

function validateCompetition(formData: FormData): CompetitionInput | { error: string } {
  const name = readText(formData, "name");
  const sport = readText(formData, "sport");
  const country = readText(formData, "country");
  const season = readText(formData, "season");

  if (!isValidName(name)) {
    return { error: "Le nom doit contenir entre 2 et 100 caractères." };
  }
  if (!sport) {
    return { error: "Le sport est obligatoire." };
  }
  const slug = resolveSlug(readText(formData, "slug"), name);
  if (!slug) {
    return { error: "Impossible de générer un slug : saisissez-en un manuellement." };
  }
  return { name, slug, sport, country: country || null, season: season || null };
}

export async function createCompetition(
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  await requireAdmin();
  const result = validateCompetition(formData);
  if ("error" in result) return result.error;

  try {
    await prisma.competition.create({ data: result });
  } catch (error) {
    if (isUniqueConstraintError(error)) return "Une compétition avec ce slug existe déjà.";
    throw error;
  }
  revalidatePath("/backoffice/sports");
  revalidatePath("/competition");
  redirect("/backoffice/sports/competitions");
}

export async function updateCompetition(
  id: string,
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  await requireAdmin();
  const result = validateCompetition(formData);
  if ("error" in result) return result.error;

  try {
    await prisma.competition.update({ where: { id }, data: result });
  } catch (error) {
    if (isUniqueConstraintError(error)) return "Une compétition avec ce slug existe déjà.";
    throw error;
  }
  revalidatePath("/backoffice/sports");
  revalidatePath("/competition");
  redirect("/backoffice/sports/competitions");
}

export async function deleteCompetition(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const id = readText(formData, "id");
  if (!id) return { ok: false, error: "Compétition introuvable." };
  try {
    await prisma.competition.delete({ where: { id } });
  } catch (error) {
    if (isForeignKeyError(error)) {
      return { ok: false, error: "Impossible de supprimer cette compétition : des matchs y sont associés." };
    }
    throw error;
  }
  revalidatePath("/backoffice/sports");
  revalidatePath("/competition");
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* CRUD Équipes                                                               */
/* -------------------------------------------------------------------------- */

type TeamInput = { name: string; slug: string; shortName: string | null; sport: string; country: string | null; logoUrl: string | null };

function validateTeam(formData: FormData): TeamInput | { error: string } {
  const name = readText(formData, "name");
  const sport = readText(formData, "sport");
  const shortName = readText(formData, "shortName");
  const country = readText(formData, "country");
  const logoUrl = readText(formData, "logoUrl");

  if (!isValidName(name)) {
    return { error: "Le nom doit contenir entre 2 et 100 caractères." };
  }
  if (!sport) {
    return { error: "Le sport est obligatoire." };
  }
  const slug = resolveSlug(readText(formData, "slug"), name);
  if (!slug) {
    return { error: "Impossible de générer un slug : saisissez-en un manuellement." };
  }
  return { name, slug, shortName: shortName || null, sport, country: country || null, logoUrl: logoUrl || null };
}

export async function createTeam(
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  await requireAdmin();
  const result = validateTeam(formData);
  if ("error" in result) return result.error;

  try {
    await prisma.team.create({ data: result });
  } catch (error) {
    if (isUniqueConstraintError(error)) return "Une équipe avec ce slug existe déjà.";
    throw error;
  }
  revalidatePath("/backoffice/sports");
  redirect("/backoffice/sports/teams");
}

export async function updateTeam(
  id: string,
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  await requireAdmin();
  const result = validateTeam(formData);
  if ("error" in result) return result.error;

  try {
    await prisma.team.update({ where: { id }, data: result });
  } catch (error) {
    if (isUniqueConstraintError(error)) return "Une équipe avec ce slug existe déjà.";
    throw error;
  }
  revalidatePath("/backoffice/sports");
  redirect("/backoffice/sports/teams");
}

export async function deleteTeam(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const id = readText(formData, "id");
  if (!id) return { ok: false, error: "Équipe introuvable." };
  try {
    await prisma.team.delete({ where: { id } });
  } catch (error) {
    if (isForeignKeyError(error)) {
      return { ok: false, error: "Impossible de supprimer cette équipe : des matchs y sont associés." };
    }
    throw error;
  }
  revalidatePath("/backoffice/sports");
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* CRUD Matchs                                                                */
/* -------------------------------------------------------------------------- */

type MatchInput = {
  competitionId: string;
  homeTeamId: string;
  awayTeamId: string;
  scheduledAt: Date;
  status: MatchStatus;
  homeScore: number | null;
  awayScore: number | null;
  venue: string | null;
};

function validateMatch(formData: FormData): MatchInput | { error: string } {
  const competitionId = readText(formData, "competitionId");
  const homeTeamId = readText(formData, "homeTeamId");
  const awayTeamId = readText(formData, "awayTeamId");
  const scheduledAtRaw = readText(formData, "scheduledAt");
  const statusRaw = readText(formData, "status");
  const venue = readText(formData, "venue");

  if (!competitionId) return { error: "La compétition est obligatoire." };
  if (!homeTeamId || !awayTeamId) return { error: "Les deux équipes sont obligatoires." };
  if (homeTeamId === awayTeamId) return { error: "Les deux équipes doivent être différentes." };
  if (!scheduledAtRaw) return { error: "La date est obligatoire." };

  const scheduledAt = new Date(scheduledAtRaw);
  if (Number.isNaN(scheduledAt.getTime())) return { error: "La date est invalide." };

  if (!isMatchStatus(statusRaw)) return { error: "Statut invalide." };

  const homeScore = toNullableInt(readText(formData, "homeScore"));
  const awayScore = toNullableInt(readText(formData, "awayScore"));

  if (statusRaw === "FINISHED" && (homeScore == null || awayScore == null)) {
    return { error: "Un match terminé doit avoir un score renseigné." };
  }

  return {
    competitionId,
    homeTeamId,
    awayTeamId,
    scheduledAt,
    status: statusRaw,
    homeScore,
    awayScore,
    venue: venue || null,
  };
}

export async function createMatch(
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  await requireAdmin();
  const result = validateMatch(formData);
  if ("error" in result) return result.error;

  try {
    await prisma.match.create({ data: result });
  } catch (error) {
    if (isForeignKeyError(error)) return "La compétition ou une équipe référencée n'existe pas.";
    throw error;
  }
  revalidatePath("/backoffice/sports");
  revalidatePath("/scores");
  revalidatePath("/competition");
  redirect("/backoffice/sports/matches");
}

export async function updateMatch(
  id: string,
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  await requireAdmin();
  const result = validateMatch(formData);
  if ("error" in result) return result.error;

  try {
    await prisma.match.update({ where: { id }, data: result });
  } catch (error) {
    if (isForeignKeyError(error)) return "La compétition ou une équipe référencée n'existe pas.";
    throw error;
  }
  revalidatePath("/backoffice/sports");
  revalidatePath("/scores");
  revalidatePath("/competition");
  redirect("/backoffice/sports/matches");
}

export async function deleteMatch(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const id = readText(formData, "id");
  if (!id) return { ok: false, error: "Match introuvable." };
  await prisma.match.delete({ where: { id } });
  revalidatePath("/backoffice/sports");
  revalidatePath("/scores");
  revalidatePath("/competition");
  return { ok: true };
}
