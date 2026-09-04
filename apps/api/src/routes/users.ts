import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireSuperAdmin } from '../middleware';

export const userRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const VALID_ROLES = ['admin', 'organizer', 'player'];

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
