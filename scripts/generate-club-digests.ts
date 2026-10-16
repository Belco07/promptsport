export {};

/**
 * Preview: npx tsx scripts/generate-club-digests.ts
 * Send one bounded batch: ... --send --limit=20
 * Scheduler: ... --send --due (Sunday, after 20:00 Africa/Lagos)
 * One designated test email: ... --test-to=reader@example.com --club=arsenal-fc
 * Reuses the existing weekly delivery ledger; never recreates subscriptions.
 */
async function runClubDigests() {
  try { process.loadEnvFile(); } catch { /* Host configuration may be used. */ }
  const args = process.argv.slice(2);
  if (args.some(arg => !["--send", "--due"].includes(arg) && !/^--(limit|test-to|club)=.+$/.test(arg))) throw new Error("Argument inconnu.");
  const value = (name: string) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const limit = Number(value("limit") ?? 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("Limite : 1 à 50.");
  if (args.includes("--due")) {
    const local = new Date(Date.now() + 3600000);
    if (local.getUTCDay() !== 0 || local.getUTCHours() < 20) { console.log("Hors du créneau du dimanche soir : aucun envoi."); return; }
  }
  const { prisma } = await import("../src/lib/prisma");
  try {
    const { sendClubDigests, buildClubDigest } = await import("../src/lib/club-digest");
    const to = value("test-to");
    if (to) {
      if (args.includes("--send") || !value("club") || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error("Test : --test-to=email --club=slug, sans --send.");
      const club = await prisma.team.findUnique({ where: { slug: value("club")! }, select: { id: true, name: true, slug: true } });
      if (!club) throw new Error("Club introuvable.");
      const { renderClubDigestEmail } = await import("../src/lib/email-templates");
      const { sendEmail } = await import("../src/lib/resend");
      const result = await sendEmail({ to, subject: `[TEST] La semaine de ${club.name}`, ...renderClubDigestEmail(await buildClubDigest(club)) });
      if (!result.success) throw new Error(result.error);
      console.log("Email de test envoyé au seul destinataire indiqué.");
      return;
    }
    const result = await sendClubDigests({ send: args.includes("--send"), limit });
    console.log(JSON.stringify(result));
    if (result.failed) process.exitCode = 1;
  } finally { await prisma.$disconnect(); }
}
runClubDigests().catch(error => { console.error(error instanceof Error ? error.message : "Échec du digest."); process.exitCode = 1; });
