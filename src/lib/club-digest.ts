import { unstable_cache } from "next/cache";
import { setTimeout as pause } from "node:timers/promises";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail, isEmailConfigured } from "@/lib/resend";
import { renderClubDigestEmail, type ClubDigestEmail } from "@/lib/email-templates";

type Fixture = { id: string; home: string; away: string; homeScore: number | null; awayScore: number | null; scheduledAt: string };
export type ClubPulseData = {
  next: Fixture | null; last: Fixture | null; form: { matchId: string; result: string }[];
  redCards: { playerName: string; scheduledAt: string }[];
  mercato: { title: string; slug: string } | null;
  editorial: { title: string; slug: string } | null;
  scorer: { playerName: string; goals: number } | null;
};
const fixtureJson = Prisma.raw(`jsonb_build_object('id',m.id,'home',h.name,'away',a.name,'homeScore',m."homeScore",'awayScore',m."awayScore",'scheduledAt',to_char(m."scheduledAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`);

const articleMentionsClub = Prisma.raw(`(EXISTS (SELECT 1 FROM "Match" linked WHERE linked.id=a."matchId" AND (linked."homeTeamId"=t.id OR linked."awayTeamId"=t.id))
  OR EXISTS (SELECT 1 FROM (VALUES (t.name),(t."shortName")) AS terms(term) WHERE length(trim(term))>=3
    AND strpos(' ' || regexp_replace(lower(concat_ws(' ',a.title,a.content)), '[^[:alnum:]]+', ' ', 'g') || ' ',
      ' ' || trim(regexp_replace(lower(term), '[^[:alnum:]]+', ' ', 'g')) || ' ')>0))`);

/** One SQL statement per public Pulse section; no sports-provider requests. */
export async function loadClubPulse(clubId: string) {
  const rows = await prisma.$queryRaw<ClubPulseData[]>(Prisma.sql`
    SELECT
    (SELECT ${fixtureJson} FROM "Match" m JOIN "Team" h ON h.id=m."homeTeamId" JOIN "Team" a ON a.id=m."awayTeamId"
      WHERE (m."homeTeamId"=${clubId} OR m."awayTeamId"=${clubId}) AND m.status='SCHEDULED' AND m."scheduledAt">NOW() ORDER BY m."scheduledAt", m.id LIMIT 1) AS next,
    (SELECT ${fixtureJson} FROM "Match" m JOIN "Team" h ON h.id=m."homeTeamId" JOIN "Team" a ON a.id=m."awayTeamId"
      WHERE (m."homeTeamId"=${clubId} OR m."awayTeamId"=${clubId}) AND m.status='FINISHED' ORDER BY m."scheduledAt" DESC, m.id LIMIT 1) AS last,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('matchId', f.id, 'result', f.result) ORDER BY f."scheduledAt" DESC, f.id) FROM
      (SELECT m.id, m."scheduledAt", CASE WHEN m."homeScore" IS NULL OR m."awayScore" IS NULL THEN '—'
       WHEN m."homeScore"=m."awayScore" THEN 'N' WHEN (m."homeTeamId"=${clubId} AND m."homeScore">m."awayScore") OR (m."awayTeamId"=${clubId} AND m."awayScore">m."homeScore") THEN 'V' ELSE 'D' END result
       FROM "Match" m WHERE (m."homeTeamId"=${clubId} OR m."awayTeamId"=${clubId}) AND m.status='FINISHED' ORDER BY m."scheduledAt" DESC, m.id LIMIT 5) f), '[]') AS form,
    COALESCE((SELECT jsonb_agg(r) FROM (SELECT e."playerName", m."scheduledAt" FROM "MatchEvent" e JOIN "Match" m ON m.id=e."matchId"
      WHERE e."teamId"=${clubId} AND e.type='RED_CARD' AND m."scheduledAt">NOW()-INTERVAL '14 days' AND m."scheduledAt"<=NOW()
      ORDER BY m."scheduledAt" DESC LIMIT 5) r), '[]') AS "redCards",
    (SELECT jsonb_build_object('title',a.title,'slug',a.slug) FROM "Article" a JOIN "Team" t ON t.id=${clubId}
      WHERE a.status='PUBLISHED' AND a."publishedAt"<=NOW() AND EXISTS
       (SELECT 1 FROM "_ArticleToTheme" at JOIN "Theme" th ON th.id=at."B" WHERE at."A"=a.id AND lower(th.slug)='mercato')
      AND ${articleMentionsClub} ORDER BY a."publishedAt" DESC, a.id LIMIT 1) AS mercato,
    (SELECT jsonb_build_object('title',a.title,'slug',a.slug) FROM "Article" a JOIN "Team" t ON t.id=${clubId}
      WHERE a.status='PUBLISHED' AND a."publishedAt"<=NOW() AND a."publishedAt">NOW()-INTERVAL '7 days'
      AND ${articleMentionsClub} ORDER BY a."publishedAt" DESC, a.id LIMIT 1) AS editorial,
    (SELECT jsonb_build_object('playerName',e."playerName",'goals',count(*)) FROM "MatchEvent" e JOIN "Match" m ON m.id=e."matchId"
      WHERE e."teamId"=${clubId} AND e.type='GOAL' AND m."scheduledAt">NOW()-INTERVAL '7 days' AND m."scheduledAt"<=NOW()
      GROUP BY e."playerName" ORDER BY count(*) DESC, e."playerName" LIMIT 1) AS scorer
  `);
  return rows[0];
}
export const getClubPulse = unstable_cache(loadClubPulse, ["club-pulse-v2"], { revalidate: 300 });


