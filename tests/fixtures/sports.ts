import { test as base, expect } from "@playwright/test";
import { hash } from "bcryptjs";
import { closeDb, e2eId, sql } from "./db";

type Sports = { competitionId: string; homeId: string; awayId: string; matchId: string; playerId: string; playerName: string; homeName: string; awayName: string; user: { email: string; password: string; name: string } };
/** Each test owns its reader, competition, teams, player and match; no shared follows/votes. */
export const test = base.extend<{ sports: Sports }>({
  sports: async ({}, use) => {
    const competitionId = e2eId("wp36-competition"), homeId = e2eId("wp36-home"), awayId = e2eId("wp36-away"), matchId = e2eId("wp36-match"), playerId = e2eId("wp36-player"), readerId = e2eId("wp36-reader");
    const homeName = `Club Maison ${homeId.slice(-8)}`, awayName = `Club Visiteur ${awayId.slice(-8)}`, playerName = `Buteur ${playerId.slice(-8)}`;
    const user = { email: `${readerId}@example.test`, password: "E2e-Wp36-2026!", name: readerId };
    try {
      await sql('INSERT INTO "Author"(id,name,email,"passwordHash",role,"createdAt") VALUES($1,$2,$3,$4,\'READER\',NOW())', [readerId, user.name, user.email, await hash(user.password, 10)]);
      await sql('INSERT INTO "Competition"(id,name,slug,sport,"createdAt","updatedAt") VALUES($1,\'Compétition WP36\',$1,\'football\',NOW(),NOW())', [competitionId]);
      await sql('INSERT INTO "Team"(id,name,slug,sport,"createdAt","updatedAt") VALUES($1,$2,$1,\'football\',NOW(),NOW()),($3,$4,$3,\'football\',NOW(),NOW())', [homeId, homeName, awayId, awayName]);
      await sql('INSERT INTO "Player"(id,name,slug,"teamId","createdAt","updatedAt") VALUES($1,$2,$1,$3,NOW(),NOW())', [playerId, playerName, homeId]);
      await sql('INSERT INTO "Match"(id,"competitionId","homeTeamId","awayTeamId",status,"homeScore","awayScore","scheduledAt","createdAt","updatedAt") VALUES($1,$2,$3,$4,\'FINISHED\',2,1,NOW()-INTERVAL \'2 hours\',NOW(),NOW())', [matchId, competitionId, homeId, awayId]);
      await sql('INSERT INTO "MatchEvent"(id,"matchId","teamId","playerName",type,minute) VALUES($1,$2,$3,$4,\'GOAL\',25)', [e2eId("wp36-goal"), matchId, homeId, playerName]);
      await use({ competitionId, homeId, awayId, matchId, playerId, playerName, homeName, awayName, user });
    } finally {
      try {
        await sql('DELETE FROM "ManOfTheMatchVote" WHERE "matchId"=$1', [matchId]);
        await sql('DELETE FROM "Match" WHERE id=$1', [matchId]);
        await sql('DELETE FROM "Author" WHERE id=$1', [readerId]);
        await sql('DELETE FROM "Player" WHERE id=$1', [playerId]);
        await sql('DELETE FROM "Team" WHERE id IN ($1,$2)', [homeId, awayId]);
        await sql('DELETE FROM "Competition" WHERE id=$1', [competitionId]);
      } finally { await closeDb(); }
    }
  },
});
export { expect };
