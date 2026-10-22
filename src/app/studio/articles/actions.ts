"use server";
import { canAccessStudio } from "@/lib/roles";

import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { generateArticleSocialPosts } from "@/lib/distribution";

import { Prisma } from "@/generated/prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notifyArticleFollowers } from "@/lib/notifications";
import { resolveSlug } from "@/lib/slug";
import { isArticleStatus, type ArticleStatus } from "@/lib/articleStatus";
import {
  canDeleteArticle,
  canEditArticle,
  canPublish,
  canSetPremium,
  canTransitionArticle,
} from "@/lib/roles";

/**
 * Server Actions du CRUD articles (WP2c).
 *
 * Toutes les mutations passent par ici : aucune route handler API.
 * Validation faite côté serveur, y compris l'unicité du slug (contrainte
 * de base de données) et l'auteur, qui provient toujours de la session.
 */

/** Code Prisma d'une violation de contrainte d'unicité. */
const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

/**
 * Invalide les pages publiques prérendues qui dépendent des articles publiés.
 *
 * L'accueil est prérendu avec `revalidate = 60` (WP8c), le sitemap avec 1 h et
 * le flux RSS avec 15 min. Sans cet appel, une publication, une dépublication ou
 * un changement de diffusion n'apparaîtrait qu'à l'expiration de la fenêtre — et
 * ISR servirait une première fois l'ancienne version. Les pages d'article, de
 * rubrique et d'auteur, elles, sont rendues à la demande : inutile de les
 * invalider.
 *
 * Le passage par le sélecteur de statut le faisait déjà ; les créations,
 * modifications et suppressions d'articles publiés ne le faisaient pas.
 */
function revalidatePublicSurfaces(): void {
  revalidatePath("/");
  revalidatePath("/sitemap.xml");
  revalidatePath("/rss.xml");
}

function scheduleSocialPosts(articleId: string): void {
  after(async () => {
    try {
      await generateArticleSocialPosts(articleId);
      revalidatePath(`/studio/articles/${articleId}/edit`);
    } catch {
      console.error("[distribution] Génération indisponible ; l'article reste publié.");
    }
  });
}

/** Vrai si l'erreur est une violation d'unicité Prisma (slug déjà pris). */
function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_CONSTRAINT_VIOLATION
  );
}

