/**
 * Script CLI d'envoi de newsletter (WP11b).
 *
 * Exécution :
 *   npm run newsletter:send -- <campaignId>          # expédie une campagne
 *   npm run newsletter:send -- --confirmation <id>   # renvoie l'e-mail de double opt-in
 *   npm run newsletter:send -- --welcome <id>        # renvoie l'e-mail de bienvenue
 *   npx tsx scripts/send-campaign.ts <campaignId>
 *
 * L'environnement est chargé **avant** l'import des modules métier : `src/lib/seo.ts`
 * fige l'URL publique du site au chargement du module, et les liens de
 * désabonnement des e-mails en dépendent. D'où les imports dynamiques dans `main`.
 *
 * Codes de sortie : 0 si l'envoi s'est déroulé (même avec des destinataires en
 * échec — le résumé les détaille), 1 si la campagne n'a pas pu être expédiée du
 * tout, 2 en cas d'usage incorrect.
 */

type Args =
  | { mode: "campaign"; id: string }
  | { mode: "confirmation"; id: string }
  | { mode: "welcome"; id: string };

function parseArgs(argv: string[]): Args | null {
  if (argv.length === 1 && !argv[0].startsWith("-")) {
    return { mode: "campaign", id: argv[0] };
  }
  if (argv.length === 2 && argv[0] === "--confirmation") {
    return { mode: "confirmation", id: argv[1] };
  }
  if (argv.length === 2 && argv[0] === "--welcome") {
    return { mode: "welcome", id: argv[1] };
  }
  return null;
}

const USAGE = `Usage :
  npx tsx scripts/send-campaign.ts <campaignId>          expédie la campagne
  npx tsx scripts/send-campaign.ts --confirmation <id>   e-mail de confirmation
  npx tsx scripts/send-campaign.ts --welcome <id>        e-mail de bienvenue`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  // .env d'abord : les modules importés plus bas lisent l'environnement.
  const loadEnvFile = (process as NodeJS.Process & { loadEnvFile?: (path?: string) => void })
    .loadEnvFile;
  if (typeof loadEnvFile === "function") {
    try {
      loadEnvFile();
    } catch {
      console.warn("Fichier .env absent : l'environnement du shell est utilisé seul.");
    }
  }

  const { prisma } = await import("../src/lib/prisma");
  const { isEmailConfigured, fromAddress } = await import("../src/lib/resend");
  const { sendCampaign, sendConfirmationEmail, sendWelcomeEmail } = await import(
    "../src/lib/newsletter-send"
  );

  console.log(`Expéditeur : ${fromAddress()}`);
  if (!isEmailConfigured()) {
    console.warn(
      "RESEND_API_KEY absente : les envois seront refusés (les lignes seront marquées FAILED).",
    );
  }
  console.log("");

  try {
    if (args.mode === "campaign") {
      const summary = await sendCampaign(args.id, {
        onProgress: (message) => console.log(message),
      });

      console.log("");
      if (!summary.ok) {
        console.error(`Envoi impossible : ${summary.error}`);
        process.exitCode = 1;
        return;
      }

      console.log(
        `Résumé : ${summary.sent} envoyé(s), ${summary.failed} échec(s), ${summary.skipped} déjà servi(s) sur ${summary.recipients} destinataire(s) — statut ${summary.status}.`,
      );
      if (summary.recipients === 0) {
        console.warn(
          "Aucun abonné CONFIRMED dans cette liste : la campagne a été marquée SENT sans destinataire.",
        );
      }
      // Un échec partiel n'est pas un incident de script : le résumé suffit.
      // On pose `exitCode` au lieu d'appeler `process.exit` : couper le processus
      // juste après un `console.log` sur un tube (stdout capturé) plante Node sous
      // Windows (STATUS_STACK_BUFFER_OVERRUN, 0xC0000409).
      process.exitCode = 0;
      return;
    }

    const subscriber = await prisma.newsletterSubscriber.findUnique({
      where: { id: args.id },
      select: { id: true, email: true, name: true, confirmationToken: true, status: true },
    });

    if (!subscriber) {
      console.error(`Abonné introuvable : ${args.id}`);
      process.exitCode = 1;
      return;
    }

    const result =
      args.mode === "confirmation"
        ? await sendConfirmationEmail(subscriber)
        : await sendWelcomeEmail(subscriber);

    if (!result.success) {
      console.error(`Envoi impossible : ${result.error}`);
      process.exitCode = 1;
      return;
    }

    console.log(
      `${args.mode === "confirmation" ? "E-mail de confirmation" : "E-mail de bienvenue"} envoyé à ${subscriber.email} (id fournisseur : ${result.id ?? "inconnu"}).`,
    );
    process.exitCode = 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("ERREUR:", error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
