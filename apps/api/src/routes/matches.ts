import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAdmin, requireTournamentManager } from '../middleware';
import {
  generateSingleElimination,
  generateCrossSeededSemifinals,
  generateDoubleElimination,
  generateRoundRobin,
  generatePoolPlay,
  type BracketPlan,
  type MatchDraft,
  type LinkDraft,
} from '../bracket';
import { computeOverallRanking, computeTierStandings, assignTiers, tiersForCount, type Tier } from '../standings';

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
      `SELECT m.id, m.stage, m.round, m.match_number, m.bracket_type,
              CASE
                WHEN m.stage = 1 THEN COALESCE(t1.pool, t2.pool, 'ungrouped')
                ELSE m.bracket_type
              END AS assignment_key
      FROM matches m
       LEFT JOIN teams t1 ON t1.id = m.team1_id
       LEFT JOIN teams t2 ON t2.id = m.team2_id
       WHERE m.tournament_id = ? ${stageFilter}
       ORDER BY m.stage ASC, assignment_key ASC, m.round ASC,
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
    .bind(...queryParams)
    .all<{
      id: number;
      stage: number;
      round: number;
      match_number: number;
      bracket_type: string;
      assignment_key: string;
    }>();

  if (!matches || matches.length === 0) return;

  const numCourts = courts.length;
  const groupKeys = [...new Set(matches.map((match) => `${match.stage}:${match.assignment_key}`))];
  const courtByGroup = new Map<string, number>();
  groupKeys.forEach((groupKey, index) => {
    courtByGroup.set(groupKey, courts[index % numCourts].id);
  });

  const matchesPerCourt = new Map<number, number>();
  for (const match of matches) {
    const courtId = courtByGroup.get(`${match.stage}:${match.assignment_key}`)!;
    matchesPerCourt.set(courtId, (matchesPerCourt.get(courtId) ?? 0) + 1);
  }
  const maxMatchesOnCourt = Math.max(...matchesPerCourt.values());
  const numSlots = maxMatchesOnCourt;

  let slotDurationMs = 20 * 60 * 1000;
  if (endDate && endDate.getTime() > startDate.getTime() && numSlots > 0) {
    const totalWindowMs = endDate.getTime() - startDate.getTime();
    const calculatedMinutes = Math.floor(totalWindowMs / (60 * 1000 * numSlots));
    slotDurationMs = Math.max(1, calculatedMinutes) * 60 * 1000;
  }

  const nextSlotByCourt = new Map<number, number>();

  for (const match of matches) {
    const courtId = courtByGroup.get(`${match.stage}:${match.assignment_key}`)!;
    const slotIndex = nextSlotByCourt.get(courtId) ?? 0;
    nextSlotByCourt.set(courtId, slotIndex + 1);

    const matchTime = new Date(startDate.getTime() + slotIndex * slotDurationMs);
    const scheduledTime = formatDateTimeLocal(matchTime);

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
        `SELECT m.*, t1.name AS team1_name, t2.name AS team2_name,
          t1.pool AS team1_pool, t2.pool AS team2_pool, co.name AS court_name
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
    .all<{
      id: number;
      stage: number;
      bracket_type: string;
      round: number;
      match_number: number;
      team1_pool: string | null;
      team2_pool: string | null;
      [key: string]: unknown;
    }>();

  const roundOnePoolMatches = results
    .filter((match) => match.stage === 1 && match.bracket_type === 'pool')
    .sort((a, b) =>
      a.round - b.round ||
      String(a.team1_pool ?? a.team2_pool ?? '').localeCompare(String(b.team1_pool ?? b.team2_pool ?? '')) ||
      a.match_number - b.match_number
    );
  const gameNumberByMatch = new Map(roundOnePoolMatches.map((match, index) => [match.id, index + 1]));
  const matches = results.map((match) => ({
    ...match,
    game_number: gameNumberByMatch.get(match.id) ?? match.match_number,
  }));

  return c.json({ matches });
});