/** The two opponents' recent results, loaded together in one statement. */
export const getTeamForms = unstable_cache(async (teamIds: string[]) => {
  if (!teamIds.length) return [];
  return prisma.$queryRaw<{ teamId: string; form: ClubPulseData["form"] }[]>(Prisma.sql`
    SELECT t.id AS "teamId", COALESCE((SELECT jsonb_agg(jsonb_build_object('matchId', f.id, 'result', f.result) ORDER BY f."scheduledAt" DESC, f.id)
      FROM (SELECT m.id,m."scheduledAt",CASE WHEN m."homeScore" IS NULL OR m."awayScore" IS NULL THEN '—'
        WHEN m."homeScore"=m."awayScore" THEN 'N'
        WHEN (m."homeTeamId"=t.id AND m."homeScore">m."awayScore") OR (m."awayTeamId"=t.id AND m."awayScore">m."homeScore") THEN 'V' ELSE 'D' END AS result
        FROM "Match" m WHERE (m."homeTeamId"=t.id OR m."awayTeamId"=t.id) AND m.status='FINISHED' AND m."scheduledAt"<=NOW()
        ORDER BY m."scheduledAt" DESC,m.id LIMIT 5) f), '[]') AS form
    FROM "Team" t WHERE t.id IN (${Prisma.join(teamIds)})
  `);
}, ["match-team-forms-v1"], { revalidate: 300 });

export type MatchVoteData = {
  id: string; status: string; choice: string | null;
  candidates: { id: string; name: string; club: string }[];
  results: { id: string; name: string; votes: number }[];
};
/** Eligibility comes from the actual starting XI or recorded events, not the entire squad. */
export async function getMatchVoteData(matchId: string, readerId: string | null = null) {
  const rows = await prisma.$queryRaw<MatchVoteData[]>(Prisma.sql`
    SELECT m.id,m.status,
    (SELECT v."playerId" FROM "ManOfTheMatchVote" v WHERE v."matchId"=m.id AND v."readerId"=${readerId}) AS choice,
    COALESCE((SELECT jsonb_agg(c ORDER BY c.club,c.name,c.id) FROM (SELECT p.id,p.name,t.name AS club FROM "Player" p JOIN "Team" t ON t.id=p."teamId"
      WHERE p."teamId" IN (m."homeTeamId",m."awayTeamId") AND (
        EXISTS (SELECT 1 FROM "MatchLineup" l, jsonb_array_elements(CASE WHEN jsonb_typeof(l.starters)='array' THEN l.starters ELSE '[]'::jsonb END) x
          WHERE l."matchId"=m.id AND l."teamId"=p."teamId" AND lower(trim(x->>'name'))=lower(trim(p.name)))
        OR EXISTS (SELECT 1 FROM "MatchEvent" e WHERE e."matchId"=m.id AND e."teamId"=p."teamId" AND lower(trim(e."playerName"))=lower(trim(p.name)))
      )) c),'[]') AS candidates,
    COALESCE((SELECT jsonb_agg(r ORDER BY r.votes DESC,r.name,r.id) FROM (SELECT p.id,p.name,count(*)::int AS votes FROM "ManOfTheMatchVote" v JOIN "Player" p ON p.id=v."playerId"
      WHERE v."matchId"=m.id GROUP BY p.id,p.name ORDER BY count(*) DESC,p.name,p.id LIMIT 3) r),'[]') AS results
    FROM "Match" m WHERE m.id=${matchId}
  `);
  return rows[0] ?? null;
}

export async function getClubRivalry(clubId: string) {
  return (await prisma.$queryRaw<{ name: string; slug: string; fixtures: Fixture[]; derby: Fixture | null }[]>(Prisma.sql`
    SELECT t.name,t.slug,
    COALESCE((SELECT jsonb_agg(raw.item ORDER BY raw."scheduledAt" DESC) FROM
      (SELECT ${fixtureJson} AS item,m."scheduledAt" FROM "Match" m JOIN "Team" h ON h.id=m."homeTeamId" JOIN "Team" a ON a.id=m."awayTeamId"
       WHERE ((m."homeTeamId"=${clubId} AND m."awayTeamId"=t.id) OR (m."awayTeamId"=${clubId} AND m."homeTeamId"=t.id)) AND m.status='FINISHED'
       ORDER BY m."scheduledAt" DESC,m.id LIMIT 5) raw), '[]') AS fixtures,
    (SELECT ${fixtureJson} FROM "Match" m JOIN "Team" h ON h.id=m."homeTeamId" JOIN "Team" a ON a.id=m."awayTeamId"
      WHERE ((m."homeTeamId"=${clubId} AND m."awayTeamId"=t.id) OR (m."awayTeamId"=${clubId} AND m."homeTeamId"=t.id)) AND m.status='SCHEDULED' AND m."scheduledAt">NOW()
      ORDER BY m."scheduledAt",m.id LIMIT 1) AS derby
    FROM "ClubRivalry" r JOIN "Team" t ON t.id=r."rivalClubId" WHERE r."clubId"=${clubId} ORDER BY r."createdAt",r.id LIMIT 1
  `))[0] ?? null;
}

