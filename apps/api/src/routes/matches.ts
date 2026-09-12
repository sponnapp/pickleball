import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAdmin, requireTournamentManager } from '../middleware';
import {
  generateSingleElimination,
  generateDoubleElimination,
  generateRoundRobin,
  generatePoolPlay,
  type BracketPlan,
  type MatchDraft,
  type LinkDraft,
} from '../bracket';
import { computeOverallRanking, computeTierStandings, assignTiers, type Tier } from '../standings';

export const matchRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

async function resolveMatchTournamentId(db: Env['DB'], matchId: string | undefined) {
  if (!matchId) return null;
  const row = await db.prepare('SELECT tournament_id FROM matches WHERE id = ?').bind(matchId).first<{ tournament_id: number }>();
  return row?.tournament_id ?? null;
}

// Inserts a bracket plan's matches (tagged with the given round `stage`) and resolves
// its advancement links to real row ids. Keying by stage keeps concurrent stages'
// (bracket_type, round, match_number) tuples from colliding with each other.
async function insertBracketPlan(db: Env['DB'], tournamentId: string | number, stage: number, plan: BracketPlan) {
  const idByKey = new Map<string, number>();
  const key = (bt: string, round: number, matchNumber: number) => `${bt}:${round}:${matchNumber}`;

  for (const m of plan.matches as MatchDraft[]) {
    const row = await db
      .prepare(
        `INSERT INTO matches (tournament_id, stage, bracket_type, round, match_number, team1_id, team2_id)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`
      )
      .bind(tournamentId, stage, m.bracket_type, m.round, m.match_number, m.team1_id, m.team2_id)
      .first<{ id: number }>();
    if (row) idByKey.set(key(m.bracket_type, m.round, m.match_number), row.id);
  }

  for (const link of plan.links as LinkDraft[]) {
    const fromId = idByKey.get(key(link.from.bracket_type, link.from.round, link.from.match_number));
    const toId = idByKey.get(key(link.to.bracket_type, link.to.round, link.to.match_number));
    if (!fromId || !toId) continue;
    await db
      .prepare('UPDATE matches SET next_match_id = ?, next_match_slot = ? WHERE id = ?')
      .bind(toId, link.to.slot, fromId)
      .run();
  }
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function parseStartDate(startDateStr: string | null | undefined): Date {
  if (!startDateStr || !startDateStr.trim()) {
    const d = new Date();
    d.setHours(9, 0, 0, 0);
    return d;
  }
  let str = startDateStr.trim();
  if (str.length === 10) {
    str += 'T09:00:00';
  } else if (str.includes(' ') && !str.includes('T')) {
    str = str.replace(' ', 'T');
  }
  const d = new Date(str);
  if (isNaN(d.getTime())) {
    const fallback = new Date();
    fallback.setHours(9, 0, 0, 0);
    return fallback;
  }
  return d;
}

function formatDateTimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());
  return `${year}-${month}-${day}T${hours}:${mins}`;
}

