import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, Variables } from './types';
import { loadUser } from './middleware';
import { authRoutes } from './routes/auth';
import { tournamentRoutes } from './routes/tournaments';
import { teamRoutes } from './routes/teams';
import { courtRoutes } from './routes/courts';
import { matchRoutes } from './routes/matches';
import { userRoutes } from './routes/users';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', async (c, next) => {
  const middleware = cors({
    origin: (origin) => {
      if (!origin) return c.env.APP_URL;
      if (
        origin === c.env.APP_URL ||
        origin.endsWith('.pages.dev') ||
        origin === 'https://azts-pickleball.com' ||
        origin === 'https://www.azts-pickleball.com' ||
        origin === 'http://localhost:5173'
      ) {
        return origin;
      }
      return c.env.APP_URL;
    },
    credentials: true,
  });
  return middleware(c, next);
});
app.use('*', loadUser);

app.get('/api/health', (c) => c.json({ ok: true }));

app.route('/api/auth', authRoutes);
app.route('/api/tournaments', tournamentRoutes);
app.route('/api', teamRoutes);
app.route('/api', courtRoutes);
app.route('/api', matchRoutes);
app.route('/api/users', userRoutes);

export default app;
