/* eslint-disable @next/next/no-img-element -- ImageResponse (Satori) ne rend pas next/image */
import { randomUUID } from "node:crypto";

import React from "react";
import { lookup } from "node:dns/promises";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";

import { ImageResponse } from "next/og";
import sharp from "sharp";

import { SITE_URL } from "@/lib/seo";

/**
 * Couverture des articles issus de la veille (WP47, suite).
 *
 * La photo de la source est reprise **uniquement** lorsque la source est
 * déclarée sous licence. Elle est recadrée, réhébergée, puis brandée avec le
 * titre de l'article et le logo PromptSport. Aucune photo source n'est servie
 * directement : on ne conserve que la composition finale, avec son crédit.
 *
 * Le téléchargement distant passe par un fetch contrôlé (HTTP(S), hôte public,
 * taille limitée) pour éviter qu'une URL de flux malveillante n'atteigne le
 * réseau interne ou ne sature la fonction.
 */

const COVER_WIDTH = 1200;
const COVER_HEIGHT = 630;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12_000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; PromptSport News Engine/1.0; +https://promptsport.fr)";

export type NewsCoverInput = {
  title: string;
  category: string;
  /** Image déjà extraite de l'alerte, si le connecteur en a trouvé une. */
  imageUrl: string | null;
  imageCredit: string | null;
  articleUrl: string;
  sourceName: string;
};

export type NewsCoverResult = {
  url: string;
  credit: string;
  creditUrl: string;
};

function truncate(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function isPrivateIp(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }

  const normalized = address.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

function isLocalTestHost(hostname: string): boolean {
  return (
    process.env.E2E_DISTRIBUTION_STUB === "1" &&
    (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1")
  );
}

async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("URL distante invalide.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Seules les URL HTTP(S) sont autorisées.");
  }
  if (url.username || url.password) {
    throw new Error("Les URL avec identifiants sont refusées.");
  }

  const hostname = url.hostname;
  if (isLocalTestHost(hostname)) return url;
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Hôte local refusé.");
  }

  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error("Adresse réseau privée refusée.");
    return url;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new Error("Nom d'hôte introuvable.");
  }
  if (
    addresses.length === 0 ||
    addresses.some((entry) => isPrivateIp(entry.address))
  ) {
    throw new Error("Adresse réseau privée refusée.");
  }
  return url;
}

async function safeFetch(
  raw: string,
  init: RequestInit,
  redirects = 0,
): Promise<Response> {
  const url = await assertSafeUrl(raw);
  const response = await fetch(url, { ...init, redirect: "manual" });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");
    if (!location || redirects >= 3) {
      throw new Error("Trop de redirections.");
    }
    return safeFetch(new URL(location, url).toString(), init, redirects + 1);
  }
  return response;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

/** Cherche `og:image`, `twitter:image` ou `link rel=image_src`. */
export function extractSocialImage(
  html: string,
  baseUrl: string,
): string | null {
  const candidates: string[] = [];

  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const key = (
      tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1] ?? ""
    ).toLowerCase();
    if (
      key !== "og:image" &&
      key !== "og:image:secure_url" &&
      key !== "twitter:image" &&
      key !== "twitter:image:src"
    ) {
      continue;
    }
    const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1];
    if (content) candidates.push(decodeEntities(content));
  }

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/\brel\s*=\s*["']image_src["']/i.test(tag)) continue;
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (href) candidates.push(decodeEntities(href));
  }

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate, baseUrl);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return url.toString();
      }
    } catch {
      // candidat suivant
    }
  }
  return null;
}

async function imageFromArticlePage(articleUrl: string): Promise<string | null> {
  try {
    const response = await safeFetch(articleUrl, {
      signal: AbortSignal.timeout(8_000),
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return null;
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_HTML_BYTES) return null;
    const html = (await response.text()).slice(0, MAX_HTML_BYTES);
    return extractSocialImage(html, response.url || articleUrl);
  } catch {
    return null;
  }
}

async function downloadImage(rawUrl: string): Promise<Buffer> {
  const response = await safeFetch(rawUrl, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "User-Agent": USER_AGENT, Accept: "image/*" },
  });
  if (!response.ok) {
    throw new Error(`Téléchargement de la photo impossible (${response.status}).`);
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_IMAGE_BYTES) {
    throw new Error("Photo source trop volumineuse.");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error("Photo source vide ou trop volumineuse.");
  }
  return bytes;
}

