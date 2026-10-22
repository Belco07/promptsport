import type { BrowserContext } from "@playwright/test";

/** Redirect only the external storage service. The authenticated app route and SDK stay real. */
export async function stubBrowserBlob(context: BrowserContext) {
  if (process.env.E2E_VISUAL_BLOB_STUB !== "1") return;
  const endpoint = process.env.VERCEL_BLOB_API_URL;
  if (!endpoint || new URL(endpoint).hostname !== "127.0.0.1") throw Error("Blob fixture must be local.");
  await context.route(/^https:\/\/(?:blob\.vercel-storage\.com\/|vercel\.com\/api\/blob\/)/, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const response = await context.request.fetch(`${endpoint}${url.pathname}${url.search}`, {
      method: request.method(), data: request.postDataBuffer() ?? undefined,
      headers: { ...request.headers(), authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    await route.fulfill({ response });
  });
}
