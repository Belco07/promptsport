/* Push-only worker: no fetch interception or page caching. */
self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("push", event => {
  let payload = {};
  try { const value = event.data ? event.data.json() : {}; payload = value && typeof value === "object" ? value : {}; } catch { /* Show a safe fallback. */ }
  const title = typeof payload.title === "string" ? payload.title.slice(0, 160) : "PromptSport";
  let url = "/";
  try { const target = new URL(payload.url, self.location.origin); if (target.origin === self.location.origin && target.pathname.startsWith("/article/")) url = target.pathname; } catch { /* Keep home. */ }
  event.waitUntil(self.registration.showNotification(title, { body: typeof payload.body === "string" ? payload.body.slice(0, 240) : "Une nouvelle actualité sportive vous attend.", icon: "/promptsport-logo.webp", tag: typeof payload.tag === "string" ? payload.tag : "promptsport-flash", data: { url } }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  let url = new URL("/", self.location.origin);
  try { const candidate = new URL(event.notification.data?.url, self.location.origin); if (candidate.origin === self.location.origin) url = candidate; } catch { /* Keep home. */ }
  event.waitUntil((async () => { const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true }); const existing = windows.find(client => client.url === url.href); if (existing) return existing.focus(); return self.clients.openWindow(url.href); })());
});