export async function autoScheduleMatches(
  db: Env['DB'],
  tournamentId: string | number,
  startTime?: string | null,
  endTime?: string | null,
  targetStage?: number | null
) {
  const tournament = await db
    .prepare('SELECT start_date, end_date FROM tournaments WHERE id = ?')
    .bind(tournamentId)
    .first<{ start_date: string | null; end_date: string | null }>();

  const startDate = parseStartDate(startTime || tournament?.start_date);
  const endDate = endTime
    ? parseStartDate(endTime)
    : tournament?.end_date
    ? parseStartDate(tournament.end_date)
    : null;

  let { results: courts } = await db
    .prepare('SELECT id, name FROM courts WHERE tournament_id = ? ORDER BY id ASC')
    .bind(tournamentId)
    .all<{ id: number; name: string }>();

  if (!courts || courts.length === 0) {
    const defaultCourt = await db
      .prepare("INSERT INTO courts (tournament_id, name) VALUES (?, 'Court 1') RETURNING id, name")
      .bind(tournamentId)
      .first<{ id: number; name: string }>();
    if (defaultCourt) {
      courts = [defaultCourt];
    }
  }

  if (!courts || courts.length === 0) return;

  const stageFilter = targetStage ? 'AND stage = ?' : '';
  const queryParams = targetStage ? [tournamentId, targetStage] : [tournamentId];

  const { results: matches } = await db
    .prepare(
      `SELECT id, stage, round, match_number, bracket_type
       FROM matches
       WHERE tournament_id = ? ${stageFilter}
       ORDER BY stage ASC, round ASC,
         CASE bracket_type
           WHEN 'pool' THEN 1
           WHEN 'platinum' THEN 2
           WHEN 'gold' THEN 3
           WHEN 'silver' THEN 4
           WHEN 'bronze' THEN 5
           ELSE 6
         END,
         match_number ASC`
    )
    .bind(...queryParams)
    .all<{ id: number; stage: number; round: number; match_number: number; bracket_type: string }>();

  if (!matches || matches.length === 0) return;

  const numCourts = courts.length;
  const numSlots = Math.ceil(matches.length / numCourts);

  let slotDurationMs = 20 * 60 * 1000;
  if (endDate && endDate.getTime() > startDate.getTime() && numSlots > 0) {
    const totalWindowMs = endDate.getTime() - startDate.getTime();
    const calculatedMinutes = Math.floor(totalWindowMs / (60 * 1000 * numSlots));
    slotDurationMs = Math.max(1, calculatedMinutes) * 60 * 1000;
  }

  let currentSlotCourts: { id: number; name: string }[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const slotIndex = Math.floor(i / numCourts);

    const matchTime = new Date(startDate.getTime() + slotIndex * slotDurationMs);
    const scheduledTime = formatDateTimeLocal(matchTime);

    let courtId: number;
    if (numCourts === 1) {
      courtId = courts[0].id;
    } else {
      if (i % numCourts === 0) {
        currentSlotCourts = shuffle([...courts]);
      }
      courtId = currentSlotCourts[i % numCourts].id;
    }

    await db
      .prepare('UPDATE matches SET court_id = ?, scheduled_time = ? WHERE id = ?')
      .bind(courtId, scheduledTime, match.id)
      .run();
  }
}

const POOL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

matchRoutes.get('/tournaments/:tournamentId/matches', async (c) => {
  const tournamentId = c.req.param('tournamentId');
  const { results } = await c.env.DB.prepare(
    `SELECT m.*, t1.name AS team1_name, t2.name AS team2_name, co.name AS court_name
     FROM matches m
     LEFT JOIN teams t1 ON t1.id = m.team1_id
     LEFT JOIN teams t2 ON t2.id = m.team2_id
     LEFT JOIN courts co ON co.id = m.court_id
     WHERE m.tournament_id = ?
     ORDER BY m.stage ASC, m.round ASC,
       CASE m.bracket_type
         WHEN 'pool' THEN 1
         WHEN 'platinum' THEN 2
         WHEN 'gold' THEN 3
         WHEN 'silver' THEN 4
         WHEN 'bronze' THEN 5
         ELSE 6
       END,
       m.match_number ASC`
  )
    .bind(tournamentId)
    .all();
  return c.json({ matches: results });
});

