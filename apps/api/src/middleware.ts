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
  if (!user || (user.role !== 'admin' && user.role !== 'organizer')) {
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
