import { Hono } from 'hono';
import { adminConfig, requireAdmin, type AdminAuthBindings, type TestOptions } from './admin-auth';
import { verifyCsrf } from '../services/admin-auth';

type AdminEnv = { Bindings: AdminAuthBindings; Variables: { admin: { id: string; email: string }; adminToken: string } };
const invalid = { error: { code: 'INVALID_INPUT', message: 'Invalid admin email' } };

export function createAdminUserRoutes(options: TestOptions = {}) {
  const app = new Hono<AdminEnv>();
  app.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
  app.use('*', requireAdmin(options));
  app.post('/', async (c) => {
    if (!await verifyCsrf(c.req.raw, adminConfig(c.env).origin, c.get('adminToken'))) {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Request denied' } }, 403);
    }
    if (!/^application\/json(?:\s*;|\s*$)/i.test(c.req.header('Content-Type') ?? '')) return c.json(invalid, 400);
    const reader = c.req.raw.body?.getReader();
    if (!reader) return c.json(invalid, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 1024) { void reader.cancel().catch(() => {}); return c.json(invalid, 400); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let body: unknown;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return c.json(invalid, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'email')) return c.json(invalid, 400);
    const email = (body as { email: unknown }).email;
    if (typeof email !== 'string' || email.length > 74 || !/^[a-z0-9]+(?:[a-z0-9.+_-]*[a-z0-9])?@gmail\.com$/.test(email) || email.includes('..')) return c.json(invalid, 400);
    const now = (options.clock?.() ?? new Date()).toISOString();
    const result = await c.env.DB.prepare(`INSERT INTO admin_users (id, email, google_sub, role, is_enabled, created_at, updated_at)
      VALUES (?, ?, NULL, 'admin', 1, ?, ?) ON CONFLICT(email) DO NOTHING`)
      .bind(crypto.randomUUID(), email, now, now).run();
    if (result.meta.changes !== 1) return c.json({ error: { code: 'DUPLICATE', message: 'Admin email already exists' } }, 409);
    return c.json({ ok: true }, 201);
  });
  app.onError((_error, c) => c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500));
  return app;
}