// Generates the full match schedule for a tournament based on its format.
// Regeneration is blocked once any match has results, to avoid wiping recorded scores.
matchRoutes.post('/tournaments/:tournamentId/generate-bracket', requireAdmin, requireTournamentManager(async (c) => c.req.param('tournamentId')), async (c) => {
  const tournamentId = c.req.param('tournamentId')!;
  const body = await c.req.json<{ startTime?: string; endTime?: string }>().catch(() => ({}) as { startTime?: string; endTime?: string });
  const tournament = await c.env.DB.prepare('SELECT * FROM tournaments WHERE id = ?')
    .bind(tournamentId)
    .first<{ id: number; format: string }>();
  if (!tournament) return c.json({ error: 'Tournament not found' }, 404);

  const existingCompleted = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM matches WHERE tournament_id = ? AND status != 'scheduled'`
  )
    .bind(tournamentId)
    .first<{ count: number }>();
  if (existingCompleted && existingCompleted.count > 0) {
    return c.json({ error: 'Cannot regenerate bracket: matches already have results' }, 409);
  }

  const { results: teamRows } = await c.env.DB.prepare(
    'SELECT id, seed, pool FROM teams WHERE tournament_id = ? ORDER BY seed IS NULL, seed ASC, id ASC'
  )
    .bind(tournamentId)
    .all<{ id: number; seed: number | null; pool: string | null }>();

  if (teamRows.length < 2) return c.json({ error: 'At least 2 teams are required to generate a bracket' }, 400);

  const teams = teamRows.map((t, i) => ({ id: t.id, seed: t.seed ?? i + 1, pool: t.pool ?? 'A' }));

  let plan;
  switch (tournament.format) {
    case 'single_elimination':
      plan = generateSingleElimination(teams);
      break;
    case 'double_elimination':
      plan = generateDoubleElimination(teams);
      break;
    case 'round_robin':
      plan = generateRoundRobin(teams);
      break;
    case 'pool_play':
      plan = generatePoolPlay(teams);
      break;
    default:
      return c.json({ error: `Unsupported format: ${tournament.format}` }, 400);
  }

  await c.env.DB.prepare('DELETE FROM matches WHERE tournament_id = ?').bind(tournamentId).run();
  await insertBracketPlan(c.env.DB, tournamentId, 1, plan);
  await autoScheduleMatches(c.env.DB, tournamentId, body.startTime, body.endTime, 1);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM matches WHERE tournament_id = ? ORDER BY bracket_type, round, match_number'
  )
    .bind(tournamentId)
    .all();
  return c.json({ matches: results }, 201);
});

async function blockIfCompleted(db: Env['DB'], tournamentId: string | number, stage: number) {
  const row = await db
    .prepare(`SELECT COUNT(*) as count FROM matches WHERE tournament_id = ? AND stage = ? AND status != 'scheduled'`)
    .bind(tournamentId, stage)
    .first<{ count: number }>();
  return row !== null && row.count > 0;
}

// Round 1: randomly splits all registered teams into `groupCount` even groups and
// generates a round-robin pool-play schedule within each group.
matchRoutes.post('/tournaments/:tournamentId/round1/generate-groups', requireAdmin, requireTournamentManager(async (c) => c.req.param('tournamentId')), async (c) => {
  const tournamentId = c.req.param('tournamentId')!;
  const body = await c.req.json<{ groupCount?: number; startTime?: string; endTime?: string }>().catch(() => ({}) as { groupCount?: number; startTime?: string; endTime?: string });
  const groupCount = Math.max(2, Math.min(26, body.groupCount ?? 4));

  if (await blockIfCompleted(c.env.DB, tournamentId, 1)) {
    return c.json({ error: 'Cannot regenerate Round 1: matches already have results' }, 409);
  }

  const { results: teamRows } = await c.env.DB.prepare('SELECT id FROM teams WHERE tournament_id = ?')
    .bind(tournamentId)
    .all<{ id: number }>();
  if (teamRows.length < 2) return c.json({ error: 'At least 2 teams are required' }, 400);

  const shuffled = shuffle(teamRows.map((t) => t.id));
  const groups: number[][] = Array.from({ length: groupCount }, () => []);
  shuffled.forEach((teamId, i) => groups[i % groupCount].push(teamId));

  for (let g = 0; g < groups.length; g++) {
    const pool = POOL_LETTERS[g];
    for (const teamId of groups[g]) {
      await c.env.DB.prepare('UPDATE teams SET pool = ? WHERE id = ?').bind(pool, teamId).run();
    }
  }

  await c.env.DB.prepare('DELETE FROM matches WHERE tournament_id = ? AND stage = 1').bind(tournamentId).run();

  for (let g = 0; g < groups.length; g++) {
    if (groups[g].length < 2) continue;
    // Each group's round-robin uses distinct match_numbers (offset by group index)
    // so all groups can share bracket_type 'pool' without match_number collisions;
    // which pool a match belongs to is derived via its teams' `pool` column.
    const plan = generateRoundRobin(
      groups[g].map((id) => ({ id, seed: 0 })),
      'pool'
    );
    plan.matches.forEach((m) => (m.match_number += g * 1000));
    await insertBracketPlan(c.env.DB, tournamentId, 1, plan);
  }

  await autoScheduleMatches(c.env.DB, tournamentId, body.startTime, body.endTime, 1);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM matches WHERE tournament_id = ? AND stage = 1 ORDER BY bracket_type, round, match_number'
  )
    .bind(tournamentId)
    .all();
  return c.json({ matches: results }, 201);
});

// Round 2: ranks all teams overall from Round 1 results, splits them into `tierCount` tiers
// (e.g. 2 tiers = Platinum & Gold; 4 tiers = Platinum, Gold, Silver, Bronze), and generates
// a tier round-robin schedule.
matchRoutes.post('/tournaments/:tournamentId/round2/generate-tiers', requireAdmin, requireTournamentManager(async (c) => c.req.param('tournamentId')), async (c) => {
  const tournamentId = c.req.param('tournamentId')!;
  const body = await c.req.json<{ tierCount?: number; teamsPerTier?: number; startTime?: string; endTime?: string }>().catch(() => ({}) as { tierCount?: number; teamsPerTier?: number; startTime?: string; endTime?: string });
  const tierCount = Math.max(1, Math.min(4, body.tierCount ?? 4));
  const teamsPerTier = body.teamsPerTier && body.teamsPerTier > 0 ? Number(body.teamsPerTier) : undefined;

  if (await blockIfCompleted(c.env.DB, tournamentId, 2)) {
    return c.json({ error: 'Cannot regenerate Round 2: matches already have results' }, 409);
  }

  const ranking = await computeOverallRanking(c.env.DB, tournamentId);
  if (ranking.length < 2) return c.json({ error: 'At least 2 teams with Round 1 results are required' }, 400);

  // Clear existing tier values from teams
  await c.env.DB.prepare('UPDATE teams SET tier = NULL WHERE tournament_id = ?').bind(tournamentId).run();

  const tierByTeam = assignTiers(ranking, tierCount, teamsPerTier);
  for (const [teamId, tier] of Object.entries(tierByTeam)) {
    await c.env.DB.prepare('UPDATE teams SET tier = ? WHERE id = ?').bind(tier, Number(teamId)).run();
  }

  const placedCount = Object.keys(tierByTeam).length;
  const eliminatedCount = ranking.length - placedCount;

  await c.env.DB.prepare('DELETE FROM matches WHERE tournament_id = ? AND stage = 2').bind(tournamentId).run();

  const allTiers: Tier[] = ['platinum', 'gold', 'silver', 'bronze'];
  const activeTiers = allTiers.slice(0, tierCount);
  const created: Record<string, number> = {};
  for (const tier of activeTiers) {
    const tierTeamIds = ranking.filter((r) => tierByTeam[r.teamId] === tier).map((r) => r.teamId);
    if (tierTeamIds.length < 2) continue;
    const plan = generateRoundRobin(
      tierTeamIds.map((id) => ({ id, seed: 0 })),
      tier
    );
    await insertBracketPlan(c.env.DB, tournamentId, 2, plan);
    created[tier] = tierTeamIds.length;
  }

  await autoScheduleMatches(c.env.DB, tournamentId, body.startTime, body.endTime, 2);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM matches WHERE tournament_id = ? AND stage = 2 ORDER BY bracket_type, round, match_number'
  )
    .bind(tournamentId)
    .all();
  return c.json({ tiers: created, placedCount, eliminatedCount, matches: results }, 201);
});

// Round 3/4: within each active tier, takes top qualifying teams (e.g. top 2 for straight final,
// top 4 for semifinal + final) from Round 2 tier standings into a knockout bracket.
matchRoutes.post('/tournaments/:tournamentId/round3/generate-knockout', requireAdmin, requireTournamentManager(async (c) => c.req.param('tournamentId')), async (c) => {
  const tournamentId = c.req.param('tournamentId')!;
  const body = await c.req.json<{ topCount?: number; startTime?: string; endTime?: string }>().catch(() => ({}) as { topCount?: number; startTime?: string; endTime?: string });
  const topCount = Math.max(2, Math.min(16, body.topCount ?? 4));

  if (await blockIfCompleted(c.env.DB, tournamentId, 3)) {
    return c.json({ error: 'Cannot regenerate Round 3/4: matches already have results' }, 409);
  }

  const standings = await computeTierStandings(c.env.DB, tournamentId);
  await c.env.DB.prepare('DELETE FROM matches WHERE tournament_id = ? AND stage = 3').bind(tournamentId).run();

  const tierTypes: Tier[] = ['platinum', 'gold', 'silver', 'bronze'];
  const created: Record<string, number> = {};
  for (const tier of tierTypes) {
    const tierTeams = standings.filter((s) => s.tier === tier);
    const qualifying = tierTeams.slice(0, topCount);
    if (qualifying.length < 2) continue;
    const plan = generateSingleElimination(qualifying.map((s, i) => ({ id: s.teamId, seed: i + 1 })));
    plan.matches.forEach((m) => (m.bracket_type = tier));
    plan.links.forEach((l) => {
      l.from.bracket_type = tier;
      l.to.bracket_type = tier;
    });
    await insertBracketPlan(c.env.DB, tournamentId, 3, plan);
    created[tier] = qualifying.length;
  }

  await autoScheduleMatches(c.env.DB, tournamentId, body.startTime, body.endTime, 3);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM matches WHERE tournament_id = ? AND stage = 3 ORDER BY bracket_type, round, match_number'
  )
    .bind(tournamentId)
    .all();
  return c.json({ tiers: created, matches: results }, 201);
});

// Explicit endpoint to trigger/re-trigger auto-scheduling of courts and 20-minute time slots for matches.
matchRoutes.post('/tournaments/:tournamentId/auto-schedule', requireAdmin, requireTournamentManager(async (c) => c.req.param('tournamentId')), async (c) => {
  const tournamentId = c.req.param('tournamentId')!;
  const body = await c.req.json<{ startTime?: string; endTime?: string; stage?: number }>().catch(() => ({}) as { startTime?: string; endTime?: string; stage?: number });
  await autoScheduleMatches(c.env.DB, tournamentId, body.startTime, body.endTime, body.stage);
  const { results } = await c.env.DB.prepare(
    `SELECT m.*, t1.name AS team1_name, t2.name AS team2_name, co.name AS court_name
     FROM matches m
     LEFT JOIN teams t1 ON t1.id = m.team1_id
     LEFT JOIN teams t2 ON t2.id = m.team2_id
     LEFT JOIN courts co ON co.id = m.court_id
     WHERE m.tournament_id = ?
     ORDER BY m.stage ASC, m.round ASC, m.match_number ASC`
  )
    .bind(tournamentId)
    .all();
  return c.json({ ok: true, matches: results });
});

// Final winner/runner-up and playoff match breakdown per tier for Round 3/4.
matchRoutes.get('/tournaments/:tournamentId/tier-results', async (c) => {
  const tournamentId = c.req.param('tournamentId');
  const { results } = await c.env.DB.prepare(
    `SELECT m.id, m.stage, m.bracket_type as tier, m.round, m.match_number, m.team1_id, m.team2_id, m.winner_id, m.status, m.score_json,
            t1.name as team1_name, t2.name as team2_name
     FROM matches m
     LEFT JOIN teams t1 ON t1.id = m.team1_id
     LEFT JOIN teams t2 ON t2.id = m.team2_id
     WHERE m.tournament_id = ? AND m.stage = 3
     ORDER BY m.bracket_type, m.round ASC, m.match_number ASC`
  )
    .bind(tournamentId)
    .all<{
      id: number;
      stage: number;
      tier: string;
      round: number;
      match_number: number;
      team1_id: number | null;
      team2_id: number | null;
      winner_id: number | null;
      status: string;
      score_json: string | null;
      team1_name: string | null;
      team2_name: string | null;
    }>();

  const matchesByTier = new Map<string, typeof results>();
  for (const row of results) {
    let list = matchesByTier.get(row.tier);
    if (!list) {
      list = [];
      matchesByTier.set(row.tier, list);
    }
    list.push(row);
  }

  const tierOrder: Record<string, number> = { platinum: 1, gold: 2, silver: 3, bronze: 4 };

  function formatScoreJson(scoreJson: string | null): string {
    if (!scoreJson) return '';
    try {
      const games = JSON.parse(scoreJson);
      if (!Array.isArray(games) || games.length === 0) return '';
      return games
        .filter((g) => g && typeof g.team1 === 'number' && typeof g.team2 === 'number')
        .map((g) => `${g.team1}-${g.team2}`)
        .join(', ');
    } catch {
      return '';
    }
  }

  const tierResults = [...matchesByTier.entries()]
    .sort(([a], [b]) => (tierOrder[a] ?? 99) - (tierOrder[b] ?? 99))
    .map(([tier, rows]) => {
      const maxRound = Math.max(...rows.map((r) => r.round));
      const finalMatch = rows.find((r) => r.round === maxRound);

      const winnerName =
        finalMatch && finalMatch.winner_id
          ? finalMatch.winner_id === finalMatch.team1_id
            ? finalMatch.team1_name
            : finalMatch.team2_name
          : null;
      const runnerUpName =
        finalMatch && finalMatch.winner_id
          ? finalMatch.winner_id === finalMatch.team1_id
            ? finalMatch.team2_name
            : finalMatch.team1_name
          : null;

      const roundCounts = new Map<number, number>();
      for (const r of rows) {
        roundCounts.set(r.round, (roundCounts.get(r.round) ?? 0) + 1);
      }

      const matches = rows.map((m) => {
        const isFinal = m.round === maxRound;
        const isSemi = m.round === maxRound - 1 && maxRound > 1;
        const isQuarter = m.round === maxRound - 2 && maxRound > 2;
        const totalInRound = roundCounts.get(m.round) ?? 1;

        let roundLabel = `Round ${m.round}`;
        if (isFinal) {
          roundLabel = 'Final';
        } else if (isSemi) {
          roundLabel = totalInRound > 1 ? `Semi-final ${m.match_number}` : 'Semi-final';
        } else if (isQuarter) {
          roundLabel = totalInRound > 1 ? `Quarter-final ${m.match_number}` : 'Quarter-final';
        }

        const mWinner = m.winner_id
          ? m.winner_id === m.team1_id
            ? m.team1_name
            : m.team2_name
          : null;
        const mLoser = m.winner_id
          ? m.winner_id === m.team1_id
            ? m.team2_name
            : m.team1_name
          : null;

        return {
          id: m.id,
          round: m.round,
          matchNumber: m.match_number,
          roundLabel,
          isFinal,
          isSemi,
          isQuarter,
          team1Name: m.team1_name,
          team2Name: m.team2_name,
          winnerName: mWinner,
          loserName: mLoser,
          score: formatScoreJson(m.score_json),
          status: m.status,
        };
      });

      return {
        tier,
        completed: finalMatch?.status === 'completed',
        winner: winnerName,
        runnerUp: runnerUpName,
        matches,
      };
    });

  return c.json({ tierResults });
});

matchRoutes.patch('/matches/:id', requireAdmin, requireTournamentManager((c) => resolveMatchTournamentId(c.env.DB, c.req.param('id'))), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Record<string, unknown>>();
  const allowed = ['court_id', 'scheduled_time', 'status', 'team1_id', 'team2_id'];
  const fields = Object.keys(body).filter((k) => allowed.includes(k));
  if (fields.length === 0) return c.json({ error: 'No valid fields to update' }, 400);

  const setClause = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => body[f]);
  await c.env.DB.prepare(`UPDATE matches SET ${setClause} WHERE id = ?`)
    .bind(...values, id)
    .run();
  const updated = await c.env.DB.prepare('SELECT * FROM matches WHERE id = ?').bind(id).first();
  return c.json({ match: updated });
});

// Records a completed match score and auto-advances the winner to the next match, if any.
// Date/time and valid score are strictly mandatory before declaring a winner.
matchRoutes.patch('/matches/:id/score', requireAdmin, requireTournamentManager((c) => resolveMatchTournamentId(c.env.DB, c.req.param('id'))), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{
    games: { team1: number; team2: number }[];
    winner_id: number;
    scheduled_time?: string;
  }>();

  const match = await c.env.DB.prepare('SELECT * FROM matches WHERE id = ?').bind(id).first<{
    id: number;
    scheduled_time: string | null;
    team1_id: number | null;
    team2_id: number | null;
    next_match_id: number | null;
    next_match_slot: number | null;
  }>();
  if (!match) return c.json({ error: 'Match not found' }, 404);

  const scheduledTime = body.scheduled_time ?? match.scheduled_time;
  if (!scheduledTime || !scheduledTime.trim()) {
    return c.json({ error: 'Date & time is mandatory before declaring winner' }, 400);
  }

  if (!Array.isArray(body.games) || body.games.length === 0) {
    return c.json({ error: 'Score is mandatory before declaring winner' }, 400);
  }

  for (const g of body.games) {
    if (
      !g ||
      typeof g.team1 !== 'number' ||
      isNaN(g.team1) ||
      typeof g.team2 !== 'number' ||
      isNaN(g.team2) ||
      g.team1 < 0 ||
      g.team2 < 0
    ) {
      return c.json({ error: 'Invalid game score format (e.g. 11-8, 11-9)' }, 400);
    }
  }

  if (!body.winner_id || (body.winner_id !== match.team1_id && body.winner_id !== match.team2_id)) {
    return c.json({ error: 'winner_id must be one of the two teams in this match' }, 400);
  }

  await c.env.DB.prepare(
    `UPDATE matches SET status = 'completed', score_json = ?, winner_id = ?, scheduled_time = ? WHERE id = ?`
  )
    .bind(JSON.stringify(body.games), body.winner_id, scheduledTime, id)
    .run();

  if (match.next_match_id && match.next_match_slot) {
    const column = match.next_match_slot === 1 ? 'team1_id' : 'team2_id';
    await c.env.DB.prepare(`UPDATE matches SET ${column} = ? WHERE id = ?`)
      .bind(body.winner_id, match.next_match_id)
      .run();
  }

  const updated = await c.env.DB.prepare('SELECT * FROM matches WHERE id = ?').bind(id).first();
  return c.json({ match: updated });
});
