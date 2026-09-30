import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireSuperAdmin } from '../middleware';

export const homeRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

homeRoutes.get('/home-content', async (c) => {
  const { results: brochures } = await c.env.DB.prepare(
    `SELECT b.id, b.target_type, b.target_id, b.title, b.brochure_path, b.visible,
            CASE WHEN b.target_type = 'tournament' THEN t.name ELSE s.name END AS target_name
     FROM homepage_brochures b
     LEFT JOIN tournaments t ON b.target_type = 'tournament' AND t.id = b.target_id
     LEFT JOIN competition_series s ON b.target_type = 'series' AND s.id = b.target_id
     WHERE b.visible = 1
     ORDER BY b.created_at DESC`
  ).all();
  const { results: sponsors } = await c.env.DB.prepare(
    'SELECT id, name, logo_url, website_url, display_order FROM homepage_sponsors ORDER BY display_order ASC, id ASC'
  ).all();
  return c.json({
    brochures,
    sponsors,
  });
});

homeRoutes.get('/admin/home-content/brochures', requireSuperAdmin, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT b.id, b.target_type, b.target_id, b.title, b.brochure_path, b.visible,
            CASE WHEN b.target_type = 'tournament' THEN t.name ELSE s.name END AS target_name
     FROM homepage_brochures b
     LEFT JOIN tournaments t ON b.target_type = 'tournament' AND t.id = b.target_id
     LEFT JOIN competition_series s ON b.target_type = 'series' AND s.id = b.target_id
     ORDER BY b.created_at DESC`
  ).all();
  return c.json({ brochures: results });
});

homeRoutes.post('/admin/home-content/brochures', requireSuperAdmin, async (c) => {
  const body = await c.req.json<{
    target_type?: 'tournament' | 'series';
    target_id?: number;
    title?: string;
    brochure_path?: string;
  }>();
  if (!body.target_type || !Number.isInteger(body.target_id) || !body.brochure_path?.trim()) {
    return c.json({ error: 'target_type, target_id, and brochure_path are required' }, 400);
  }
  const table = body.target_type === 'tournament' ? 'tournaments' : 'competition_series';
  const target = await c.env.DB.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(body.target_id).first();
  if (!target) return c.json({ error: 'Target not found' }, 404);
  const brochure = await c.env.DB.prepare(
    `INSERT INTO homepage_brochures (target_type, target_id, title, brochure_path)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(target_type, target_id) DO UPDATE SET title = excluded.title, brochure_path = excluded.brochure_path, visible = 1
     RETURNING *`
  ).bind(body.target_type, body.target_id, body.title?.trim() || null, body.brochure_path.trim()).first();
  return c.json({ brochure }, 201);
});

homeRoutes.delete('/admin/home-content/brochures/:id', requireSuperAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid brochure id' }, 400);
  const result = await c.env.DB.prepare('DELETE FROM homepage_brochures WHERE id = ?').bind(id).run();
  if (!result.meta.changes) return c.json({ error: 'Brochure not found' }, 404);
  return c.json({ ok: true });
});

homeRoutes.post('/admin/home-content/sponsors', requireSuperAdmin, async (c) => {
  const body = await c.req.json<{ name?: string; logo_url?: string; website_url?: string }>();
  const name = body.name?.trim();
  if (!name) return c.json({ error: 'Sponsor name is required' }, 400);
  const logoUrl = body.logo_url?.trim() || null;
  const websiteUrl = body.website_url?.trim() || null;
  const maxOrder = await c.env.DB.prepare('SELECT COALESCE(MAX(display_order), -1) AS value FROM homepage_sponsors')
    .first<{ value: number }>();
  const sponsor = await c.env.DB.prepare(
    'INSERT INTO homepage_sponsors (name, logo_url, website_url, display_order) VALUES (?, ?, ?, ?) RETURNING *'
  ).bind(name, logoUrl, websiteUrl, (maxOrder?.value ?? -1) + 1).first();
  return c.json({ sponsor }, 201);
});

homeRoutes.delete('/admin/home-content/sponsors/:id', requireSuperAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid sponsor id' }, 400);
  const result = await c.env.DB.prepare('DELETE FROM homepage_sponsors WHERE id = ?').bind(id).run();
  if (!result.meta.changes) return c.json({ error: 'Sponsor not found' }, 404);
  return c.json({ ok: true });
});
