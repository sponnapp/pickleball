import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAdmin, requireTournamentManager } from '../middleware';
import { computeOverallRanking, computePoolStandings, computeTierStandings } from '../standings';

export const tournamentRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

tournamentRoutes.get('/', async (c) => {
  const user = c.get('user');
  const isAdminOrSuperuser = user && ['admin', 'superuser', 'organizer'].includes(user.role);

  const query = isAdminOrSuperuser
      ? `SELECT t.id, t.name, t.description, t.format, t.status, t.start_date, t.end_date,
      t.series_id, t.series_stage, t.competition_type, s.name AS series_name
    FROM tournaments t LEFT JOIN competition_series s ON s.id = t.series_id
    ORDER BY t.start_date DESC`
      : `SELECT t.id, t.name, t.description, t.format, t.status, t.start_date, t.end_date,
      t.series_id, t.series_stage, t.competition_type, s.name AS series_name
    FROM tournaments t LEFT JOIN competition_series s ON s.id = t.series_id
    WHERE t.status != 'draft' ORDER BY t.start_date DESC`;

  const { results } = await c.env.DB.prepare(query).all();
  return c.json({ tournaments: results });
});

// Admin-area listing: superusers only see tournaments ("seasons") they're assigned to manage.
tournamentRoutes.get('/admin', requireAdmin, async (c) => {
  const user = c.get('user')!;
  if (user.role === 'superuser') {
    const { results } = await c.env.DB.prepare(
            `SELECT t.id, t.name, t.description, t.format, t.status, t.start_date, t.end_date,
                t.series_id, t.series_stage, t.competition_type, s.name AS series_name
       FROM tournaments t
              LEFT JOIN competition_series s ON s.id = t.series_id
       JOIN tournament_managers tm ON tm.tournament_id = t.id
       WHERE tm.user_id = ?
       ORDER BY t.start_date DESC`
    )
      .bind(user.id)
      .all();
    return c.json({ tournaments: results });
  }
  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.name, t.description, t.format, t.status, t.start_date, t.end_date,
            t.series_id, t.series_stage, t.competition_type, s.name AS series_name
     FROM tournaments t LEFT JOIN competition_series s ON s.id = t.series_id
     ORDER BY t.start_date DESC`
  ).all();
  return c.json({ tournaments: results });
});

tournamentRoutes.get('/admin/series', requireAdmin, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.description, s.status,
            (SELECT COUNT(*) FROM tournaments t WHERE t.series_id = s.id AND t.series_stage LIKE 'qualifier_%') AS qualifier_count,
            (SELECT t.id FROM tournaments t WHERE t.series_id = s.id AND t.series_stage = 'playoffs' LIMIT 1) AS playoffs_id
     FROM competition_series s
     ORDER BY s.created_at DESC`
  ).all();
  return c.json({ series: results });
});

