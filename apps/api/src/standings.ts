import type { Env } from './types';

export type Tier = 'platinum' | 'gold' | 'silver' | 'bronze';

export interface StandingRow {
  teamId: number;
  teamName: string;
  pool: string | null;
  wins: number;
  losses: number;
  pointDifferential: number;
  tier: Tier | null;
}

interface TeamRow {
  id: number;
  name: string;
  pool: string | null;
  tier: Tier | null;
}

// Computes raw win/loss/point-differential stats from completed matches in a given
// stage (1 = Round 1 random-group pool play, 2 = Round 2 tier round-robin).
async function computeTeamStats(db: Env['DB'], tournamentId: string | number, stage: number) {
  const { results: teams } = await db
    .prepare('SELECT id, name, pool, tier FROM teams WHERE tournament_id = ?')
    .bind(tournamentId)
    .all<TeamRow>();

  const { results: matches } = await db
    .prepare(
      `SELECT team1_id, team2_id, winner_id, score_json FROM matches
       WHERE tournament_id = ? AND stage = ? AND status = 'completed'`
    )
    .bind(tournamentId, stage)
    .all<{ team1_id: number; team2_id: number; winner_id: number; score_json: string | null }>();

  const stats = new Map(
    teams.map((t) => [t.id, { team: t, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 }])
  );

  for (const m of matches) {
    const s1 = stats.get(m.team1_id);
    const s2 = stats.get(m.team2_id);
    if (!s1 || !s2) continue;
    if (m.winner_id === m.team1_id) {
      s1.wins++;
      s2.losses++;
    } else if (m.winner_id === m.team2_id) {
      s2.wins++;
      s1.losses++;
    }
    if (m.score_json) {
      try {
        const games = JSON.parse(m.score_json);
        if (Array.isArray(games)) {
          for (const g of games) {
            const t1 = typeof g?.team1 === 'number' && !isNaN(g.team1) ? g.team1 : 0;
            const t2 = typeof g?.team2 === 'number' && !isNaN(g.team2) ? g.team2 : 0;
            s1.pointsFor += t1;
            s1.pointsAgainst += t2;
            s2.pointsFor += t2;
            s2.pointsAgainst += t1;
          }
        }
      } catch {
        // Ignore unparseable score JSON
      }
    }
  }

  return [...stats.values()].map((s) => ({
    teamId: s.team.id,
    teamName: s.team.name,
    pool: s.team.pool,
    tier: s.team.tier,
    wins: s.wins,
    losses: s.losses,
    pointDifferential: s.pointsFor - s.pointsAgainst,
  }));
}

// Round 1 standings: grouped and sorted by pool, from the random-group pool-play matches.
// Only includes teams that have actually been assigned to a pool.
export async function computePoolStandings(db: Env['DB'], tournamentId: string | number): Promise<StandingRow[]> {
  const rows = await computeTeamStats(db, tournamentId, 1);
  return rows
    .filter((r) => r.pool !== null)
    .sort(
      (a, b) =>
        (a.pool ?? '').localeCompare(b.pool ?? '') ||
        b.wins - a.wins ||
        b.pointDifferential - a.pointDifferential ||
        a.teamName.localeCompare(b.teamName)
    );
}

// Overall Round 1 ranking across all pools combined, used to assign Round 2 tiers.
export async function computeOverallRanking(db: Env['DB'], tournamentId: string | number): Promise<StandingRow[]> {
  const rows = await computeTeamStats(db, tournamentId, 1);
  return rows
    .filter((r) => r.pool !== null)
    .sort(
      (a, b) =>
        b.wins - a.wins ||
        b.pointDifferential - a.pointDifferential ||
        a.teamName.localeCompare(b.teamName)
    );
}

// Splits an overall ranking into `tierCount` tiers (with optional `teamsPerTier` teams per tier).
// Teams that do not fit into the tiers remain unassigned (tier = NULL / eliminated).
export function assignTiers(
  ranking: StandingRow[],
  tierCount: number = 4,
  teamsPerTier?: number
): Record<number, Tier> {
  const allTiers: Tier[] = ['platinum', 'gold', 'silver', 'bronze'];
  const count = Math.max(1, Math.min(4, tierCount));
  const activeTiers = allTiers.slice(0, count);
  const n = ranking.length;
  const result: Record<number, Tier> = {};

  if (teamsPerTier && teamsPerTier > 0) {
    ranking.forEach((r, i) => {
      const tierIndex = Math.floor(i / teamsPerTier);
      if (tierIndex < count) {
        result[r.teamId] = activeTiers[tierIndex];
      }
    });
  } else {
    ranking.forEach((r, i) => {
      result[r.teamId] = activeTiers[Math.min(count - 1, Math.floor((i * count) / Math.max(n, 1)))];
    });
  }
  return result;
}

const TIER_ORDER: Record<string, number> = {
  platinum: 1,
  gold: 2,
  silver: 3,
  bronze: 4,
};

// Round 2 standings: grouped and sorted by tier (Platinum -> Gold -> Silver -> Bronze),
// from the tier round-robin matches. Uses Stage 1 (Round 1) wins and point differential
// as secondary tiebreakers so teams start ranked by their Round 1 qualification.
export async function computeTierStandings(db: Env['DB'], tournamentId: string | number): Promise<StandingRow[]> {
  const stage2Rows = await computeTeamStats(db, tournamentId, 2);
  const stage1Rows = await computeTeamStats(db, tournamentId, 1);
  const stage1Map = new Map(stage1Rows.map((r) => [r.teamId, r]));

  return stage2Rows
    .filter((r) => r.tier !== null)
    .sort((a, b) => {
      const tierDiff = (TIER_ORDER[a.tier ?? ''] ?? 99) - (TIER_ORDER[b.tier ?? ''] ?? 99);
      if (tierDiff !== 0) return tierDiff;

      const winsDiff = b.wins - a.wins;
      if (winsDiff !== 0) return winsDiff;

      const ptDiff = b.pointDifferential - a.pointDifferential;
      if (ptDiff !== 0) return ptDiff;

      // Tiebreaker from Round 1 (Stage 1) performance
      const s1A = stage1Map.get(a.teamId);
      const s1B = stage1Map.get(b.teamId);
      const s1WinsDiff = (s1B?.wins ?? 0) - (s1A?.wins ?? 0);
      if (s1WinsDiff !== 0) return s1WinsDiff;

      const s1PtDiff = (s1B?.pointDifferential ?? 0) - (s1A?.pointDifferential ?? 0);
      if (s1PtDiff !== 0) return s1PtDiff;

      return a.teamName.localeCompare(b.teamName);
    });
}
