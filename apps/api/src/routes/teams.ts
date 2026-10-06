import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAdmin, requireTournamentManager } from '../middleware';

export const teamRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

async function resolveTeamTournamentId(db: Env['DB'], teamId: string | undefined) {
  if (!teamId) return null;
  const row = await db.prepare('SELECT tournament_id FROM teams WHERE id = ?').bind(teamId).first<{ tournament_id: number }>();
  return row?.tournament_id ?? null;
}

teamRoutes.get('/tournaments/:tournamentId/teams', async (c) => {
  const tournamentId = c.req.param('tournamentId');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM teams WHERE tournament_id = ? ORDER BY seed ASC, id ASC'
  )
    .bind(tournamentId)
    .all();
  return c.json({ teams: results });
});

// Open registration: any authenticated user can register a team for a tournament.
teamRoutes.post('/tournaments/:tournamentId/teams', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Authentication required' }, 401);
  const tournamentId = c.req.param('tournamentId');
  const body = await c.req.json<{ name: string; player1_name: string; player2_name?: string; pool?: string }>();
  if (!body.name || !body.player1_name) return c.json({ error: 'name and player1_name are required' }, 400);

  const result = await c.env.DB.prepare(
    `INSERT INTO teams (tournament_id, name, player1_name, player2_name, pool) VALUES (?, ?, ?, ?, ?) RETURNING *`
  )
    .bind(tournamentId, body.name, body.player1_name, body.player2_name ?? null, body.pool ?? null)
    .first();
  return c.json({ team: result }, 201);
});

// Admin bulk import (e.g. from a CSV upload), scoped to the tournament like other admin writes.
teamRoutes.post(
  '/tournaments/:tournamentId/teams/bulk',
  requireAdmin,
  requireTournamentManager(async (c) => c.req.param('tournamentId')),
  async (c) => {
    const tournamentId = c.req.param('tournamentId');
    const body = await c.req.json<{
      teams?: { name: string; player1_name: string; player2_name?: string; seed?: number; pool?: string }[];
    }>();
    if (!Array.isArray(body.teams) || body.teams.length === 0) {
      return c.json({ error: 'teams array is required' }, 400);
    }

    const inserted = [];
    for (const t of body.teams) {
      if (!t || !t.name || !t.player1_name) continue;
      const row = await c.env.DB.prepare(
        `INSERT INTO teams (tournament_id, name, player1_name, player2_name, seed, pool) VALUES (?, ?, ?, ?, ?, ?) RETURNING *`
      )
        .bind(tournamentId, t.name, t.player1_name, t.player2_name ?? null, t.seed ?? null, t.pool ?? null)
        .first();
      if (row) inserted.push(row);
    }
    if (inserted.length === 0) return c.json({ error: 'No valid teams to import (name and player1_name required)' }, 400);
    return c.json({ teams: inserted }, 201);
  }
);

teamRoutes.patch('/teams/:id', requireAdmin, requireTournamentManager((c) => resolveTeamTournamentId(c.env.DB, c.req.param('id'))), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Record<string, unknown>>();
  const allowed = ['name', 'player1_name', 'player2_name', 'seed', 'pool'];
  const fields = Object.keys(body).filter((k) => allowed.includes(k));
  if (fields.length === 0) return c.json({ error: 'No valid fields to update' }, 400);

  const setClause = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => body[f]);
  await c.env.DB.prepare(`UPDATE teams SET ${setClause} WHERE id = ?`)
    .bind(...values, id)
    .run();
  const updated = await c.env.DB.prepare('SELECT * FROM teams WHERE id = ?').bind(id).first();
  return c.json({ team: updated });
});