tournamentRoutes.post('/admin/series/:seriesId/playoffs', requireAdmin, async (c) => {
  const user = c.get('user')!;
  if (user.role === 'superuser') return c.json({ error: 'Superusers cannot create tournaments' }, 403);

  const seriesId = c.req.param('seriesId');
  const series = await c.env.DB.prepare('SELECT id, name FROM competition_series WHERE id = ?')
    .bind(seriesId)
    .first<{ id: number; name: string }>();
  if (!series) return c.json({ error: 'Tournament series not found' }, 404);

  const { results: qualifiers } = await c.env.DB.prepare(
    `SELECT id, name, series_stage FROM tournaments
     WHERE series_id = ? AND series_stage LIKE 'qualifier_%'`
  )
    .bind(seriesId)
    .all<{ id: number; name: string; series_stage: string }>();
  qualifiers.sort((a, b) => {
    const stageNumber = (stage: string) => Number(stage.match(/^qualifier_(\d+)$/)?.[1] ?? 0);
    return stageNumber(a.series_stage) - stageNumber(b.series_stage);
  });
  if (qualifiers.length === 0) return c.json({ error: 'Add at least one tournament to this series before combining results' }, 409);

  const existingPlayoffs = await c.env.DB.prepare(
    "SELECT id FROM tournaments WHERE series_id = ? AND series_stage = 'playoffs'"
  )
    .bind(seriesId)
    .first<{ id: number }>();
  if (existingPlayoffs) return c.json({ error: 'Playoff event already exists for this series', tournament_id: existingPlayoffs.id }, 409);

  const rankingByQualifier = [];
  for (const qualifier of qualifiers) {
    const counts = await c.env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
       FROM matches WHERE tournament_id = ? AND stage = 1`
    )
      .bind(qualifier.id)
      .first<{ total: number; completed: number | null }>();
    if (!counts || counts.total === 0 || counts.completed !== counts.total) {
      return c.json({ error: `${qualifier.name} must have all Round 1 matches completed` }, 409);
    }

    const ranking = await computeOverallRanking(c.env.DB, qualifier.id);
    const teamCount = await c.env.DB.prepare('SELECT COUNT(*) AS count FROM teams WHERE tournament_id = ?')
      .bind(qualifier.id)
      .first<{ count: number }>();
    if (ranking.length !== teamCount?.count) {
      return c.json({ error: `${qualifier.name} has teams not assigned to a Round 1 group` }, 409);
    }
    rankingByQualifier.push({ qualifier, ranking });
  }

  const combinedRanking = rankingByQualifier
    .flatMap(({ qualifier, ranking }) => ranking.map((row) => ({ ...row, sourceTournamentId: qualifier.id })))
    .sort(
      (a, b) =>
        b.wins - a.wins ||
        b.pointDifferential - a.pointDifferential ||
        a.teamName.localeCompare(b.teamName) ||
        a.sourceTournamentId - b.sourceTournamentId
    );
  if (combinedRanking.length < 2) return c.json({ error: 'At least 2 qualified teams are required' }, 400);

  const playoffTournament = await c.env.DB.prepare(
    `INSERT INTO tournaments (name, description, format, status, created_by, series_id, series_stage, competition_type)
     VALUES (?, ?, 'pool_play', 'draft', ?, ?, 'playoffs', 'series') RETURNING id`
  )
    .bind(`${series.name} Playoffs`, 'Combined series qualifier results', user.id, seriesId)
    .first<{ id: number }>();
  if (!playoffTournament) return c.json({ error: 'Failed to create playoff event' }, 500);

  const sourceTeams = new Map<number, { name: string; player1_name: string; player2_name: string | null; pool: string | null }>();
  for (const { qualifier } of rankingByQualifier) {
    const { results } = await c.env.DB.prepare(
      'SELECT id, name, player1_name, player2_name, pool FROM teams WHERE tournament_id = ?'
    )
      .bind(qualifier.id)
      .all<{ id: number; name: string; player1_name: string; player2_name: string | null; pool: string | null }>();
    for (const team of results) sourceTeams.set(team.id, team);
  }

  for (const [index, ranked] of combinedRanking.entries()) {
    const source = sourceTeams.get(ranked.teamId);
    if (!source) continue;
    await c.env.DB.prepare(
      `INSERT INTO teams
         (tournament_id, name, player1_name, player2_name, seed, pool, qualifier_wins, qualifier_point_differential)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        playoffTournament.id,
        source.name,
        source.player1_name,
        source.player2_name,
        index + 1,
        source.pool,
        ranked.wins,
        ranked.pointDifferential
      )
      .run();
  }

  return c.json({ tournament_id: playoffTournament.id, team_count: combinedRanking.length }, 201);
});

tournamentRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const tournament = await c.env.DB.prepare('SELECT * FROM tournaments WHERE id = ?').bind(id).first<{ status: string; [key: string]: unknown }>();
  if (!tournament) return c.json({ error: 'Tournament not found' }, 404);

  const user = c.get('user');
  const isAdminOrSuperuser = user && ['admin', 'superuser', 'organizer'].includes(user.role);
  if (tournament.status === 'draft' && !isAdminOrSuperuser) {
    return c.json({ error: 'Tournament not found' }, 404);
  }

  return c.json({ tournament });
});

