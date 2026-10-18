export {};

/**
 * Preview only: npx tsx scripts/send-club-alerts.ts
 * Delivery: npx tsx scripts/send-club-alerts.ts --send --limit=20
 * One designated manual test: --send --reader=fixture@example.test --test-to=approved@example.com
 * Reservations survive restarts and provider failures; no automatic retry in 24h.
 * This CLI schedules nothing and never calls a sports API.
 */
async function main() {
  try { process.loadEnvFile(); } catch { /* Environment may already be set. */ }
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--send" && !/^--(limit|reader|test-to)=.+$/.test(arg))) throw new Error("Argument inconnu.");
  const value = (key: string) => args.find(arg => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
  const send = args.includes("--send"), testTo = value("test-to"), readerEmail = value("reader");
  if (testTo && (!send || !readerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testTo))) throw new Error("Test : fournir --send, --reader=email et --test-to=email. Aucun envoi collectif en mode test.");
  const limit = testTo ? 1 : Number(value("limit") ?? 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("La limite doit être comprise entre 1 et 100.");
  const { prisma } = await import("../src/lib/prisma");
  try {
    const { getClubAlertContent, reserveClubAlert, CLUB_ALERT_WINDOW_MS } = await import("../src/lib/notifications");
    const { renderClubAlertEmail } = await import("../src/lib/email-templates");
    const { sendEmail, isEmailConfigured } = await import("../src/lib/resend");
    if (send && !isEmailConfigured()) throw new Error("RESEND_API_KEY absente : aucun envoi ni réservation.");
    const now = new Date();
    let after: string | undefined;
    const result = { scanned: 0, eligible: 0, sent: 0, failed: 0, skipped: 0, preview: !send };
    while (result.eligible < limit) {
      const readers = await prisma.author.findMany({ where: {
        alertsEnabled: true, emailNotificationsEnabled: true,
        ...(readerEmail ? { email: readerEmail } : {}),
        AND: [{ OR: [{ bannedUntil: null }, { bannedUntil: { lte: now } }] }, { OR: [{ followedTeams: { some: {} } }, { favoriteClubId: { not: null } }] }],
        clubAlertDeliveries: { none: { createdAt: { gt: new Date(now.getTime() - CLUB_ALERT_WINDOW_MS) } } },
      }, select: { id: true, followedTeams: { select: { id: true } }, favoriteClubId: true }, orderBy: { id: "asc" }, take: 100, ...(after ? { cursor: { id: after }, skip: 1 } : {}) });
      if (!readers.length) break;
      for (const reader of readers) {
        after = reader.id;
        result.scanned++;
        if (!send) {
          const ids = [...new Set([...reader.followedTeams.map(club => club.id), ...(reader.favoriteClubId ? [reader.favoriteClubId] : [])])];
          const content = await getClubAlertContent(ids, now);
          if (content.articles.length || content.matches.length) result.eligible++;
        } else {
          const alert = await reserveClubAlert(reader.id);
          if (!alert) { result.skipped++; continue; }
          result.eligible++;
          const body = renderClubAlertEmail({ name: alert.reader.name, clubs: alert.clubs.map(club => club.name), articles: alert.articles,
            matches: alert.matches.map(match => ({ id: match.id, label: `${match.homeTeam.name} — ${match.awayTeam.name}`, details: `${match.scheduledAt.toLocaleString("fr-FR", { timeZone: "UTC", dateStyle: "long", timeStyle: "short" })} UTC${match.homeScore !== null && match.awayScore !== null && (match.status === "FINISHED" || match.status === "LIVE") ? ` · ${match.homeScore} – ${match.awayScore}` : ""}` })) });
          let outcome: Awaited<ReturnType<typeof sendEmail>>;
          try { outcome = await sendEmail({ to: testTo ?? alert.reader.email, subject: `${testTo ? "[TEST] " : ""}Vos alertes clubs — PromptSport`, ...body }); }
          catch { outcome = { success: false, error: "Réponse du fournisseur incertaine : aucun nouvel essai automatique." }; }
          // A crash before this update deliberately leaves RESERVED and blocks a duplicate.
          await prisma.clubAlertDelivery.update({ where: { id: alert.deliveryId }, data: outcome.success ? { status: "SENT", providerMessageId: outcome.id, sentAt: new Date() } : { status: "FAILED", error: outcome.error.slice(0, 500) } });
          if (outcome.success) result.sent++; else result.failed++;
        }
        if (result.eligible >= limit) break;
      }
      if (readers.length < 100) break;
    }
    console.log(JSON.stringify(result));
    if (result.failed) process.exitCode = 1;
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Échec des alertes."); process.exitCode = 1; });