matchRoutes.delete('/matches/:id', requireAdmin, requireTournamentManager((c) => resolveMatchTournamentId(c.env.DB, c.req.param('id'))), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid match id' }, 400);
  const match = await c.env.DB.prepare('SELECT id, tournament_id FROM matches WHERE id = ?')
    .bind(id)
    .first<{ id: number; tournament_id: number }>();
  if (!match) return c.json({ error: 'Match not found' }, 404);

  // Remove bracket pointers into this match before deleting the row.
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE matches SET next_match_id = NULL, next_match_slot = NULL WHERE next_match_id = ?').bind(id),
    c.env.DB.prepare('UPDATE matches SET loser_next_match_id = NULL, loser_next_match_slot = NULL WHERE loser_next_match_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM matches WHERE id = ?').bind(id),
  ]);
  return c.json({ ok: true });
});

matchRoutes.post('/tournaments/:tournamentId/matches', requireAdmin, requireTournamentManager(async (c) => c.req.param('tournamentId')), async (c) => {
  const tournamentId = c.req.param('tournamentId')!;
  const body = await c.req.json<{
    team1_id?: number;
    team2_id?: number;
    stage?: number;
    bracket_type?: string;
    round?: number;
    court_id?: number | null;
    scheduled_time?: string;
  }>();

  if (!Number.isInteger(body.team1_id) || !Number.isInteger(body.team2_id) || body.team1_id === body.team2_id) {
    return c.json({ error: 'Choose two different teams' }, 400);
  }
  const stage = Math.max(1, Math.min(4, Math.floor(body.stage ?? 1)));
  const round = Math.max(1, Math.floor(body.round ?? 1));
  const bracketType = body.bracket_type?.trim() || (stage === 1 ? 'pool' : 'main');
  const { results: teams } = await c.env.DB.prepare(
    'SELECT id FROM teams WHERE tournament_id = ? AND id IN (?, ?)'
  )
    .bind(tournamentId, body.team1_id, body.team2_id)
    .all<{ id: number }>();
  if (teams.length !== 2) return c.json({ error: 'Both teams must belong to this tournament' }, 400);

  if (body.court_id !== null && body.court_id !== undefined) {
    const court = await c.env.DB.prepare('SELECT id FROM courts WHERE id = ? AND tournament_id = ?')
      .bind(body.court_id, tournamentId)
      .first();
    if (!court) return c.json({ error: 'Court does not belong to this tournament' }, 400);
  }

  const nextNumber = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(match_number), 0) + 1 AS value FROM matches WHERE tournament_id = ? AND stage = ? AND bracket_type = ? AND round = ?'
  )
    .bind(tournamentId, stage, bracketType, round)
    .first<{ value: number }>();
  const match = await c.env.DB.prepare(
    `INSERT INTO matches
       (tournament_id, stage, bracket_type, round, match_number, team1_id, team2_id, court_id, scheduled_time)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
  )
    .bind(
      tournamentId,
      stage,
      bracketType,
      round,
      nextNumber?.value ?? 1,
      body.team1_id,
      body.team2_id,
      body.court_id ?? null,
      body.scheduled_time?.trim() || null
    )
    .first();
  return c.json({ match }, 201);
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
  const body = await c.req.json<{
    groupCount?: number;
    startTime?: string;
    endTime?: string;
    separateTeamIds?: number[];
  }>().catch(() => ({}) as { groupCount?: number; startTime?: string; endTime?: string; separateTeamIds?: number[] });
  const groupCount = Math.max(2, Math.min(26, body.groupCount ?? 4));

  if (await blockIfCompleted(c.env.DB, tournamentId, 1)) {
    return c.json({ error: 'Cannot regenerate Round 1: matches already have results' }, 409);
  }

  const { results: teamRows } = await c.env.DB.prepare('SELECT id FROM teams WHERE tournament_id = ?')
    .bind(tournamentId)
    .all<{ id: number }>();
  if (teamRows.length < 2) return c.json({ error: 'At least 2 teams are required' }, 400);

  const teamIds = teamRows.map((team) => team.id);
  const separateTeamIds = [...new Set(body.separateTeamIds ?? [])];
  if (separateTeamIds.some((teamId) => !teamIds.includes(teamId))) {
    return c.json({ error: 'All separated teams must belong to this tournament' }, 400);
  }

  const groups: number[][] = Array.from({ length: groupCount }, () => []);
  const separatedSet = new Set(separateTeamIds);
  const startGroup = Math.floor(Math.random() * groupCount);
  separateTeamIds.forEach((teamId, index) => {
    groups[(startGroup + index) % groupCount].push(teamId);
  });

  const remainingTeamIds = shuffle(teamIds.filter((teamId) => !separatedSet.has(teamId)));
  for (const teamId of remainingTeamIds) {
    const smallestGroupSize = Math.min(...groups.map((group) => group.length));
    const smallestGroups = groups
      .map((group, index) => ({ group, index }))
      .filter(({ group }) => group.length === smallestGroupSize);
    const target = smallestGroups[Math.floor(Math.random() * smallestGroups.length)];
    target.group.push(teamId);
  }

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
// (e.g. 2 tiers = Gold & Silver; 4 tiers = Platinum, Gold, Silver, Bronze), and generates
// a tier round-robin schedule.
matchRoutes.post('/tournaments/:tournamentId/round2/generate-tiers', requireAdmin, requireTournamentManager(async (c) => c.req.param('tournamentId')), async (c) => {
  const tournamentId = c.req.param('tournamentId')!;
  const body = await c.req.json<{ tierCount?: number; teamsPerTier?: number; startTime?: string; endTime?: string }>().catch(() => ({}) as { tierCount?: number; teamsPerTier?: number; startTime?: string; endTime?: string });
  const tierCount = Math.max(1, Math.min(4, body.tierCount ?? 4));
  const playoff = await c.env.DB.prepare('SELECT series_stage FROM tournaments WHERE id = ?')
    .bind(tournamentId)
    .first<{ series_stage: string | null }>();
  const isSeriesPlayoffs = playoff?.series_stage === 'playoffs';
  const teamsPerTier = body.teamsPerTier && body.teamsPerTier > 0
    ? Number(body.teamsPerTier)
    : isSeriesPlayoffs
      ? 8
      : undefined;

  if (await blockIfCompleted(c.env.DB, tournamentId, 2)) {
    return c.json({ error: 'Cannot regenerate Round 2: matches already have results' }, 409);
  }

  const ranking = await computeOverallRanking(c.env.DB, tournamentId);
  if (ranking.length < 2) return c.json({ error: 'At least 2 teams with Round 1 results are required' }, 400);

  // Clear existing tier values from teams
  await c.env.DB.prepare('UPDATE teams SET tier = NULL WHERE tournament_id = ?').bind(tournamentId).run();

  const tierByTeam = assignTiers(ranking, tierCount, teamsPerTier);
  if (isSeriesPlayoffs) {
    for (const tier of tiersForCount(tierCount)) {
      const tierSize = ranking.filter((row) => tierByTeam[row.teamId] === tier).length;
      if (tierSize !== 8) {
        return c.json({ error: `Series playoffs require exactly 8 teams in each active tier; ${tier} has ${tierSize}` }, 400);
      }
    }
  }

  for (const [teamId, tier] of Object.entries(tierByTeam)) {
    await c.env.DB.prepare('UPDATE teams SET tier = ? WHERE id = ?').bind(tier, Number(teamId)).run();
  }

  const placedCount = Object.keys(tierByTeam).length;
  const eliminatedCount = ranking.length - placedCount;

  if (isSeriesPlayoffs) {
    await c.env.DB.prepare('DELETE FROM matches WHERE tournament_id = ? AND stage IN (2, 3, 4)').bind(tournamentId).run();
  } else {
    await c.env.DB.prepare('DELETE FROM matches WHERE tournament_id = ? AND stage = 2').bind(tournamentId).run();
  }

  const activeTiers = tiersForCount(tierCount);
  const created: Record<string, number> = {};
  for (const tier of activeTiers) {
    const tierTeamIds = ranking.filter((r) => tierByTeam[r.teamId] === tier).map((r) => r.teamId);
    if (tierTeamIds.length < 2) continue;
    if (isSeriesPlayoffs) {
      for (let index = 0; index < 4; index++) {
        await c.env.DB.prepare(
          `INSERT INTO matches (tournament_id, stage, bracket_type, round, match_number, team1_id, team2_id)
           VALUES (?, 2, ?, 1, ?, ?, ?)`
        )
          .bind(tournamentId, tier, index + 1, tierTeamIds[index], tierTeamIds[index + 4])
          .run();
      }
      created[tier] = tierTeamIds.length;
      continue;
    }
    const plan = generateRoundRobin(
      tierTeamIds.map((id) => ({ id, seed: 0 })),
      tier,
      true
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

  const round2Counts = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
     FROM matches WHERE tournament_id = ? AND stage = 2`
  )
    .bind(tournamentId)
    .first<{ total: number; completed: number | null }>();
  if (!round2Counts || round2Counts.total === 0 || round2Counts.completed !== round2Counts.total) {
    return c.json({ error: 'Complete all Round 2 matches before generating Round 3/4' }, 409);
  }

  const playoff = await c.env.DB.prepare('SELECT series_stage FROM tournaments WHERE id = ?')
    .bind(tournamentId)
    .first<{ series_stage: string | null }>();
  if (playoff?.series_stage === 'playoffs') {
    if (await blockIfCompleted(c.env.DB, tournamentId, 4)) {
      return c.json({ error: 'Cannot regenerate Round 3/4: the final already has a result' }, 409);
    }
    const tierTypes: Tier[] = tiersForCount(4);
    const round2Rows = await c.env.DB.prepare(
      `SELECT id, bracket_type, match_number, winner_id
       FROM matches WHERE tournament_id = ? AND stage = 2 AND status = 'completed'
       ORDER BY bracket_type, match_number`
    )
      .bind(tournamentId)
      .all<{ id: number; bracket_type: Tier; match_number: number; winner_id: number | null }>();
    const created: Record<string, number> = {};
    for (const tier of tierTypes) {
      const tierMatches = round2Rows.results.filter((match) => match.bracket_type === tier);
      if (tierMatches.length === 0) continue;
      if (tierMatches.length !== 4 || tierMatches.some((match) => !match.winner_id)) {
        return c.json({ error: `Complete all four Round 2 matches in ${tier} before generating its semifinals` }, 409);
      }
    }

    await c.env.DB.prepare('DELETE FROM matches WHERE tournament_id = ? AND stage IN (3, 4)').bind(tournamentId).run();

    for (const tier of tierTypes) {
      const tierMatches = round2Rows.results.filter((match) => match.bracket_type === tier);
      if (tierMatches.length === 0) continue;

      const plan = {
        matches: [
          { round: 1, match_number: 1, bracket_type: tier, team1_id: null, team2_id: null },
          { round: 1, match_number: 2, bracket_type: tier, team1_id: null, team2_id: null },
        ],
        links: [],
      };
      await insertBracketPlan(c.env.DB, tournamentId, 3, plan);

      const finalMatch = await c.env.DB.prepare(
        `INSERT INTO matches (tournament_id, stage, bracket_type, round, match_number)
         VALUES (?, 4, ?, 1, 1) RETURNING id`
      )
        .bind(tournamentId, tier)
        .first<{ id: number }>();

      const { results: playoffMatches } = await c.env.DB.prepare(
        `SELECT id, round, match_number FROM matches
         WHERE tournament_id = ? AND stage = 3 AND bracket_type = ?`
      )
        .bind(tournamentId, tier)
        .all<{ id: number; round: number; match_number: number }>();
      const semi1Id = playoffMatches.find((match) => match.round === 1 && match.match_number === 1)?.id;
      const semi2Id = playoffMatches.find((match) => match.round === 1 && match.match_number === 2)?.id;
      const round2Match1 = tierMatches.find((match) => match.match_number === 1);
      const round2Match2 = tierMatches.find((match) => match.match_number === 2);
      const round2Match3 = tierMatches.find((match) => match.match_number === 3);
      const round2Match4 = tierMatches.find((match) => match.match_number === 4);
      if (!semi1Id || !semi2Id || !finalMatch || !round2Match1 || !round2Match2 || !round2Match3 || !round2Match4) {
        return c.json({ error: `Could not wire ${tier} semifinal advancement` }, 500);
      }

      await c.env.DB.prepare('UPDATE matches SET team1_id = ?, team2_id = ? WHERE id = ?')
        .bind(round2Match1.winner_id, round2Match3.winner_id, semi1Id)
        .run();
      await c.env.DB.prepare('UPDATE matches SET team1_id = ?, team2_id = ? WHERE id = ?')
        .bind(round2Match2.winner_id, round2Match4.winner_id, semi2Id)
        .run();

      await c.env.DB.prepare('UPDATE matches SET next_match_id = ?, next_match_slot = 1 WHERE id = ?')
        .bind(finalMatch.id, semi1Id)
        .run();
      await c.env.DB.prepare('UPDATE matches SET next_match_id = ?, next_match_slot = 2 WHERE id = ?')
        .bind(finalMatch.id, semi2Id)
        .run();

      await c.env.DB.prepare('UPDATE matches SET next_match_id = ?, next_match_slot = 1 WHERE id = ?')
        .bind(semi1Id, round2Match1.id)
        .run();
      await c.env.DB.prepare('UPDATE matches SET next_match_id = ?, next_match_slot = 2 WHERE id = ?')
        .bind(semi1Id, round2Match3.id)
        .run();
      await c.env.DB.prepare('UPDATE matches SET next_match_id = ?, next_match_slot = 1 WHERE id = ?')
        .bind(semi2Id, round2Match2.id)
        .run();
      await c.env.DB.prepare('UPDATE matches SET next_match_id = ?, next_match_slot = 2 WHERE id = ?')
        .bind(semi2Id, round2Match4.id)
        .run();
      created[tier] = 4;
    }

    await autoScheduleMatches(c.env.DB, tournamentId, body.startTime, body.endTime, 3);
    await autoScheduleMatches(c.env.DB, tournamentId, body.startTime, body.endTime, 4);
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM matches WHERE tournament_id = ? AND stage IN (3, 4) ORDER BY stage, bracket_type, round, match_number'
    )
      .bind(tournamentId)
      .all();
    return c.json({ tiers: created, matches: results }, 201);
  }

  const standings = await computeTierStandings(c.env.DB, tournamentId);
  await c.env.DB.prepare('DELETE FROM matches WHERE tournament_id = ? AND stage = 3').bind(tournamentId).run();

  const tierTypes: Tier[] = tiersForCount(4);
  const created: Record<string, number> = {};
  for (const tier of tierTypes) {
    const tierTeams = standings.filter((s) => s.tier === tier);
    const qualifying = tierTeams.slice(0, topCount);
    if (qualifying.length < 2) continue;
    const seededTeams = qualifying.map((s, i) => ({ id: s.teamId, seed: i + 1 }));
    const plan = qualifying.length === 4
      ? generateCrossSeededSemifinals(seededTeams)
      : generateSingleElimination(seededTeams);
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
  const tournament = await c.env.DB.prepare('SELECT series_stage FROM tournaments WHERE id = ?')
    .bind(tournamentId)
    .first<{ series_stage: string | null }>();
  const isSeriesPlayoffs = tournament?.series_stage === 'playoffs';
  const { results } = await c.env.DB.prepare(
    `SELECT m.id, m.stage, m.bracket_type as tier, m.round, m.match_number, m.team1_id, m.team2_id, m.winner_id, m.status, m.score_json,
            t1.name as team1_name, t2.name as team2_name
     FROM matches m
     LEFT JOIN teams t1 ON t1.id = m.team1_id
     LEFT JOIN teams t2 ON t2.id = m.team2_id
    WHERE m.tournament_id = ? AND ${isSeriesPlayoffs ? 'm.stage IN (3, 4)' : 'm.stage = 3'}
    ORDER BY m.bracket_type, m.stage ASC, m.round ASC, m.match_number ASC`
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
      const finalMatch = isSeriesPlayoffs ? rows.find((r) => r.stage === 4) : rows.find((r) => r.round === maxRound);

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
        const roundKey = isSeriesPlayoffs ? r.stage : r.round;
        roundCounts.set(roundKey, (roundCounts.get(roundKey) ?? 0) + 1);
      }

      const matches = rows.map((m) => {
        const isFinal = isSeriesPlayoffs ? m.stage === 4 : m.round === maxRound;
        const isSemi = isSeriesPlayoffs ? m.stage === 3 : m.round === maxRound - 1 && maxRound > 1;
        const roundKey = isSeriesPlayoffs ? m.stage : m.round;
        const totalInRound = roundCounts.get(roundKey) ?? 1;
        const roundLabel = isSeriesPlayoffs
          ? isFinal
            ? 'Round 4 Final'
            : totalInRound > 1
              ? `Round 3 Semi-final ${m.match_number}`
              : 'Round 3 Semi-final'
          : isFinal
            ? 'Final'
            : isSemi
              ? totalInRound > 1
                ? `Semi-final ${m.match_number}`
                : 'Semi-final'
              : `Round ${m.round}`;

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
          stage: m.stage,
          round: m.round,
          matchNumber: m.match_number,
          roundLabel,
          isFinal,
          isSemi,
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