tournamentRoutes.post('/', requireAdmin, async (c) => {
  const user = c.get('user')!;
  if (user.role === 'superuser') return c.json({ error: 'Superusers cannot create tournaments' }, 403);
  const body = await c.req.json<{
    name: string;
    description?: string;
    format: string;
    start_date?: string;
    end_date?: string;
    competition_type?: 'single' | 'series';
    series_name?: string;
    series_description?: string;
    existing_series_id?: number;
  }>();
  if (!body.name || !body.format) return c.json({ error: 'name and format are required' }, 400);

  const addingToExistingSeries = Number.isInteger(body.existing_series_id);
  const competitionType = addingToExistingSeries || body.competition_type === 'series' ? 'series' : 'single';
  let seriesId: number | null = null;
  let seriesStage: string | null = null;

  if (addingToExistingSeries) {
    seriesId = body.existing_series_id!;
    const existingSeries = await c.env.DB.prepare('SELECT id FROM competition_series WHERE id = ?')
      .bind(seriesId)
      .first<{ id: number }>();
    if (!existingSeries) return c.json({ error: 'Tournament series not found' }, 404);
    const existingPlayoffs = await c.env.DB.prepare(
      "SELECT 1 AS exists_flag FROM tournaments WHERE series_id = ? AND series_stage = 'playoffs'"
    )
      .bind(seriesId)
      .first<{ exists_flag: number }>();
    if (existingPlayoffs) return c.json({ error: 'Cannot add tournaments after playoffs have been consolidated' }, 409);
    const { results: qualifierStages } = await c.env.DB.prepare(
      "SELECT series_stage FROM tournaments WHERE series_id = ? AND series_stage LIKE 'qualifier_%'"
    )
      .bind(seriesId)
      .all<{ series_stage: string }>();
    const nextQualifierNumber = qualifierStages.reduce((max, row) => {
      const stageNumber = Number(row.series_stage.match(/^qualifier_(\d+)$/)?.[1] ?? 0);
      return Math.max(max, stageNumber);
    }, 0) + 1;
    seriesStage = `qualifier_${nextQualifierNumber}`;
  } else if (competitionType === 'series') {
    const series = await c.env.DB.prepare(
      `INSERT INTO competition_series (name, description, created_by, status)
       VALUES (?, ?, ?, 'draft') RETURNING id`
    )
      .bind(body.series_name?.trim() || body.name, body.series_description ?? body.description ?? null, user.id)
      .first<{ id: number }>();
    seriesId = series?.id ?? null;
    if (!seriesId) return c.json({ error: 'Failed to create tournament series' }, 500);
    seriesStage = 'qualifier_1';
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO tournaments
       (name, description, format, start_date, end_date, created_by, series_id, series_stage, competition_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
  )
    .bind(
      body.name,
      body.description ?? null,
      body.format,
      body.start_date ?? null,
      body.end_date ?? null,
      user.id,
      seriesId,
      seriesStage,
      competitionType
    )
    .first();
  return c.json({ tournament: result, series_id: seriesId }, 201);
});

tournamentRoutes.patch('/:id', requireAdmin, requireTournamentManager(async (c) => c.req.param('id')), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Record<string, unknown>>();
  const allowed = ['name', 'description', 'format', 'status', 'start_date', 'end_date'];
  const fields = Object.keys(body).filter((k) => allowed.includes(k));
  if (fields.length === 0) return c.json({ error: 'No valid fields to update' }, 400);

  const setClause = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => body[f]);
  await c.env.DB.prepare(`UPDATE tournaments SET ${setClause} WHERE id = ?`)
    .bind(...values, id)
    .run();
  const updated = await c.env.DB.prepare('SELECT * FROM tournaments WHERE id = ?').bind(id).first();
  return c.json({ tournament: updated });
});

tournamentRoutes.delete('/:id', requireAdmin, requireTournamentManager(async (c) => c.req.param('id')), async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM tournaments WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

// Round 1 standings (random-group pool play), grouped by pool.
tournamentRoutes.get('/:id/standings', async (c) => {
  const standings = await computePoolStandings(c.env.DB, c.req.param('id'));
  return c.json({ standings });
});

// Round 2 standings (tier round-robin), grouped by tier.
tournamentRoutes.get('/:id/tier-standings', async (c) => {
  const standings = await computeTierStandings(c.env.DB, c.req.param('id'));
  return c.json({ standings });
});
