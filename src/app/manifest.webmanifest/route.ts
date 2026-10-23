import appManifest from "../../../public/manifest.json";
/** Compatibility URL for installations created in WP48. */
export function GET() {
  return Response.json(appManifest, { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" } });
}
