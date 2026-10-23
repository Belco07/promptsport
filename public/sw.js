/* Public, anonymous reading snapshots only. WP48 push listeners follow below. */
const PAGE_CACHE = "promptsport-pages-v1";
const ASSET_CACHE = "promptsport-assets-v1";
const PAGE_AGE = 7 * 24 * 60 * 60 * 1000;
const publicPath = path => path === "/" || /^\/(article|themes|auteur|club|competition|joueur)(\/|$)/.test(path);
const pageKey = path => new URL(path, self.location.origin).href;
async function storeBounded(name, request, response, limit) {
  const cache = await caches.open(name);
  await cache.put(request, response);
  const keys = (await cache.keys()).filter(key => name !== ASSET_CACHE || !/\/(offline\.html|icons\/)/.test(new URL(key.url).pathname));
  for (const key of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(key);
}
async function savePublicPage(pathname) {
  if (!publicPath(pathname)) return;
  // Never save the authenticated navigation response: premium content, identity,
  // subscriptions, tokens and personal menus must not enter the offline cache.
  const url = pageKey(pathname);
  const response = await fetch(url, { credentials: "omit", cache: "no-store", headers: { Accept: "text/html" } });
  if (!response.ok || response.redirected || !response.headers.get("content-type")?.includes("text/html")) return;
  const html = await response.text();
  if (html.length > 2_000_000) return;
  // The first visit loaded before worker activation: save its hashed JS/CSS/fonts
  // as well, otherwise a fresh offline reload could not hydrate or show its status.
  const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => new URL(match[1].replaceAll("&amp;", "&"), url)).filter(asset => asset.origin === self.location.origin && (asset.pathname.startsWith("/_next/static/") || asset.pathname === "/_next/image" && !(asset.searchParams.get("url") || "").startsWith("/api/")));
  const assetCache = await caches.open(ASSET_CACHE);
  let images = 0;
  await Promise.all([...new Set(assets.filter(asset => asset.pathname !== "/_next/image" || images++ < 6).map(asset => asset.href))].slice(0, 80).map(async asset => {
    if (await assetCache.match(asset, { ignoreVary: true })) return;
    try { const response = await fetch(asset, { credentials: "omit" }); if (response.ok) await storeBounded(ASSET_CACHE, asset, response, 160); } catch { /* Reading still has a document fallback. */ }
  }));
  const headers = new Headers({ "Content-Type": "text/html; charset=utf-8", "X-PromptSport-Saved": String(Date.now()) });
  await storeBounded(PAGE_CACHE, url, new Response(html, { headers }), 30);
}
self.addEventListener("install", event => event.waitUntil((async () => {
  const cache = await caches.open(ASSET_CACHE);
  await cache.addAll(["/offline.html", "/icons/icon-192.png", "/icons/icon-512.png"]);
  await self.skipWaiting();
})()));
self.addEventListener("activate", event => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith("promptsport-") && ![PAGE_CACHE, ASSET_CACHE].includes(name)) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener("message", event => {
  const path = event.data?.pathname;
  if (event.data?.type === "CACHE_PUBLIC_PAGE" && typeof path === "string" && path.startsWith("/") && !path.startsWith("//") && !/[?#]/.test(path)) {
    event.waitUntil(savePublicPage(path).catch(() => {}));
  }
});
self.addEventListener("fetch", event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    // Authentication, checkout, API and account pages are always network-only.
    if (!publicPath(url.pathname) && url.pathname !== "/scores") return;
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok && publicPath(url.pathname) && !url.search) event.waitUntil(savePublicPage(url.pathname).catch(() => {}));
        return response;
      } catch {
        const cache = await caches.open(PAGE_CACHE);
        const saved = !url.search && await cache.match(pageKey(url.pathname));
        if (saved && Date.now() - Number(saved.headers.get("X-PromptSport-Saved")) < PAGE_AGE) return new Response((await saved.text()).replace(/<html(?=[\s>])/i, '<html data-pwa-offline="true"'), { headers: saved.headers });
        return await caches.match("/offline.html") || new Response("Hors connexion", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
    })());
    return;
  }
  // No RSC, API, prefetch data, images from authenticated routes or HTML here.
  const staticAsset = url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
  const publicImage = url.pathname === "/_next/image" && /^\/(?:[^/]|$)|^https:\/\/[^/]+\.public\.blob\.vercel-storage\.com\//.test(url.searchParams.get("url") || "") && !(url.searchParams.get("url") || "").startsWith("/api/");
  if (!staticAsset && !publicImage) return;
  event.respondWith((async () => {
    const cache = await caches.open(ASSET_CACHE);
    const cached = await cache.match(request, { ignoreVary: staticAsset });
    if (staticAsset && cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && response.type !== "opaque") event.waitUntil(storeBounded(ASSET_CACHE, request, response.clone(), 160).catch(() => {}));
      return response;
    } catch {
      if (cached) return cached;
      // A responsive image may request another width after an offline reload.
      // Reuse a saved public rendition of the same source instead of a broken image.
      if (publicImage) for (const key of await cache.keys()) {
        const candidate = new URL(key.url);
        if (candidate.pathname === "/_next/image" && candidate.searchParams.get("url") === url.searchParams.get("url")) {
          const image = await cache.match(key, { ignoreVary: true }); if (image) return image;
        }
      }
      return Response.error();
    }
  })());
});

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
