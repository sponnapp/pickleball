import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireSuperAdmin } from '../middleware';

export const homeRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const HERO_OBJECT_KEY = 'home/hero';

homeRoutes.get('/home-content/hero', async (c) => {
  const settings = await c.env.DB.prepare('SELECT brochure_path, updated_at FROM homepage_settings WHERE id = 1')
     .first<{ brochure_path: string; updated_at: string }>();
  const path = settings?.brochure_path?.startsWith('home/') ? '/api/home-content/hero/file' : settings?.brochure_path ?? '/Tournament.jpeg';
  return c.json({ path, version: settings?.updated_at ?? 'default' });
});

homeRoutes.get('/home-content/hero/file', async (c) => {
  const object = await c.env.BROCHURE_BUCKET.get(HERO_OBJECT_KEY);
  if (!object) return c.notFound();
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'no-cache, must-revalidate');
  return new Response(object.body, { headers });
});

function brochureObjectKey(targetType: 'tournament' | 'series', targetId: number) {
  return `brochures/${targetType}-${targetId}`;
}

homeRoutes.get('/home-content/brochures/:id/file', async (c) => {
  const brochure = await c.env.DB.prepare('SELECT brochure_path FROM homepage_brochures WHERE id = ? AND visible = 1')
    .bind(c.req.param('id'))
    .first<{ brochure_path: string }>();
  if (!brochure) return c.notFound();
  const object = await c.env.BROCHURE_BUCKET.get(brochure.brochure_path);
  if (!object) return c.notFound();
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  return new Response(object.body, { headers });
});

homeRoutes.get('/home-content/sponsors/:id/logo', async (c) => {
  const sponsor = await c.env.DB.prepare('SELECT logo_url FROM homepage_sponsors WHERE id = ?')
    .bind(c.req.param('id'))
    .first<{ logo_url: string | null }>();
  if (!sponsor?.logo_url?.startsWith('sponsors/')) return c.notFound();
  const object = await c.env.BROCHURE_BUCKET.get(sponsor.logo_url);
  if (!object) return c.notFound();
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(object.body, { headers });
});

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
    brochures: brochures.map((brochure) => ({
      ...brochure,
      brochure_path: String(brochure.brochure_path).startsWith('brochures/')
        ? `/api/home-content/brochures/${brochure.id}/file`
        : brochure.brochure_path,
    })),
    sponsors: sponsors.map((sponsor) => ({
      ...sponsor,
      logo_url: String(sponsor.logo_url ?? '').startsWith('sponsors/')
        ? `/api/home-content/sponsors/${sponsor.id}/logo`
        : sponsor.logo_url,
    })),
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

homeRoutes.post('/admin/home-content/hero/upload', requireSuperAdmin, async (c) => {
  const form = await c.req.formData();
  const fileEntry = form.get('file');
  if (!fileEntry || typeof fileEntry === 'string') return c.json({ error: 'An image file is required' }, 400);
  const file = fileEntry as unknown as { type: string; size: number; stream: () => ReadableStream };
  if (!file.type.startsWith('image/')) return c.json({ error: 'Hero must be an image file' }, 400);
  if (file.size > 8 * 1024 * 1024) return c.json({ error: 'Hero image must be 8 MB or smaller' }, 400);
  await c.env.BROCHURE_BUCKET.put(HERO_OBJECT_KEY, file.stream(), {
    httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=3600' },
  });
  await c.env.DB.prepare("UPDATE homepage_settings SET brochure_path = ?, updated_at = datetime('now') WHERE id = 1")
    .bind(HERO_OBJECT_KEY)
    .run();
    const settings = await c.env.DB.prepare('SELECT updated_at FROM homepage_settings WHERE id = 1')
      .first<{ updated_at: string }>();
    return c.json({ path: '/api/home-content/hero/file', version: settings?.updated_at ?? Date.now().toString() });
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

homeRoutes.post('/admin/home-content/brochures/upload', requireSuperAdmin, async (c) => {
  const form = await c.req.formData();
  const targetType = form.get('target_type');
  const targetIdValue = form.get('target_id');
  const title = form.get('title');
  const fileEntry = form.get('file');
  if ((targetType !== 'tournament' && targetType !== 'series') || typeof targetIdValue !== 'string' || !fileEntry || typeof fileEntry === 'string') {
    return c.json({ error: 'target_type, target_id, and an image file are required' }, 400);
  }
  const file = fileEntry as unknown as { type: string; size: number; stream: () => ReadableStream };
  const targetId = Number(targetIdValue);
  if (!Number.isInteger(targetId) || targetId < 1) return c.json({ error: 'Invalid target id' }, 400);
  if (!file.type.startsWith('image/')) return c.json({ error: 'Brochure must be an image file' }, 400);
  if (file.size > 8 * 1024 * 1024) return c.json({ error: 'Brochure image must be 8 MB or smaller' }, 400);
  const table = targetType === 'tournament' ? 'tournaments' : 'competition_series';
  const target = await c.env.DB.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(targetId).first();
  if (!target) return c.json({ error: 'Target not found' }, 404);

  const key = brochureObjectKey(targetType, targetId);
  await c.env.BROCHURE_BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=3600' },
  });
  const brochure = await c.env.DB.prepare(
    `INSERT INTO homepage_brochures (target_type, target_id, title, brochure_path)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(target_type, target_id) DO UPDATE SET title = excluded.title, brochure_path = excluded.brochure_path, visible = 1
     RETURNING *`
  ).bind(targetType, targetId, typeof title === 'string' && title.trim() ? title.trim() : null, key).first();
  return c.json({ brochure }, 201);
});

