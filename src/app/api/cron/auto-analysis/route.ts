import { timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const WINDOW = 48 * 60 * 60 * 1000;
const headers = { "Cache-Control": "no-store" };
function json(value: unknown, status = 200) { return NextResponse.json(value, { status, headers }); }
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return json({ success: false, error: "Cron non configuré." }, 503);
  const supplied = Buffer.from(request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1]?.trim() ?? "");
  const expected = Buffer.from(secret);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return json({ success: false, error: "Jeton invalide." }, 401);
  try {
    const { prisma } = await import("@/lib/prisma");
    const now = new Date(), since = new Date(now.getTime() - WINDOW);
    const latest = await prisma.article.findFirst({ where: { autoAnalysisKey: { not: null }, createdAt: { gte: since } }, select: { id: true } });
    if (latest) return json({ success: true, generated: false, reason: "already_generated", articleId: latest.id });
    const matches = await prisma.match.findMany({
      where: { status: "FINISHED", OR: [{ finishedAt: { gte: since, lte: now } }, { finishedAt: null, scheduledAt: { gte: since, lte: now } }], articles: { none: { autoAnalysisKey: { not: null } } } },
      include: { homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } }, competition: { select: { name: true } }, statistics: true, events: { orderBy: { minute: "asc" }, take: 100 } },
      orderBy: [{ statistics: { _count: "desc" } }, { scheduledAt: "desc" }, { id: "asc" }], take: 100,
    });
    const ranked = matches.map(match => {
      const goals = (match.homeScore ?? 0) + (match.awayScore ?? 0);
      const metrics = match.statistics.reduce((sum, row) => sum + [row.possession, row.shots, row.shotsOnTarget, row.corners, row.fouls, row.yellowCards, row.redCards].filter(value => value !== null).length, 0);
      return { match, goals, metrics, score: metrics * 2 + goals * 3 };
    }).filter(item => item.match.homeScore !== null && item.match.awayScore !== null && (item.goals >= 4 || item.metrics >= 6)).sort((a,b) => b.score-a.score || b.match.scheduledAt.getTime()-a.match.scheduledAt.getTime());
    const match = ranked[0]?.match;
    if (!match) return json({ success: true, generated: false, reason: "no_major_match" });
    const [author, category, theme] = await Promise.all([
      prisma.author.findFirst({ where: { role: { in: ["ADMIN", "EDITOR"] }, ...(process.env.AUTO_ANALYSIS_AUTHOR_ID?.trim() ? { id: process.env.AUTO_ANALYSIS_AUTHOR_ID.trim() } : {}) }, orderBy: { createdAt: "asc" }, select: { id: true } }),
      prisma.category.findUnique({ where: { slug: "football" }, select: { id: true } }),
      prisma.theme.findFirst({ where: { slug: { in: ["analyse", "analyses", "tactique"] } }, orderBy: { slug: "asc" }, select: { id: true } }),
    ]);
    if (!author || !category) return json({ success: true, generated: false, reason: "missing_editorial_configuration" });
    const { generateMatchAnalysis } = await import("@/lib/ai");
    const generated = await generateMatchAnalysis({ id: match.id, homeTeam: match.homeTeam.name, awayTeam: match.awayTeam.name, homeScore: match.homeScore!, awayScore: match.awayScore!, competition: match.competition.name, scheduledAt: match.scheduledAt.toISOString(), statistics: match.statistics.map(({teamId,possession,shots,shotsOnTarget,corners,fouls,yellowCards,redCards}) => ({team:teamId === match.homeTeamId ? match.homeTeam.name : match.awayTeam.name,possession,shots,shotsOnTarget,corners,fouls,yellowCards,redCards})), events: match.events.map(event => ({type:event.type,minute:event.minute,extraMinute:event.extraMinute,player:event.playerName,team:event.teamId === match.homeTeamId ? match.homeTeam.name : match.awayTeam.name})) });
    const published = process.env.AUTO_PUBLISH_ANALYSIS === "true";
    // A unique 48-hour key makes concurrent requests unable to create two articles.
    const key = `period-${Math.floor(now.getTime()/WINDOW)}`;
    const article = await prisma.article.create({ data: { title: generated.title, excerpt: generated.excerpt, content: generated.content, slug: `analyse-auto-${key}`, autoAnalysisKey: key, format: "ANALYSIS", status: published ? "PUBLISHED" : "DRAFT", publishedAt: published ? now : null, authorId: author.id, categoryId: category.id, matchId: match.id, ...(theme ? { themes: { connect: { id: theme.id } } } : {}) }, select: { id: true } });
    const { revalidatePath } = await import("next/cache");
    revalidatePath("/studio/articles");
    if (published) {
      revalidatePath("/"); revalidatePath(`/match/${match.id}`); revalidatePath("/themes");
      after(async () => {
        const [{ notifyArticleFollowers }, { distributeArticleSocialPosts }] = await Promise.all([import("@/lib/notifications"), import("@/lib/distribution")]);
        await Promise.allSettled([notifyArticleFollowers(article.id), distributeArticleSocialPosts(article.id)]);
      });
    }
    return json({ success: true, generated: true, articleId: article.id, matchId: match.id, status: published ? "PUBLISHED" : "DRAFT" });
  } catch (error) {
    if ((error as {code?:string}).code === "P2002") return json({ success: true, generated: false, reason: "already_generated" });
    console.error("[cron/auto-analysis] Analyse indisponible.");
    return json({ success: false, error: "Impossible de générer l’analyse. Aucun article incomplet n’a été enregistré." }, 500);
  }
}
