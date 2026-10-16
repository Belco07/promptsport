import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/seo";

export const runtime = "nodejs";
export const revalidate = 300;

function calendarText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}
function stamp(date: Date) { return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); }
/** RFC 5545: fold at 75 octets, without cutting a Unicode code point. */
function foldCalendarLine(line: string) {
  let output = "", current = "", bytes = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > 75) { output += current + "\r\n"; current = " "; bytes = 1; }
    current += character; bytes += size;
  }
  return output + current;
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const upcoming = { scheduledAt: { gt: new Date() }, status: { in: ["SCHEDULED", "POSTPONED"] as ("SCHEDULED" | "POSTPONED")[] } };
  const club = await prisma.team.findUnique({ where: { slug }, select: {
    name: true, slug: true,
    homeMatches: { where: upcoming, include: { homeTeam: true, awayTeam: true, competition: true }, orderBy: { scheduledAt: "asc" } },
    awayMatches: { where: upcoming, include: { homeTeam: true, awayTeam: true, competition: true }, orderBy: { scheduledAt: "asc" } },
  } });
  if (!club) return new Response("Club introuvable", { status: 404 });
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PromptSport//Club calendar//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${calendarText(club.name)}`];
  for (const match of [...club.homeMatches, ...club.awayMatches].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())) {
    const hasScore = match.homeScore !== null && match.awayScore !== null;
    lines.push("BEGIN:VEVENT", `UID:${match.id}@promptsport.net`, `DTSTAMP:${stamp(match.updatedAt)}`, `LAST-MODIFIED:${stamp(match.updatedAt)}`,
      `DTSTART:${stamp(match.scheduledAt)}`, `DURATION:PT2H`,
      `SUMMARY:${calendarText(`${match.homeTeam.name} – ${match.awayTeam.name}${hasScore ? ` (${match.homeScore}-${match.awayScore})` : ""}`)}`,
      `DESCRIPTION:${calendarText(`${match.competition.name}. Durée indicative : 2 heures.${match.status === "POSTPONED" ? " Match reporté : date à confirmer." : ""}`)}`,
      `STATUS:${match.status === "CANCELLED" ? "CANCELLED" : match.status === "POSTPONED" ? "TENTATIVE" : "CONFIRMED"}`,
      `URL:${absoluteUrl(`/match/${match.id}`)}`, "TRANSP:TRANSPARENT");
    if (match.venue) lines.push(`LOCATION:${calendarText(match.venue)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return new Response(lines.map(foldCalendarLine).join("\r\n") + "\r\n", { headers: {
    "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="${club.slug.replace(/[^a-z0-9-]/gi, "")}.ics"`,
    "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff",
  } });
}
