import { Resend } from "resend";

/**
 * Client Resend (WP11b).
 *
 * Deux principes :
 *
 *  - **création paresseuse** : ni la clé ni l'expéditeur ne sont lus au chargement
 *    du module. Un script CLI (`npx tsx scripts/send-campaign.ts`) charge `.env`
 *    après ses imports : lire l'environnement à l'import figerait des valeurs
 *    vides ou un expéditeur de repli. Tout est donc résolu au premier envoi.
 *
 *  - **échec explicite, jamais d'exception** : `sendEmail` renvoie toujours un
 *    résultat. Une campagne continue pour les autres destinataires même si un
 *    envoi échoue (critère d'acceptation du WP11b), et une clé absente se traduit
 *    par un message clair plutôt qu'un plantage au démarrage.
 *
 * `RESEND_BASE_URL` permet de pointer l'API vers un serveur factice local : c'est
 * le seul moyen de vérifier le parcours d'envoi sans réseau ni consommation de
 * quota. Elle n'a pas vocation à être renseignée ailleurs qu'en test.
 */

export type EmailInput = {
  to: string;
  subject: string;
  html: string;
  /** Version texte brut, facultative mais recommandée (délivrabilité). */
  text?: string;
  /** En-têtes additionnels, dont `List-Unsubscribe` (RGPD). */
  headers?: Record<string, string>;
  /** Étiquettes Resend, utilisées pour relier un événement à un envoi. */
  tags?: { name: string; value: string }[];
};

export type SendEmailResult =
  | { success: true; id: string | null }
  | { success: false; error: string };

/** Expéditeur au format « Nom <adresse> ». */
export function fromAddress(): string {
  const email = process.env.RESEND_FROM_EMAIL?.trim() || "onboarding@resend.dev";
  const name = process.env.RESEND_FROM_NAME?.trim() || "Mon Site d'Actualités";
  return `${name} <${email}>`;
}

/** Vrai si une clé Resend est configurée (l'envoi est possible). */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

let cached: Resend | null = null;

/**
 * Instance Resend configurée avec `RESEND_API_KEY`, ou `null` si la clé est
 * absente. Mémoïsée : une seule instance par processus.
 */
export function getResendClient(): Resend | null {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    return null;
  }
  if (!cached) {
    const baseUrl = process.env.RESEND_BASE_URL?.trim();
    cached = baseUrl ? new Resend(key, { baseUrl }) : new Resend(key);
  }
  return cached;
}

/** Message d'erreur lisible à partir de ce que renvoie le SDK ou le réseau. */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "erreur inconnue";
  }
}

/**
 * Envoi d'un e-mail via Resend.
 *
 * Renvoie `{ success: true, id }` avec l'identifiant du message chez Resend
 * (conservé dans `NewsletterSend.providerMessageId` pour relier les webhooks),
 * ou `{ success: false, error }` après journalisation — l'appelant décide de
 * poursuivre ou non.
 */
export async function sendEmail(input: EmailInput): Promise<SendEmailResult> {
  const client = getResendClient();
  if (!client) {
    const error = "RESEND_API_KEY absente : envoi désactivé.";
    console.warn(`[resend] ${error}`);
    return { success: false, error };
  }

  try {
    const { data, error } = await client.emails.send({
      from: fromAddress(),
      to: input.to,
      subject: input.subject,
      html: input.html,
      ...(input.text ? { text: input.text } : {}),
      ...(input.headers ? { headers: input.headers } : {}),
      ...(input.tags ? { tags: input.tags } : {}),
    });

    if (error) {
      const message = describeError(error);
      console.warn(`[resend] envoi refusé pour ${input.to} : ${message}`);
      return { success: false, error: message };
    }

    return { success: true, id: data?.id ?? null };
  } catch (error) {
    // Erreur réseau, DNS, quota… : on ne laisse jamais remonter l'exception.
    const message = describeError(error);
    console.warn(`[resend] envoi impossible pour ${input.to} : ${message}`);
    return { success: false, error: message };
  }
}
