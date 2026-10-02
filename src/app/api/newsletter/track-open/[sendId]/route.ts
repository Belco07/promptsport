import { recordSendEvent } from "@/lib/newsletter-send";

/**
 * Pixel de suivi d'ouverture (WP11b).
 *
 * Le brief le donne comme facultatif — Resend remonte déjà les ouvertures par
 * webhook — mais il rend le suivi indépendant du fournisseur et il est trivial :
 * une image transparente de 1 × 1, servie sans cache, dont l'appel marque
 * l'envoi comme ouvert.
 *
 * Réponse toujours 200 avec l'image, même si l'envoi est inconnu : un e-mail ne
 * doit pas afficher d'image cassée parce que notre base a oublié un identifiant.
 */

/** GIF transparent de 1 × 1 pixel (43 octets). */
const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sendId: string }> },
): Promise<Response> {
  const { sendId } = await params;

  try {
    await recordSendEvent({ kind: "opened", sendId });
  } catch (error) {
    // Le suivi ne doit jamais faire échouer l'affichage de l'e-mail.
    console.warn(
      "[newsletter] pixel d'ouverture :",
      error instanceof Error ? error.message : error,
    );
  }

  return new Response(new Uint8Array(TRANSPARENT_GIF), {
    status: 200,
    headers: {
      "content-type": "image/gif",
      "content-length": String(TRANSPARENT_GIF.length),
      "cache-control": "no-store, no-cache, must-revalidate, private",
      pragma: "no-cache",
    },
  });
}
