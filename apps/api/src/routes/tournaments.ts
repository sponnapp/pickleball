import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAdmin, requireTournamentManager } from '../middleware';
import { computePoolStandings, computeTierStandings } from '../standings';

export const tournamentRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

tournamentRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, description, format, status, start_date, end_date FROM tournaments ORDER BY start_date DESC'
  ).all();
  return c.json({ tournaments: results });
});

// Admin-area listing: superusers only see tournaments ("seasons") they're assigned to manage.
tournamentRoutes.get('/admin', requireAdmin, async (c) => {
  const user = c.get('user')!;
  if (user.role === 'superuser') {
    const { results } = await c.env.DB.prepare(
      `SELECT t.id, t.name, t.description, t.format, t.status, t.start_date, t.end_date
       FROM tournaments t
       JOIN tournament_managers tm ON tm.tournament_id = t.id
       WHERE tm.user_id = ?
       ORDER BY t.start_date DESC`
    )
      .bind(user.id)
      .all();
    return c.json({ tournaments: results });
  }
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, description, format, status, start_date, end_date FROM tournaments ORDER BY start_date DESC'
  ).all();
  return c.json({ tournaments: results });
});

tournamentRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const tournament = await c.env.DB.prepare('SELECT * FROM tournaments WHERE id = ?').bind(id).first();
  if (!tournament) return c.json({ error: 'Tournament not found' }, 404);
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
  }>();
  if (!body.name || !body.format) return c.json({ error: 'name and format are required' }, 400);

  const result = await c.env.DB.prepare(
    `INSERT INTO tournaments (name, description, format, start_date, end_date, created_by)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`
  )
    .bind(body.name, body.description ?? null, body.format, body.start_date ?? null, body.end_date ?? null, user.id)
    .first();
  return c.json({ tournament: result }, 201);
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
