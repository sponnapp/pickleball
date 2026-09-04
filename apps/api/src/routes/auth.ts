import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import type { Env, Variables } from '../types';
import {
  createSessionToken,
  sessionCookieHeader,
  clearSessionCookieHeader,
  verifyGoogleIdToken,
} from '../auth';

export const authRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

authRoutes.post('/register', async (c) => {
  const { email, password, name } = await c.req.json<{ email?: string; password?: string; name?: string }>();
  if (!email || !password || !name) return c.json({ error: 'email, password, and name are required' }, 400);
  if (password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400);

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return c.json({ error: 'An account with this email already exists' }, 409);

  const passwordHash = await bcrypt.hash(password, 10);
  const result = await c.env.DB.prepare(
    'INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?) RETURNING id, email, name, role'
  )
    .bind(email, name, passwordHash, 'player')
    .first<{ id: number; email: string; name: string; role: string }>();

  if (!result) return c.json({ error: 'Failed to create account' }, 500);
  const token = await createSessionToken(
    { id: result.id, email: result.email, name: result.name, role: result.role as any },
    c.env.JWT_SECRET
  );
  c.header('Set-Cookie', sessionCookieHeader(token, c.env.APP_URL));
  return c.json({ user: result });
});

authRoutes.post('/login', async (c) => {
  const { email, password } = await c.req.json<{ email?: string; password?: string }>();
  if (!email || !password) return c.json({ error: 'email and password are required' }, 400);

  const user = await c.env.DB.prepare(
    'SELECT id, email, name, role, password_hash FROM users WHERE email = ?'
  )
    .bind(email)
    .first<{ id: number; email: string; name: string; role: string; password_hash: string | null }>();

  if (!user || !user.password_hash) return c.json({ error: 'Invalid email or password' }, 401);
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return c.json({ error: 'Invalid email or password' }, 401);

  const token = await createSessionToken(
    { id: user.id, email: user.email, name: user.name, role: user.role as any },
    c.env.JWT_SECRET
  );
  c.header('Set-Cookie', sessionCookieHeader(token, c.env.APP_URL));
  return c.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

// Frontend obtains a Google ID token via Google Identity Services, then posts it here.
authRoutes.post('/google', async (c) => {
  const { id_token } = await c.req.json<{ id_token?: string }>();
  if (!id_token) return c.json({ error: 'id_token is required' }, 400);

  let payload;
  try {
    payload = await verifyGoogleIdToken(id_token, c.env.GOOGLE_CLIENT_ID);
  } catch {
    return c.json({ error: 'Invalid Google token' }, 401);
  }
  if (!payload.email_verified) return c.json({ error: 'Google email not verified' }, 401);

  let user = await c.env.DB.prepare('SELECT id, email, name, role FROM users WHERE google_sub = ? OR email = ?')
    .bind(payload.sub, payload.email)
    .first<{ id: number; email: string; name: string; role: string }>();

  if (!user) {
    user = await c.env.DB.prepare(
      'INSERT INTO users (email, name, google_sub, role) VALUES (?, ?, ?, ?) RETURNING id, email, name, role'
    )
      .bind(payload.email, payload.name, payload.sub, 'player')
      .first<{ id: number; email: string; name: string; role: string }>();
  } else {
    await c.env.DB.prepare('UPDATE users SET google_sub = ? WHERE id = ?').bind(payload.sub, user.id).run();
  }
  if (!user) return c.json({ error: 'Failed to sign in with Google' }, 500);

  const token = await createSessionToken({ ...user, role: user.role as any }, c.env.JWT_SECRET);
  c.header('Set-Cookie', sessionCookieHeader(token, c.env.APP_URL));
  return c.json({ user });
});

authRoutes.post('/logout', async (c) => {
  c.header('Set-Cookie', clearSessionCookieHeader(c.env.APP_URL));
  return c.json({ ok: true });
});

authRoutes.get('/me', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ user: null });
  return c.json({ user });
});
