import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAdmin } from '../middleware';

export const courtRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

courtRoutes.get('/tournaments/:tournamentId/courts', async (c) => {
  const tournamentId = c.req.param('tournamentId');
  const { results } = await c.env.DB.prepare('SELECT * FROM courts WHERE tournament_id = ? ORDER BY id')
    .bind(tournamentId)
    .all();
  return c.json({ courts: results });
});

courtRoutes.post('/tournaments/:tournamentId/courts', requireAdmin, async (c) => {
  const tournamentId = c.req.param('tournamentId');
  const { name } = await c.req.json<{ name: string }>();
  if (!name) return c.json({ error: 'name is required' }, 400);
  const result = await c.env.DB.prepare('INSERT INTO courts (tournament_id, name) VALUES (?, ?) RETURNING *')
    .bind(tournamentId, name)
    .first();
  return c.json({ court: result }, 201);
});

courtRoutes.delete('/courts/:id', requireAdmin, async (c) => {
  await c.env.DB.prepare('DELETE FROM courts WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});