/** Lecture d'un champ texte du FormData. */
function readText(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Lecture d'une case à cocher : absente du FormData quand elle est décochée.
 * Les valeurs « false »/« off »/vide sont traitées comme décochées au cas où le
 * formulaire serait soumis par un autre client.
 */
function readCheckbox(formData: FormData, field: string): boolean {
  const value = formData.get(field);
  if (value === null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized !== "" && normalized !== "false" && normalized !== "off" && normalized !== "0";
}

type ArticleInput = {
  matchId: string | null;
  format: "FLASH" | "NEWS" | "ANALYSIS";
  title: string;
  slug: string;
  content: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  categoryId: string;
  status: ArticleStatus;
  isPremium: boolean;
  /** Thèmes éditoriaux associés (WP16b). */
  themeIds: string[];
};

/** Nombre maximal de thèmes par article (garde-fou sur le champ caché). */
const MAX_ARTICLE_THEMES = 20;

/**
 * Lecture du champ caché `themeIds` produit par le sélecteur (WP16b).
 *
 * Le champ contient un tableau JSON d'identifiants. Une valeur illisible ou
 * forgée ne fait pas échouer l'enregistrement : elle est simplement ignorée,
 * et les identifiants inexistants sont écartés à l'écriture (voir
 * `keepExistingThemeIds`).
 */
function readThemeIds(formData: FormData): string[] {
  const raw = formData.get("themeIds");
  if (typeof raw !== "string" || raw.trim() === "") return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const ids = parsed
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return [...new Set(ids)].slice(0, MAX_ARTICLE_THEMES);
}

/** Ne conserve que les thèmes réellement présents en base (WP16b). */
async function keepExistingThemeIds(themeIds: string[]): Promise<string[]> {
  if (themeIds.length === 0) return [];
  const found = await prisma.theme.findMany({
    where: { id: { in: themeIds } },
    select: { id: true },
  });
  return found.map((theme) => theme.id);
}

type ValidationResult =
  | { ok: true; data: ArticleInput }
  | { ok: false; error: string };

async function validate(
  formData: FormData,
  { requireCategory = true }: { requireCategory?: boolean } = {},
): Promise<ValidationResult> {
  const title = readText(formData, "title");
  const content = readText(formData, "content");
  const categoryId = readText(formData, "categoryId");
  const excerpt = readText(formData, "excerpt");
  const coverImageUrl = readText(formData, "coverImageUrl");
  const rawStatus = readText(formData, "status");
  const matchId = readText(formData, "matchId") || null;
  if (matchId && (matchId.length > 100 || !await prisma.match.findUnique({ where: { id: matchId }, select: { id: true } }))) {
    return { ok: false, error: "Le match sélectionné n’existe plus. Choisissez un autre match." };
  }
  const format = formData.has("format") ? readText(formData, "format") : "NEWS";
  if (format !== "FLASH" && format !== "NEWS" && format !== "ANALYSIS") {
    return { ok: false, error: "Format invalide : choisissez Flash, Actualité ou Analyse." };
  }

  if (!title) {
    return { ok: false, error: "Le titre est obligatoire." };
  }

  if (!content) {
    return { ok: false, error: "Le contenu est obligatoire." };
  }

  if (requireCategory && !categoryId) {
    return { ok: false, error: "La catégorie est obligatoire." };
  }

  if (!isArticleStatus(rawStatus)) {
    return { ok: false, error: "Statut invalide." };
  }

  const slug = resolveSlug(readText(formData, "slug"), title);
  if (!slug) {
    return {
      ok: false,
      error:
        "Impossible de générer un slug à partir du titre : saisissez un slug manuellement.",
    };
  }

  return {
    ok: true,
    data: {
      matchId,
      format,
      title,
      slug,
      content,
      excerpt: excerpt || null,
      coverImageUrl: coverImageUrl || null,
      categoryId,
      status: rawStatus,
      isPremium: readCheckbox(formData, "isPremium"),
      themeIds: readThemeIds(formData),
    },
  };
}

/**
 * Création d'un article. L'auteur est celui de la session : le formulaire ne
 * propose pas de sélection d'auteur.
 */
export async function createArticle(
  _previousState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const session = await auth();
  if (!session?.user?.id || !canAccessStudio(session.user.role)) {
    redirect("/login");
  }

  const result = await validate(formData);
  if (!result.ok) {
    return result.error;
  }

  // Un journaliste ne peut pas créer un article déjà publié ou archivé : la
  // règle de publication ne doit pas être contournable par le formulaire.
  if (!canPublish(session.user.role) && (result.data.status === "PUBLISHED" || result.data.status === "ARCHIVED")) {
    return "Seuls les éditeurs peuvent publier ou archiver un article.";
  }

  try {
    // `themeIds` n'est pas une colonne : il alimente la relation many-to-many
    // après vérification que les thèmes existent (WP16b).
    const { themeIds, ...articleData } = result.data;
    const linkedThemeIds = await keepExistingThemeIds(themeIds);
    const created = await prisma.article.create({
      data: {
        ...articleData,
        // Le caractère premium est décidé par un ADMIN ou un EDITOR (WP11) :
        // un journaliste crée toujours un article en accès libre, même s'il
        // forge le champ dans sa requête.
        isPremium: canSetPremium(session.user.role) ? result.data.isPremium : false,
        authorId: session.user.id,
        publishedAt: result.data.status === "PUBLISHED" ? new Date() : null,
        themes: { connect: linkedThemeIds.map((id) => ({ id })) },
      },
    });
    if (created.status === "PUBLISHED") {
      scheduleSocialPosts(created.id);
      await notifyArticleFollowers(created.id);
    }
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return `Le slug « ${result.data.slug} » est déjà utilisé par un autre article.`;
    }
    throw error;
  }

  revalidatePath("/studio/articles");
  if (result.data.status === "PUBLISHED") {
    revalidatePublicSurfaces();
  }
  redirect("/studio/articles");
}

/** Mise à jour d'un article existant. */
export async function updateArticle(
  id: string,
  _previousState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const session = await auth();
  if (!session?.user?.id || !canAccessStudio(session.user.role)) {
    redirect("/login");
  }

  const existing = await prisma.article.findUnique({ where: { id } });
  if (!existing) {
    return "Cet article n'existe plus.";
  }

  // Un journaliste peut corriger ses propres articles, même publiés.
  // Les changements de statut et de diffusion restent contrôlés séparément.
  const viewer = { id: session.user.id, role: session.user.role };
  if (!canEditArticle(viewer, existing)) {
    return "Vous n'avez pas le droit de modifier cet article.";
  }

  const result = await validate(formData);
  if (!result.ok) {
    return result.error;
  }

  // Le statut envoyé par le formulaire doit lui aussi respecter le workflow,
  // sinon l'édition permettrait de publier sans y être autorisé.
  if (result.data.status !== existing.status && !canTransitionArticle(viewer, existing, result.data.status)) {
    return "Changement de statut non autorisé.";
  }

  try {
    // WP16b : `set` remplace les associations (déconnecte les anciennes,
    // connecte les nouvelles) ; les identifiants inconnus sont écartés.
    const { themeIds, ...articleData } = result.data;
    const linkedThemeIds = await keepExistingThemeIds(themeIds);
    await prisma.article.update({
      where: { id },
      data: {
        ...articleData,
        themes: { set: linkedThemeIds.map((themeId) => ({ id: themeId })) },
        // Older forms and a failed initial picker load must preserve the association.
        matchId: formData.has("matchId") ? articleData.matchId : existing.matchId,
        // Le caractère premium ne suit pas le droit d'édition : un journaliste
        // qui enregistre son brouillon ne peut ni l'activer ni l'effacer. Sa
        // valeur en base est donc conservée telle quelle (WP11) — sinon un
        // simple enregistrement retirerait le paywall sans que personne ne le
        // demande.
        isPremium: canSetPremium(session.user.role) ? result.data.isPremium : existing.isPremium,
        // On horodate la première publication, sans l'écraser ensuite.
        publishedAt:
          result.data.status === "PUBLISHED"
            ? (existing.publishedAt ?? new Date())
            : null,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return `Le slug « ${result.data.slug} » est déjà utilisé par un autre article.`;
    }
    throw error;
  }

  revalidatePath("/studio/articles");
  if (existing.status !== "PUBLISHED" && result.data.status === "PUBLISHED") {
    scheduleSocialPosts(id);
    await notifyArticleFollowers(id);
  }
  // Un article publié avant ou après cette modification change l'accueil (titre,
  // extrait, diffusion premium), le sitemap et le flux RSS.
  if (existing.status === "PUBLISHED" || result.data.status === "PUBLISHED") {
    revalidatePublicSurfaces();
  }
  redirect("/studio/articles");
}

/** Change le statut d'un article (workflow éditorial). */
export async function updateArticleStatus(
  articleId: string,
  newStatus: ArticleStatus,
): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !canAccessStudio(session.user.role)) {
    redirect("/login");
  }

  if (!isArticleStatus(newStatus)) {
    return;
  }

  const existing = await prisma.article.findUnique({ where: { id: articleId } });
  if (!existing) {
    return;
  }

  // Règles du workflow (WP11) :
  //  - l'auteur circule entre brouillon et relecture sur ses articles non publiés ;
  //  - seuls ADMIN et EDITOR publient, archivent ou dépublient ;
  //  - le brouillon reste l'état de travail de l'auteur.
  if (!canTransitionArticle({ id: session.user.id, role: session.user.role }, existing, newStatus)) {
    return;
  }

  await prisma.article.update({
    where: { id: articleId },
    data: {
      status: newStatus,
      // Le passage à PUBLISHED horodate la première publication, sans l'écraser.
      publishedAt:
        newStatus === "PUBLISHED"
          ? (existing.publishedAt ?? new Date())
          : existing.publishedAt,
    },
  });

  revalidatePath("/studio/articles");
  revalidatePath(`/article/${existing.slug}`);
  if (existing.status !== "PUBLISHED" && newStatus === "PUBLISHED") {
    scheduleSocialPosts(articleId);
    await notifyArticleFollowers(articleId);
  }
  // Le sélecteur de statut couvrait déjà l'accueil ; sitemap et RSS manquaient.
  if (existing.status === "PUBLISHED" || newStatus === "PUBLISHED") {
    revalidatePublicSurfaces();
  }
}

/** Suppression d'un article, déclenchée depuis la liste. */
export async function deleteArticle(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !canAccessStudio(session.user.role)) {
    redirect("/login");
  }

  const id = readText(formData, "id");
  if (!id) {
    return;
  }

  const existing = await prisma.article.findUnique({
    where: { id },
    select: { id: true, authorId: true, status: true },
  });
  if (!existing) {
    return;
  }

  // Suppression : l'auteur ou un éditeur pour les articles non publiés ;
  // un article publié ou archivé ne peut être supprimé que par un ADMIN (WP11).
  if (!canDeleteArticle({ id: session.user.id, role: session.user.role }, existing)) {
    return;
  }

  await prisma.article.deleteMany({ where: { id } });

  revalidatePath("/studio/articles");
  // Supprimer un article publié le retire de l'accueil, du sitemap et du RSS.
  if (existing.status === "PUBLISHED") {
    revalidatePublicSurfaces();
  }
}

