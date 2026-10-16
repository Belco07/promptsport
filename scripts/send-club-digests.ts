export {};

/**
 * Preview (no email): npx tsx scripts/send-club-digests.ts
 * One bounded batch: npx tsx scripts/send-club-digests.ts --send --limit=20
 * Designated test only: npx tsx scripts/send-club-digests.ts --test-to=name@example.com --club=arsenal
 *
 * Weekly scheduling intentionally remains external: the WP26 write scope does
 * not authorize a workflow or a cron HTTP endpoint. On Monday, run --send until
 * eligible=0; weekly database reservations prevent duplicate deliveries.
 * RESERVED/FAILED deliveries require manual inspection, never automatic retry.
 */
async function main() {
  try { process.loadEnvFile(); } catch { /* Host environment may provide configuration. */ }
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--send" && !/^--(limit|test-to|club)=.+$/.test(arg))) throw new Error("Argument inconnu.");
  const value = (key: string) => args.find(arg => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
  const { prisma } = await import("../src/lib/prisma");
  try {
    const { sendClubDigests, buildClubDigest } = await import("../src/lib/club-digest");
    const testTo = value("test-to");
    if (testTo) {
      if (args.includes("--send") || !value("club") || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testTo)) throw new Error("Test : fournir --test-to=email et --club=slug, sans --send.");
      const club = await prisma.team.findUnique({ where: { slug: value("club")! }, select: { id: true, name: true, slug: true } });
      if (!club) throw new Error("Club introuvable.");
      const { renderClubDigestEmail } = await import("../src/lib/email-templates");
      const { sendEmail } = await import("../src/lib/resend");
      const result = await sendEmail({ to: testTo, subject: `[TEST] La semaine de ${club.name}`, ...renderClubDigestEmail(await buildClubDigest(club)) });
      if (!result.success) throw new Error(result.error);
      console.log("Email de test envoyé uniquement au destinataire indiqué.");
      return;
    }
    const limit = Number(value("limit") ?? 20);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("La limite doit être comprise entre 1 et 50.");
    const result = await sendClubDigests({ send: args.includes("--send"), limit });
    console.log(JSON.stringify(result));
    if (result.failed) process.exitCode = 1;
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Échec du digest."); process.exitCode = 1; });
