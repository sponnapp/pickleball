import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
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
  if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid user id' }, 400);
  const body = await c.req.json<{ name?: string; email?: string; role?: string }>();
  const fields: string[] = [];
  const values: (string | number)[] = [];

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) return c.json({ error: 'Name cannot be empty' }, 400);
    fields.push('name = ?');
    values.push(name);
  }

  if (body.email !== undefined) {
    const email = body.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: 'Enter a valid email address' }, 400);
    const duplicate = await c.env.DB.prepare('SELECT id FROM users WHERE email = ? AND id != ?')
      .bind(email, id)
      .first();
    if (duplicate) return c.json({ error: 'An account with this email already exists' }, 409);
    fields.push('email = ?');
    values.push(email);
  }

  if (body.role !== undefined) {
    if (!VALID_ROLES.includes(body.role)) {
      return c.json({ error: `role must be one of ${VALID_ROLES.join(', ')}` }, 400);
    }
    const actor = c.get('user')!;
    if (actor.id === id && body.role !== 'admin') {
      return c.json({ error: 'You cannot remove your own admin access' }, 400);
    }
    const current = await c.env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(id).first<{ role: string }>();
    if (!current) return c.json({ error: 'User not found' }, 404);
    if (current.role === 'admin' && body.role !== 'admin') {
      const admins = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'")
        .first<{ count: number }>();
      if ((admins?.count ?? 0) <= 1) return c.json({ error: 'Cannot demote the last admin' }, 409);
    }
    fields.push('role = ?');
    values.push(body.role);
  }

  if (fields.length === 0) return c.json({ error: 'Provide name, email, or role to update' }, 400);
  values.push(id);
  const user = await c.env.DB.prepare(
    `UPDATE users SET ${fields.join(', ')} WHERE id = ? RETURNING id, email, name, role, created_at`
  )
    .bind(...values)
    .first();
  if (!user) return c.json({ error: 'User not found' }, 404);
  return c.json({ user });
});

userRoutes.patch('/:id/password', requireSuperAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid user id' }, 400);
  const { new_password: newPassword } = await c.req.json<{ new_password?: string }>();
  if (!newPassword || newPassword.length < 8) {
    return c.json({ error: 'New password must be at least 8 characters' }, 400);
  }
  const exists = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first();
  if (!exists) return c.json({ error: 'User not found' }, 404);
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(passwordHash, id).run();
  return c.json({ ok: true });
});

userRoutes.delete('/:id', requireSuperAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid user id' }, 400);
  const actor = c.get('user')!;
  if (actor.id === id) return c.json({ error: 'You cannot delete your own account' }, 400);
  const target = await c.env.DB.prepare('SELECT id, role FROM users WHERE id = ?').bind(id).first<{ id: number; role: string }>();
  if (!target) return c.json({ error: 'User not found' }, 404);
  if (target.role === 'admin') {
    const admins = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'")
      .first<{ count: number }>();
    if ((admins?.count ?? 0) <= 1) return c.json({ error: 'Cannot delete the last admin' }, 409);
  }

  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE tournaments SET created_by = NULL WHERE created_by = ?').bind(id),
    c.env.DB.prepare('UPDATE competition_series SET created_by = NULL WHERE created_by = ?').bind(id),
    c.env.DB.prepare('DELETE FROM tournament_managers WHERE user_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id),
  ]);
  return c.json({ ok: true });
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