teamRoutes.post('/teams/:id/withdraw', requireAdmin, requireTournamentManager((c) => resolveTeamTournamentId(c.env.DB, c.req.param('id'))), async (c) => {
  const id = Number(c.req.param('id'));
  const team = await c.env.DB.prepare(
    'SELECT id, tournament_id, name, seed, tier, withdrawn FROM teams WHERE id = ?'
  )
    .bind(id)
    .first<{
      id: number;
      tournament_id: number;
      name: string;
      seed: number | null;
      tier: string | null;
      withdrawn: number;
    }>();
  if (!team) return c.json({ error: 'Team not found' }, 404);
  if (team.withdrawn) return c.json({ error: 'Team is already withdrawn' }, 409);
  if (!team.tier || team.seed === null) return c.json({ error: 'Only an active playoff team can be withdrawn' }, 400);

  const tournament = await c.env.DB.prepare('SELECT series_stage FROM tournaments WHERE id = ?')
    .bind(team.tournament_id)
    .first<{ series_stage: string | null }>();
  if (tournament?.series_stage !== 'playoffs') return c.json({ error: 'Team withdrawal is only available for series playoffs' }, 400);

  const startedMatch = await c.env.DB.prepare(
    `SELECT id FROM matches WHERE tournament_id = ? AND stage >= 2 AND status != 'scheduled' LIMIT 1`
  )
    .bind(team.tournament_id)
    .first<{ id: number }>();
  if (startedMatch) return c.json({ error: 'Cannot withdraw a team after playoff matches have started' }, 409);

  const { results: playoffTeams } = await c.env.DB.prepare(
    `SELECT id, name, seed, tier, withdrawn FROM teams WHERE tournament_id = ? ORDER BY seed, id`
  )
    .bind(team.tournament_id)
    .all<{ id: number; name: string; seed: number | null; tier: string | null; withdrawn: number }>();
  const { results: stageTwoMatchCounts } = await c.env.DB.prepare(
    `SELECT bracket_type, COUNT(*) AS matches FROM matches
     WHERE tournament_id = ? AND stage = 2 GROUP BY bracket_type`
  )
    .bind(team.tournament_id)
    .all<{ bracket_type: string; matches: number }>();
  const matchCountByTier = new Map(stageTwoMatchCounts.map((row) => [row.bracket_type, row.matches]));
  const currentTierSizes = new Map<string, number>();
  for (const tier of new Set(playoffTeams.map((playoffTeam) => playoffTeam.tier).filter(Boolean))) {
    const matchCount = matchCountByTier.get(tier!);
    const activeCount = playoffTeams.filter((playoffTeam) => playoffTeam.tier === tier && !playoffTeam.withdrawn).length;
    const capacity = matchCount === 2 ? 4 : matchCount === 4 ? 8 : activeCount;
    currentTierSizes.set(tier!, capacity);
  }
  const tierOrder = ['platinum', 'gold', 'silver', 'bronze'];
  const orderedTiers = tierOrder.filter((tier) => currentTierSizes.has(tier));
  if (!orderedTiers.includes(team.tier)) return c.json({ error: 'The team tier is invalid' }, 409);

  const orderedActiveTeams = playoffTeams
    .filter((playoffTeam) => playoffTeam.id !== team.id && !playoffTeam.withdrawn)
    .sort((a, b) => (a.seed ?? Number.MAX_SAFE_INTEGER) - (b.seed ?? Number.MAX_SAFE_INTEGER) || a.id - b.id);
  const promotedTeam = orderedActiveTeams.find((playoffTeam) => (playoffTeam.seed ?? Number.MAX_SAFE_INTEGER) > team.seed!);
  if (!promotedTeam) return c.json({ error: 'No team is queued after this seed to promote' }, 409);

  const totalTierSlots = [...currentTierSizes.values()].reduce((total, size) => total + size, 0);
  if (orderedActiveTeams.length < totalTierSlots) {
    return c.json({ error: 'There are not enough active reserve teams to fill all playoff tiers' }, 409);
  }

  const reseededTeams = orderedActiveTeams.map((playoffTeam, index) => ({
    ...playoffTeam,
    seed: index + 1,
  }));
  const teamTierUpdates = new Map<number, string | null>();
  let tierOffset = 0;
  for (const tier of orderedTiers) {
    const tierSize = currentTierSizes.get(tier)!;
    for (const playoffTeam of reseededTeams.slice(tierOffset, tierOffset + tierSize)) {
      teamTierUpdates.set(playoffTeam.id, tier);
    }
    tierOffset += tierSize;
  }

  const stageTwoMatches = [] as { id: number; bracket_type: string; match_number: number }[];
  for (const tier of orderedTiers) {
    const { results } = await c.env.DB.prepare(
      `SELECT id, bracket_type, match_number FROM matches
       WHERE tournament_id = ? AND stage = 2 AND bracket_type = ? ORDER BY match_number`
    )
      .bind(team.tournament_id, tier)
      .all<{ id: number; bracket_type: string; match_number: number }>();
    const expected = currentTierSizes.get(tier) === 4 ? 2 : 4;
    if (results.length !== 0 && results.length !== expected) {
      return c.json({ error: `The ${tier} bracket is incomplete; regenerate Round 2 before promoting a reserve` }, 409);
    }
    stageTwoMatches.push(...results);
  }

  const statements = [
    c.env.DB.prepare('UPDATE teams SET withdrawn = 1 WHERE id = ?').bind(team.id),
    ...reseededTeams.map((playoffTeam) => c.env.DB.prepare('UPDATE teams SET seed = ?, tier = ? WHERE id = ?')
      .bind(playoffTeam.seed, teamTierUpdates.get(playoffTeam.id) ?? null, playoffTeam.id)),
  ];
  if (stageTwoMatches.length > 0) {
    for (const tier of orderedTiers) {
      const tierTeams = reseededTeams.filter((playoffTeam) => teamTierUpdates.get(playoffTeam.id) === tier);
      const tierMatches = stageTwoMatches.filter((match) => match.bracket_type === tier).sort((a, b) => a.match_number - b.match_number);
      if (tierMatches.length === 0) continue;
      const pairings = tierTeams.length === 4
        ? [[tierTeams[0], tierTeams[2]], [tierTeams[1], tierTeams[3]]]
        : Array.from({ length: 4 }, (_, index) => [tierTeams[index], tierTeams[index + 4]]);
      tierMatches.forEach((match, index) => {
        statements.push(
          c.env.DB.prepare('UPDATE matches SET team1_id = ?, team2_id = ? WHERE id = ?')
            .bind(pairings[index][0].id, pairings[index][1].id, match.id)
        );
      });
    }
  }
  await c.env.DB.batch(statements);

  return c.json({
    ok: true,
    withdrawn_team: team.name,
    promoted_team: promotedTeam.name,
    promoted_from_seed: promotedTeam.seed,
    promoted_to_seed: team.seed,
    tier: teamTierUpdates.get(promotedTeam.id) ?? null,
  });
});

teamRoutes.delete('/teams/:id', requireAdmin, requireTournamentManager((c) => resolveTeamTournamentId(c.env.DB, c.req.param('id'))), async (c) => {
  const id = c.req.param('id');
  // Delete all matches involving this team (whether team1, team2, or winner)
  await c.env.DB.prepare(
    'DELETE FROM matches WHERE team1_id = ? OR team2_id = ? OR winner_id = ?'
  )
    .bind(id, id, id)
    .run();

  await c.env.DB.prepare('DELETE FROM teams WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

teamRoutes.delete('/tournaments/:tournamentId/teams', requireAdmin, requireTournamentManager(async (c) => c.req.param('tournamentId')), async (c) => {
  const tournamentId = c.req.param('tournamentId');
  // Delete all matches for this tournament since all teams are being deleted
  await c.env.DB.prepare('DELETE FROM matches WHERE tournament_id = ?').bind(tournamentId).run();
  await c.env.DB.prepare('DELETE FROM teams WHERE tournament_id = ?').bind(tournamentId).run();
  return c.json({ ok: true });
});
