import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireSuperAdmin } from '../middleware';

export const userRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const VALID_ROLES = ['admin', 'organizer', 'superuser', 'player'];

userRoutes.get('/', requireSuperAdmin, async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, email, name, role, created_at FROM users ORDER BY created_at DESC'
  ).all();
  return c.json({ users: results });
});

userRoutes.patch('/:id', requireSuperAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  const { role } = await c.req.json<{ role?: string }>();
  if (!role || !VALID_ROLES.includes(role)) {
    return c.json({ error: `role must be one of ${VALID_ROLES.join(', ')}` }, 400);
  }

  const actor = c.get('user');
  if (actor && actor.id === id && role !== 'admin') {
    return c.json({ error: 'You cannot remove your own admin access' }, 400);
  }

  const user = await c.env.DB.prepare(
    'UPDATE users SET role = ? WHERE id = ? RETURNING id, email, name, role, created_at'
  )
    .bind(role, id)
    .first();
  if (!user) return c.json({ error: 'User not found' }, 404);
  return c.json({ user });
});

// Tournaments ("seasons") a superuser is allowed to manage.
userRoutes.get('/:id/tournaments', requireSuperAdmin, async (c) => {
  const { results } = await c.env.DB.prepare('SELECT tournament_id FROM tournament_managers WHERE user_id = ?')
    .bind(c.req.param('id'))
    .all<{ tournament_id: number }>();
  return c.json({ tournamentIds: results.map((r) => r.tournament_id) });
});

userRoutes.patch('/:id/tournaments', requireSuperAdmin, async (c) => {
  const userId = Number(c.req.param('id'));
  const { tournament_ids } = await c.req.json<{ tournament_ids?: unknown }>();
  if (!Array.isArray(tournament_ids) || tournament_ids.some((t) => typeof t !== 'number' && isNaN(Number(t)))) {
    return c.json({ error: 'tournament_ids must be an array of tournament ids' }, 400);
  }

  const ids = tournament_ids.map(Number);
  await c.env.DB.prepare('DELETE FROM tournament_managers WHERE user_id = ?').bind(userId).run();
  for (const tournamentId of ids) {
    await c.env.DB.prepare('INSERT INTO tournament_managers (user_id, tournament_id) VALUES (?, ?)')
      .bind(userId, tournamentId)
      .run();
  }
  return c.json({ tournamentIds: ids });
});