const ALLOWED_IMAGE_TYPES = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 Mo

export type MatchPickerOption = {
  id: string;
  homeName: string;
  awayName: string;
  scheduledAt: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
};

const pickerSelect = {
  id: true, scheduledAt: true, homeScore: true, awayScore: true, status: true,
  homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } },
} as const;

function pickerOption(match: { id: string; scheduledAt: Date; homeScore: number | null; awayScore: number | null; status: string; homeTeam: { name: string }; awayTeam: { name: string } }): MatchPickerOption {
  return { id: match.id, homeName: match.homeTeam.name, awayName: match.awayTeam.name,
    scheduledAt: match.scheduledAt.toISOString(), homeScore: match.homeScore, awayScore: match.awayScore, status: match.status };
}

/** Read existing selection without changing the studio page's props or permissions. */
export async function getArticleMatch(articleId: string): Promise<MatchPickerOption | null> {
  const session = await auth();
  if (!session?.user?.id || !canAccessStudio(session.user.role)) throw new Error("Non authentifié.");
  const article = await prisma.article.findUnique({ where: { id: articleId }, select: { authorId: true, status: true, match: { select: pickerSelect } } });
  if (!article || !canEditArticle({ id: session.user.id, role: session.user.role }, article)) throw new Error("Article inaccessible.");
  return article.match ? pickerOption(article.match) : null;
}