export function digestWeek(date = new Date()) {
  // Monday in Africa/Lagos (UTC+1, no daylight saving time).
  const local = new Date(date.getTime() + 3600000);
  local.setUTCDate(local.getUTCDate() - (local.getUTCDay() + 6) % 7);
  return local.toISOString().slice(0, 10);
}
const describe = (m: Fixture | null) => m ? `${m.home} ${m.homeScore === null || m.awayScore === null ? "–" : `${m.homeScore}–${m.awayScore}`} ${m.away} · ${new Date(m.scheduledAt).toLocaleString("fr-FR", { timeZone: "Africa/Lagos" })}` : "Aucun match enregistré.";

export async function buildClubDigest(club: { id: string; name: string; slug: string }): Promise<ClubDigestEmail> {
  const pulse = await loadClubPulse(club.id);
  const vote = pulse.last ? await getMatchVoteData(pulse.last.id) : null;
  return { clubName: club.name, clubSlug: club.slug, nextMatch: describe(pulse.next), lastResult: describe(pulse.last),
    topScorer: pulse.scorer ? `${pulse.scorer.playerName} · ${pulse.scorer.goals} but(s) enregistrés ces 7 derniers jours` : "Aucun buteur renseigné cette semaine.",
    article: pulse.editorial, manOfTheMatch: vote?.results.length ? vote.results.map(p => `${p.name} (${p.votes} vote(s))`).join(", ") : "Aucun vote pour le dernier match." };
}

/** Bounded batches, explicit consent, unique weekly reservation and no automatic ambiguous retry. */
export async function sendClubDigests(options: { send?: boolean; limit?: number } = {}) {
  const week = digestWeek();
  if (options.send && !isEmailConfigured()) throw new Error("RESEND_API_KEY absente : aucun envoi réservé.");
  const subscriptions = await prisma.$queryRaw<{ id: string; email: string; clubId: string; name: string; slug: string }[]>(Prisma.sql`
    SELECT s.id,a.email,t.id AS "clubId",t.name,t.slug FROM "ClubDigestSubscription" s JOIN "Author" a ON a.id=s."readerId" JOIN "Team" t ON t.id=s."clubId"
    WHERE s.enabled=true AND a."digestOptIn"=true AND (a."bannedUntil" IS NULL OR a."bannedUntil"<=NOW())
      AND EXISTS (SELECT 1 FROM "_ReaderFollowedTeams" f WHERE f."A"=a.id AND f."B"=t.id)
      AND NOT EXISTS (SELECT 1 FROM "ClubDigestDelivery" d WHERE d."subscriptionId"=s.id AND d.week=${week})
    ORDER BY s.id LIMIT ${Math.min(50, Math.max(1, options.limit ?? 20))}
  `);
  let sent = 0, failed = 0, skipped = 0;
  const rendered = new Map<string, ClubDigestEmail>();
  for (const subscription of subscriptions) {
    if (!options.send) continue;
    let digest = rendered.get(subscription.clubId);
    if (!digest) { digest = await buildClubDigest({ id: subscription.clubId, name: subscription.name, slug: subscription.slug }); rendered.set(subscription.clubId, digest); }
    // Recheck consent while reserving, so preferences changed during rendering are respected.
    const reserved = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      INSERT INTO "ClubDigestDelivery" (id,"subscriptionId",week,status)
      SELECT ${crypto.randomUUID()},s.id,${week},'RESERVED' FROM "ClubDigestSubscription" s JOIN "Author" a ON a.id=s."readerId"
      WHERE s.id=${subscription.id} AND s.enabled=true AND a."digestOptIn"=true
      AND (a."bannedUntil" IS NULL OR a."bannedUntil"<=NOW())
      AND EXISTS (SELECT 1 FROM "_ReaderFollowedTeams" f WHERE f."A"=a.id AND f."B"=s."clubId")
      ON CONFLICT ("subscriptionId",week) DO NOTHING RETURNING id
    `);
    if (!reserved.length) { skipped++; continue; }
    const email = renderClubDigestEmail(digest);
    const result = await sendEmail({ to: subscription.email, subject: `La semaine de ${subscription.name}`, ...email });
    await prisma.clubDigestDelivery.update({ where: { id: reserved[0].id }, data: result.success
      ? { status: "SENT", providerMessageId: result.id, sentAt: new Date() }
      : { status: "FAILED", error: result.error.slice(0, 500) } });
    if (result.success) sent++; else { failed++; break; }
    // Reuse Resend conservatively (default provider limit: avoid burst sends).
    await pause(600);
  }
  return { week, eligible: subscriptions.length, sent, failed, skipped, dryRun: !options.send };
}
