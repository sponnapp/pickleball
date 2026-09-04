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

teamRoutes.delete('/teams/:id', requireAdmin, requireTournamentManager((c) => resolveTeamTournamentId(c.env.DB, c.req.param('id'))), async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM teams WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});
