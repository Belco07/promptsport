/**
 * Calcul du classement d'une compétition à partir des matchs terminés.
 *
 * Barème classique : victoire = 3 points, nul = 1, défaite = 0.
 * Tri : points décroissants, puis différence de buts, puis buts marqués.
 */

export type StandingRow = {
  teamId: string;
  teamName: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
};

export type FinishedMatch = {
  homeTeamId: string;
  awayTeamId: string;
  homeTeam: { id: string; name: string };
  awayTeam: { id: string; name: string };
  homeScore: number | null;
  awayScore: number | null;
};

export function computeStandings(matches: FinishedMatch[]): StandingRow[] {
  const teams = new Map<string, StandingRow>();

  function getRow(teamId: string, teamName: string): StandingRow {
    let row = teams.get(teamId);
    if (!row) {
      row = {
        teamId,
        teamName,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        points: 0,
      };
      teams.set(teamId, row);
    }
    return row;
  }

  for (const match of matches) {
    // Seuls les matchs avec un score (terminés) comptent.
    if (match.homeScore == null || match.awayScore == null) {
      continue;
    }

    const home = getRow(match.homeTeamId, match.homeTeam.name);
    const away = getRow(match.awayTeamId, match.awayTeam.name);

    home.played += 1;
    away.played += 1;
    home.goalsFor += match.homeScore;
    home.goalsAgainst += match.awayScore;
    away.goalsFor += match.awayScore;
    away.goalsAgainst += match.homeScore;

    if (match.homeScore > match.awayScore) {
      home.won += 1;
      home.points += 3;
      away.lost += 1;
    } else if (match.homeScore < match.awayScore) {
      away.won += 1;
      away.points += 3;
      home.lost += 1;
    } else {
      home.drawn += 1;
      away.drawn += 1;
      home.points += 1;
      away.points += 1;
    }
  }

  const rows = [...teams.values()];
  for (const row of rows) {
    row.goalDifference = row.goalsFor - row.goalsAgainst;
  }

  rows.sort(
    (a, b) =>
      b.points - a.points ||
      b.goalDifference - a.goalDifference ||
      b.goalsFor - a.goalsFor ||
      a.teamName.localeCompare(b.teamName),
  );

  return rows;
}
