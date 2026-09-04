import type { Context, Next } from 'hono';
import type { Env, Variables } from './types';
import { readSessionToken, verifySessionToken } from './auth';

type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

export async function loadUser(c: Ctx, next: Next) {
  const token = readSessionToken(c.req.header('cookie') ?? null);
  if (!token) {
    c.set('user', null);
    return next();
  }
  const user = await verifySessionToken(token, c.env.JWT_SECRET);
  c.set('user', user);
  return next();
}

export async function requireAuth(c: Ctx, next: Next) {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Authentication required' }, 401);
  return next();
}

export async function requireAdmin(c: Ctx, next: Next) {
  const user = c.get('user');
  if (!user || !['admin', 'organizer', 'superuser'].includes(user.role)) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  return next();
}

// Stricter than requireAdmin: user management is restricted to the 'admin' role, not organizers.
export async function requireSuperAdmin(c: Ctx, next: Next) {
  const user = c.get('user');
  if (!user || user.role !== 'admin') {
    return c.json({ error: 'Admin access required' }, 403);
  }
  return next();
}

// Admins/organizers manage every tournament; superusers are scoped to tournaments they're
// explicitly assigned to via tournament_managers. Must run after requireAdmin.
export function requireTournamentManager(resolveTournamentId: (c: Ctx) => Promise<string | number | null | undefined>) {
  return async (c: Ctx, next: Next) => {
    const user = c.get('user')!;
    if (user.role === 'admin' || user.role === 'organizer') return next();

    const tournamentId = await resolveTournamentId(c);
    if (!tournamentId) return c.json({ error: 'Not found' }, 404);

    const access = await c.env.DB.prepare(
      'SELECT 1 FROM tournament_managers WHERE user_id = ? AND tournament_id = ?'
    )
      .bind(user.id, tournamentId)
      .first();
    if (!access) return c.json({ error: 'You are not assigned to this tournament' }, 403);
    return next();
  };
}
