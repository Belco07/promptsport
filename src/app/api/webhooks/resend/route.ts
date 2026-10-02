import { NextResponse } from "next/server";
import { Webhook } from "svix";

import { recordSendEvent, type SendEventKind } from "@/lib/newsletter-send";

/**
 * Webhook Resend (WP11b).
 *
 * Resend signe chaque appel (schéma Svix) : la signature est vérifiée **avant**
 * tout traitement, sinon n'importe qui pourrait marquer des envois comme ouverts
 * ou, pire, désabonner des adresses à la volée.
 *
 * Le corps est lu en texte brut et non parsé par Next : la signature porte sur
 * les octets exacts reçus, un `JSON.parse` préalable casserait la vérification.
 *
 * Les événements traités sont ceux du brief ; les autres (envoi programmé,
 * diffusion…) sont ignorés et répondent 200, pour ne pas déclencher de réessais
 * inutiles côté Resend.
 */

/** Types d'événements Resend raccordés à un envoi de newsletter. */
const HANDLED_EVENTS: Record<string, SendEventKind> = {
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

/** Étiquettes d'un message : Resend les envoie en tableau ou en objet. */
type EventTags = Record<string, string> | { name: string; value: string }[] | undefined;

type ResendEventPayload = {
  type?: string;
  data?: {
    email_id?: string;
    to?: string | string[];
    bounce?: { message?: string; type?: string };
    tags?: EventTags;
  };
};

/** Identifiant d'envoi transporté dans les étiquettes du message, s'il y est. */
function sendIdFromTags(tags: EventTags): string | null {
  if (!tags) return null;
  if (Array.isArray(tags)) {
    return tags.find((tag) => tag?.name === "send_id")?.value ?? null;
  }
  return typeof tags.send_id === "string" ? tags.send_id : null;
}

/** Motif lisible d'un rejet. */
function bounceMessage(data: ResendEventPayload["data"]): string | null {
  const message = data?.bounce?.message;
  const type = data?.bounce?.type;
  if (message && type) return `${type} : ${message}`;
  return message ?? type ?? null;
}

export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error("[webhooks/resend] RESEND_WEBHOOK_SECRET absente : événement refusé.");
    return NextResponse.json({ error: "Webhook non configuré." }, { status: 503 });
  }

  const payload = await request.text();
  const headers = {
    "svix-id": request.headers.get("svix-id") ?? "",
    "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
    "svix-signature": request.headers.get("svix-signature") ?? "",
  };

  let event: ResendEventPayload;
  try {
    // `Webhook.verify` ne renvoie rien dans cette version de svix : il lève si la
    // signature ne correspond pas. La charge utile est donc relue du corps brut,
    // une fois la signature validée.
    new Webhook(secret).verify(payload, headers);
    event = JSON.parse(payload) as ResendEventPayload;
  } catch (error) {
    console.warn(
      "[webhooks/resend] charge utile refusée :",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ error: "Signature ou charge utile invalide." }, { status: 400 });
  }

  const kind = event?.type ? HANDLED_EVENTS[event.type] : undefined;
  if (!kind) {
    return NextResponse.json({ ignored: event?.type ?? "type inconnu" });
  }

  // On retrouve l'envoi par l'identifiant du message chez Resend ; les étiquettes
  // servent de repli si le fournisseur ne le transmet pas.
  const result = await recordSendEvent({
    kind,
    providerMessageId: event.data?.email_id ?? null,
    sendId: sendIdFromTags(event.data?.tags),
    errorMessage: kind === "bounced" ? bounceMessage(event.data) : null,
  });

  if (!result.ok) {
    // 200 malgré tout : l'événement est inconnu de notre base (message de test,
    // envoi purgé). Répondre en erreur ferait réessayer Resend indéfiniment.
    console.warn(`[webhooks/resend] ${event.type} : ${result.reason}`);
    return NextResponse.json({ ignored: result.reason });
  }

  return NextResponse.json({ ok: true, sendId: result.sendId });
}
