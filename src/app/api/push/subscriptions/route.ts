import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isPushEndpoint, pushPublicKey } from "@/lib/push";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
function json(value: unknown, status = 200) { return NextResponse.json(value, { status, headers }); }
function sameOrigin(request: Request) { const origin = request.headers.get("origin"); return !origin || origin === new URL(request.url).origin; }
function key(value: unknown, length: number) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]+$/.test(value) && value.length < 200 && Buffer.from(value, "base64url").length === length;
}
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "Connexion requise." }, 401);
  const subscriptions = await prisma.pushSubscription.findMany({ where: { readerId: session.user.id }, select: { endpoint: true } });
  return json({ publicKey: pushPublicKey(), endpoints: subscriptions.map(item => item.endpoint) });
}
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "Connexion requise." }, 401);
  if (!sameOrigin(request)) return json({ error: "Origine refusée." }, 403);
  if (!pushPublicKey()) return json({ error: "Les alertes téléphone ne sont pas encore configurées." }, 503);
  try {
    const body = await request.text(); if (body.length > 8000) return json({ error: "Abonnement trop volumineux." }, 413);
    const input = JSON.parse(body);
    if (!isPushEndpoint(input.endpoint) || !key(input.keys?.p256dh, 65) || Buffer.from(input.keys.p256dh, "base64url")[0] !== 4 || !key(input.keys?.auth, 16)) return json({ error: "Abonnement invalide." }, 400);
    const existing = await prisma.pushSubscription.findUnique({ where: { endpoint: input.endpoint } });
    if (existing && existing.readerId !== session.user.id && (existing.p256dh !== input.keys.p256dh || existing.auth !== input.keys.auth)) return json({ error: "Abonnement déjà associé." }, 409);
    await prisma.pushSubscription.upsert({ where: { endpoint: input.endpoint }, create: { readerId: session.user.id, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth }, update: { readerId: session.user.id, p256dh: input.keys.p256dh, auth: input.keys.auth } });
    return json({ success: true });
  } catch { return json({ error: "Impossible d’enregistrer les alertes téléphone." }, 400); }
}
export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "Connexion requise." }, 401);
  if (!sameOrigin(request)) return json({ error: "Origine refusée." }, 403);
  try {
    const { endpoint } = await request.json();
    if (!isPushEndpoint(endpoint)) return json({ error: "Abonnement invalide." }, 400);
    await prisma.pushSubscription.deleteMany({ where: { endpoint, readerId: session.user.id } });
    return json({ success: true });
  } catch { return json({ error: "Désactivation impossible." }, 400); }
}