homeRoutes.delete('/admin/home-content/brochures/:id', requireSuperAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid brochure id' }, 400);
  const brochure = await c.env.DB.prepare('SELECT target_type, target_id, brochure_path FROM homepage_brochures WHERE id = ?')
    .bind(id)
    .first<{ target_type: 'tournament' | 'series'; target_id: number; brochure_path: string }>();
  const result = await c.env.DB.prepare('DELETE FROM homepage_brochures WHERE id = ?').bind(id).run();
  if (!result.meta.changes) return c.json({ error: 'Brochure not found' }, 404);
  if (brochure?.brochure_path.startsWith('brochures/')) await c.env.BROCHURE_BUCKET.delete(brochure.brochure_path);
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

homeRoutes.post('/admin/home-content/sponsors/upload', requireSuperAdmin, async (c) => {
  const form = await c.req.formData();
  const name = form.get('name');
  const websiteUrl = form.get('website_url');
  const fileEntry = form.get('file');
  if (typeof name !== 'string' || !name.trim() || !fileEntry || typeof fileEntry === 'string') {
    return c.json({ error: 'Sponsor name and an image file are required' }, 400);
  }
  const file = fileEntry as unknown as { type: string; size: number; stream: () => ReadableStream };
  const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    return c.json({ error: 'Sponsor logo must be a PNG, JPG, or WebP image' }, 400);
  }
  if (file.size > 5 * 1024 * 1024) return c.json({ error: 'Sponsor logo must be 5 MB or smaller' }, 400);

  const maxOrder = await c.env.DB.prepare('SELECT COALESCE(MAX(display_order), -1) AS value FROM homepage_sponsors')
    .first<{ value: number }>();
  const objectKey = `sponsors/${crypto.randomUUID()}`;
  await c.env.BROCHURE_BUCKET.put(objectKey, file.stream(), {
    httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' },
  });
  try {
    const sponsor = await c.env.DB.prepare(
      'INSERT INTO homepage_sponsors (name, logo_url, website_url, display_order) VALUES (?, ?, ?, ?) RETURNING *'
    ).bind(name.trim(), objectKey, typeof websiteUrl === 'string' ? websiteUrl.trim() || null : null, (maxOrder?.value ?? -1) + 1).first();
    return c.json({ sponsor }, 201);
  } catch (error) {
    await c.env.BROCHURE_BUCKET.delete(objectKey);
    throw error;
  }
});

homeRoutes.delete('/admin/home-content/sponsors/:id', requireSuperAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid sponsor id' }, 400);
  const sponsor = await c.env.DB.prepare('SELECT logo_url FROM homepage_sponsors WHERE id = ?')
    .bind(id)
    .first<{ logo_url: string | null }>();
  const result = await c.env.DB.prepare('DELETE FROM homepage_sponsors WHERE id = ?').bind(id).run();
  if (!result.meta.changes) return c.json({ error: 'Sponsor not found' }, 404);
  if (sponsor?.logo_url?.startsWith('sponsors/')) await c.env.BROCHURE_BUCKET.delete(sponsor.logo_url);
  return c.json({ ok: true });
});