export async function searchMatches(query: string, date: string): Promise<MatchPickerOption[]> {
  const session = await auth();
  if (!session?.user?.id || !canAccessStudio(session.user.role)) throw new Error("Non authentifié.");
  const text = query.trim().slice(0, 150);
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)))) throw new Error("Date invalide.");
  // Same Africa/Lagos calendar day as the public scores, including midnight.
  const start = date ? new Date(`${date}T00:00:00+01:00`) : null;
  const rows = await prisma.match.findMany({
    where: {
      ...(start ? { scheduledAt: { gte: start, lt: new Date(start.getTime() + 86400000) } } : {}),
      ...(text ? { OR: [
        { homeTeam: { name: { contains: text, mode: "insensitive" as const } } },
        { homeTeam: { shortName: { contains: text, mode: "insensitive" as const } } },
        { awayTeam: { name: { contains: text, mode: "insensitive" as const } } },
        { awayTeam: { shortName: { contains: text, mode: "insensitive" as const } } },
      ] } : {}),
    }, select: pickerSelect, orderBy: [{ scheduledAt: "desc" }, { id: "asc" }], take: 10,
  });
  return rows.map(pickerOption);
}

/** Suggestions never save an association. Draft text also works before first save. */
export async function suggestMatches(articleId?: string, draft?: { title: string; content: string }): Promise<MatchPickerOption[]> {
  const session = await auth();
  if (!session?.user?.id || !canAccessStudio(session.user.role)) throw new Error("Non authentifié.");
  let text: string;
  if (articleId) {
    const article = await prisma.article.findUnique({ where: { id: articleId }, select: { title: true, content: true, authorId: true, status: true } });
    if (!article || !canEditArticle({ id: session.user.id, role: session.user.role }, article)) throw new Error("Article inaccessible.");
    text = `${draft?.title ?? article.title} ${draft?.content ?? article.content}`;
  } else { text = `${draft?.title ?? ""} ${draft?.content ?? ""}`; }
  // Whole normalized phrases: "Inter" does not accidentally match "interview".
  const normalized = ` ${text.slice(0, 200000).replace(/<[^>]*>/g, " ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  if (!normalized.trim()) return [];
  const now = new Date();
  // ORM selection avoids driver-specific raw enum/date decoding after migration.
  const rows = await prisma.match.findMany({
    where: { scheduledAt: { gte: new Date(now.getTime()-30*86400000), lte: new Date(now.getTime()+30*86400000) } },
    select: { ...pickerSelect, homeTeam: { select: { name: true, shortName: true } }, awayTeam: { select: { name: true, shortName: true } } },
  });
  const phrase = (name: string | null) => (name ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return rows.filter(match => [match.homeTeam.name, match.homeTeam.shortName, match.awayTeam.name, match.awayTeam.shortName].some(name => {
    const value = phrase(name); return value.length >= 2 && normalized.includes(` ${value} `);
  })).sort((a,b) => Math.abs(a.scheduledAt.getTime()-now.getTime())-Math.abs(b.scheduledAt.getTime()-now.getTime()) || a.id.localeCompare(b.id)).slice(0,10).map(pickerOption);
}

type UploadImageResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Upload d'une image de couverture (Server Action).
 *
 * Appelée directement par le composant client ImageUpload : elle valide le type
 * MIME et la taille, stocke le fichier sous un nom unique, puis renvoie l'URL à
 * enregistrer en base.
 *
 * Deux stockages selon l'environnement :
 *
 *  - **production (Vercel)** : `BLOB_READ_WRITE_TOKEN` est défini, le fichier
 *    part dans Vercel Blob et l'on renvoie son URL publique absolue. Le système
 *    de fichiers d'une fonction Vercel est en lecture seule : `writeFile` y
 *    échouerait (EROFS) ;
 *  - **développement** : sans jeton, on écrit dans `public/uploads/` et l'on
 *    renvoie le chemin relatif `/uploads/<uuid>.<ext>`, comme avant.
 *
 * Le SDK `@vercel/blob` est chargé **dynamiquement** : comme pour
 * `@prisma/adapter-pg` (voir src/lib/prisma.ts), un import statique ferait
 * évaluer le module dans le graphe client des Server Actions et ferait échouer
 * toutes les actions de la page (« Cannot read properties of undefined »).
 */
export async function uploadImage(
  formData: FormData,
): Promise<UploadImageResult> {
  const session = await auth();
  if (!session?.user?.id || !canAccessStudio(session.user.role)) {
    return { ok: false, error: "Non authentifié." };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "Aucun fichier reçu." };
  }

  const extension = ALLOWED_IMAGE_TYPES.get(file.type);
  if (!extension) {
    return {
      ok: false,
      error: "Format non autorisé. Formats acceptés : JPEG, PNG, WebP, GIF.",
    };
  }

  if (file.size > MAX_IMAGE_SIZE) {
    return { ok: false, error: "Fichier trop volumineux. Taille maximale : 5 Mo." };
  }
  if (file.size === 0) {
    return { ok: false, error: "Fichier vide." };
  }

  const filename = `${randomUUID()}${extension}`;

  const token = process.env.BLOB_READ_WRITE_TOKEN;

  if (token) {
    try {
      const { put } = await import("@vercel/blob");
      // `file` (un File) est accepté tel quel par put : le SDK en diffuse le
      // contenu sans le recopier en mémoire.
      const blob = await put(`uploads/${filename}`, file, {
        // URL publique : la couverture est affichée par next/image sur les pages
        // publiques (l'hôte du store doit être autorisé dans next.config.ts).
        access: "public",
        contentType: file.type,
        // Le nom est déjà unique (UUID) : pas de suffixe aléatoire ajouté.
        addRandomSuffix: false,
        token,
      });
      return { ok: true, url: blob.url };
    } catch (error) {
      console.error(
        "[upload] échec de l'envoi vers Vercel Blob :",
        error instanceof Error ? error.message : error,
      );
      return {
        ok: false,
        error: "L'envoi de l'image a échoué. Réessayez dans un instant.",
      };
    }
  }

  if (process.env.NODE_ENV === "production") {
    return { ok: false, error: "Le stockage des images n’est pas configuré. Vérifiez BLOB_READ_WRITE_TOKEN dans Vercel puis redéployez." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const uploadsDir = path.join(process.cwd(), "public", "uploads");
  await mkdir(uploadsDir, { recursive: true });
  await writeFile(path.join(uploadsDir, filename), bytes);

  return { ok: true, url: `/uploads/${filename}` };
}
