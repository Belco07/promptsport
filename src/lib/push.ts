import webPush from "web-push";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";

/** Restrict reader-controlled destinations to browser push providers (SSRF). */
export function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 4096) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
    const host = url.hostname;
    return host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" || host.endsWith(".push.services.mozilla.com") || host.endsWith(".notify.windows.com") || host === "web.push.apple.com" || host.endsWith(".push.apple.com");
  } catch { return false; }
}
export function pushPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim() ? process.env.VAPID_PUBLIC_KEY.trim() : null;
}

/** Only first publication of a published FLASH is claimed, across instances. */
export async function sendFlashPush(articleId: string) {
  const publicKey = pushPublicKey();
  if (!publicKey) return { sent: 0, expired: 0, failed: 0, skipped: true };
  const article = await prisma.article.findUnique({ where: { id: articleId }, select: { title: true, slug: true, excerpt: true, status: true, format: true } });
  if (!article || article.status !== "PUBLISHED" || article.format !== "FLASH") return { sent: 0, expired: 0, failed: 0, skipped: true };
  const claim = await prisma.article.updateMany({ where: { id: articleId, status: "PUBLISHED", format: "FLASH", pushNotifiedAt: null }, data: { pushNotifiedAt: new Date() } });
  if (!claim.count) return { sent: 0, expired: 0, failed: 0, skipped: true };
  const payload = JSON.stringify({ title: `Flash — ${article.title.slice(0, 120)}`, body: article.excerpt?.slice(0, 200) ?? "L’essentiel de l’actualité sportive sur PromptSport.", url: `/article/${encodeURIComponent(article.slug)}`, tag: `article-${articleId}` });
  const totals = { sent: 0, expired: 0, failed: 0, skipped: false };
  let lastId = "";
  for (;;) {
    const subscriptions = await prisma.pushSubscription.findMany({ where: lastId ? { id: { gt: lastId } } : {}, orderBy: { id: "asc" }, take: 100 });
    if (!subscriptions.length) break;
    for (let offset = 0; offset < subscriptions.length; offset += 10) {
      await Promise.all(subscriptions.slice(offset, offset + 10).map(async subscription => {
        if (!isPushEndpoint(subscription.endpoint)) { totals.failed++; return; }
        try {
          await webPush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload, {
            TTL: 3600, urgency: "high", timeout: 3000,
            vapidDetails: { subject: process.env.VAPID_SUBJECT?.trim() || "https://www.promptsport.net", publicKey, privateKey: process.env.VAPID_PRIVATE_KEY!.trim() },
          });
          totals.sent++;
        } catch (error) {
          const code = (error as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) { await prisma.pushSubscription.deleteMany({ where: { id: subscription.id, endpoint: subscription.endpoint } }); totals.expired++; }
          else totals.failed++;
        }
      }));
    }
    lastId = subscriptions[subscriptions.length - 1].id;
  }
  return totals;
}

export function scheduleFlashPush(articleId: string): void {
  after(async () => {
    try { const result = await sendFlashPush(articleId); if (result.failed) console.warn(`[push] ${result.sent} envois, ${result.failed} échecs.`); }
    catch { console.error("[push] Diffusion des alertes indisponible."); }
  });
}