async function preparePhoto(source: Buffer): Promise<Buffer> {
  return sharp(source)
    .rotate()
    .resize(COVER_WIDTH, COVER_HEIGHT, { fit: "cover", position: "attention" })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

const assetCache = new Map<string, Buffer>();

/**
 * Charge un asset de `public/` : lecture disque en local, sinon requête sur le
 * site déployé (Vercel ne place pas `public/` dans le système de fichiers de
 * la fonction).
 */
async function loadPublicAsset(relativePath: string): Promise<Buffer> {
  const normalized = relativePath.replace(/^\/+/, "");
  const cached = assetCache.get(normalized);
  if (cached) return cached;

  try {
    const data = await readFile(path.join(process.cwd(), "public", normalized));
    assetCache.set(normalized, data);
    return data;
  } catch {
    // Repli réseau ci-dessous.
  }

  const response = await fetch(new URL(`/${normalized}`, `${SITE_URL}/`), {
    signal: AbortSignal.timeout(8_000),
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`Asset de marque introuvable : ${normalized}.`);
  }
  const data = Buffer.from(await response.arrayBuffer());
  assetCache.set(normalized, data);
  return data;
}

function asArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

function dataUri(buffer: Buffer, mime: string): string {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

async function renderCover(
  photo: Buffer,
  input: NewsCoverInput,
): Promise<Buffer> {
  const [font, logo] = await Promise.all([
    loadPublicAsset("fonts/BarlowCondensed-Bold.ttf"),
    loadPublicAsset("promptsport-logo-night.png"),
  ]);

  const title = truncate(input.title || "Actualité sportive", 120);
  const category = truncate(input.category || "Sport", 24).toUpperCase();
  const titleSize = title.length > 96 ? 46 : title.length > 66 ? 54 : 62;

  const image = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: "#071226",
        }}
      >
        <img
          src={dataUri(photo, "image/jpeg")}
          alt=""
          width={COVER_WIDTH}
          height={COVER_HEIGHT}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: COVER_WIDTH,
            height: COVER_HEIGHT,
            objectFit: "cover",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: COVER_WIDTH,
            height: COVER_HEIGHT,
            display: "flex",
            background:
              "linear-gradient(180deg, rgba(3,8,20,0.74) 0%, rgba(3,8,20,0.14) 24%, rgba(3,8,20,0.08) 45%, rgba(3,8,20,0.92) 100%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 26,
            right: 34,
            display: "flex",
            background: "rgba(4,10,24,0.80)",
            border: "1px solid rgba(255,255,255,0.20)",
            borderRadius: 12,
            padding: "12px 18px",
          }}
        >
          <img
            src={dataUri(logo, "image/png")}
            alt=""
            width={250}
            height={55}
            style={{ width: 250, height: 55 }}
          />
        </div>
        <div
          style={{
            position: "absolute",
            left: 52,
            right: 52,
            bottom: 42,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
          }}
        >
          <div
            style={{
              display: "flex",
              background: "#1235ff",
              border: "2px solid rgba(255,255,255,0.92)",
              borderRadius: 6,
              color: "white",
              fontFamily: "Barlow",
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 3,
              padding: "7px 16px",
            }}
          >
            {category}
          </div>
          <div
            style={{
              display: "flex",
              color: "white",
              fontFamily: "Barlow",
              fontSize: titleSize,
              fontWeight: 700,
              lineHeight: 1.02,
              marginTop: 17,
              textShadow: "0 2px 18px rgba(0,0,0,0.60)",
            }}
          >
            {title}
          </div>
        </div>
      </div>
    ),
    {
      width: COVER_WIDTH,
      height: COVER_HEIGHT,
      fonts: [
        {
          name: "Barlow",
          data: asArrayBuffer(font),
          weight: 700,
          style: "normal",
        },
      ],
    },
  );

  const png = Buffer.from(await image.arrayBuffer());
  return sharp(png).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

async function storeCover(jpeg: Buffer): Promise<string> {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (token) {
    const { put } = await import("@vercel/blob");
    const blob = await put(`covers/${randomUUID()}.jpg`, jpeg, {
      access: "public",
      contentType: "image/jpeg",
      addRandomSuffix: false,
      token,
    });
    return blob.url;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN absent : impossible de stocker la couverture.",
    );
  }

  const uploadsDir = path.join(process.cwd(), "public", "uploads");
  await mkdir(uploadsDir, { recursive: true });
  const filename = `${randomUUID()}.jpg`;
  await writeFile(path.join(uploadsDir, filename), jpeg);
  return `/uploads/${filename}`;
}

/**
 * Construit la couverture finale d'un article de veille.
 *
 * Retourne `null` si aucune photo exploitable n'est trouvée ou si le stockage
 * échoue. L'appelant doit alors conserver l'article en brouillon.
 */
export async function createNewsCover(
  input: NewsCoverInput,
): Promise<NewsCoverResult | null> {
  const candidates: string[] = [];
  if (input.imageUrl) candidates.push(input.imageUrl);

  for (const candidate of candidates) {
    try {
      const source = await downloadImage(candidate);
      const photo = await preparePhoto(source);
      const cover = await renderCover(photo, input);
      const url = await storeCover(cover);
      return {
        url,
        credit: input.imageCredit?.trim() || input.sourceName,
        creditUrl: input.articleUrl,
      };
    } catch (error) {
      console.warn(
        "[veille] photo de l'alerte inutilisable, recherche d'une image de page :",
        error instanceof Error ? error.message : "erreur inconnue",
      );
    }
  }

  const pageImage = await imageFromArticlePage(input.articleUrl);
  if (pageImage) {
    try {
      const source = await downloadImage(pageImage);
      const photo = await preparePhoto(source);
      const cover = await renderCover(photo, input);
      const url = await storeCover(cover);
      return {
        url,
        credit: input.imageCredit?.trim() || input.sourceName,
        creditUrl: input.articleUrl,
      };
    } catch (error) {
      console.warn(
        "[veille] couverture indisponible :",
        error instanceof Error ? error.message : "erreur inconnue",
      );
    }
  }

  return null;
}
