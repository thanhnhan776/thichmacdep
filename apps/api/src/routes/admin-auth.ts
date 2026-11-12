import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { JWTVerifyGetKey } from 'jose';
import { clearSessionCookie, createAdminAuth, csrfSecret, sessionCookie, verifyCsrf } from '../services/admin-auth';

export type AdminAuthBindings = {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  ADMIN_ORIGIN: string;
  // Explicit opt-in, valid only with an http://localhost origin.
  ADMIN_ALLOW_INSECURE_LOCALHOST?: string;
};

type AdminEnv = { Bindings: AdminAuthBindings; Variables: { admin: { id: string; email: string }; adminToken: string } };
export type TestOptions = { keys?: JWTVerifyGetKey; clock?: () => Date; sessionSeconds?: number };

export function adminConfig(env: AdminAuthBindings): { origin: string; secure: boolean } {
  const origin = env.ADMIN_ORIGIN;
  const url = new URL(origin);
  if (url.origin !== origin || url.username || url.password || !env.GOOGLE_CLIENT_ID?.trim()) throw new Error('Invalid configuration');
  if (url.protocol === 'https:') return { origin, secure: true };
  if (url.protocol === 'http:' && url.hostname === 'localhost' && env.ADMIN_ALLOW_INSECURE_LOCALHOST === 'true') {
    return { origin, secure: false };
  }
  throw new Error('Invalid configuration');
}

// Reject ambiguous duplicate cookies instead of choosing an attacker-controlled value.
function cookie(request: Request, name: string): string | null {
  const matches = (request.headers.get('Cookie') ?? '').split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : null;
}

function nonceCookie(value: string, secure: boolean, clear = false): string {
  return `admin_nonce=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 600}${secure ? '; Secure' : ''}`;
}

const unauthorized = { error: { code: 'UNAUTHORIZED', message: 'Authentication failed' } };
const forbidden = { error: { code: 'FORBIDDEN', message: 'Request denied' } };
const MAX_LOGIN_BYTES = 20 * 1024;
const MAX_OUTSTANDING_CHALLENGES = 1000;

async function readLoginBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError('Missing body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_LOGIN_BYTES) {
        void reader.cancel().catch(() => {});
        throw new RangeError('Body too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function boundedChallenge(db: D1Database, now: Date): Promise<string | null> {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  // This bounds stored challenges, not request volume: edge rate limiting is a production blocker.
  const results = await db.batch([
    db.prepare('DELETE FROM admin_login_challenges WHERE expires_at <= ?').bind(now.toISOString()),
    db.prepare(`INSERT INTO admin_login_challenges (nonce_hash, expires_at)
      SELECT ?, ? WHERE (SELECT COUNT(*) FROM admin_login_challenges) < ?`)
      .bind(hash, new Date(now.getTime() + 10 * 60_000).toISOString(), MAX_OUTSTANDING_CHALLENGES),
  ]);
  return results[1].meta.changes === 1 ? nonce : null;
}

/** Authenticate and recheck the user's current privileges on every request. */
export function requireAdmin(options: TestOptions = {}) {
  return createMiddleware<AdminEnv>(async (c, next) => {
    adminConfig(c.env);
    const token = cookie(c.req.raw, 'admin_session');
    const auth = createAdminAuth({ db: c.env.DB, clientId: c.env.GOOGLE_CLIENT_ID, ...options });
    const admin = token ? await auth.authenticate(token) : null;
    if (!admin || !token) return c.json(unauthorized, 401);
    c.set('admin', admin);
    c.set('adminToken', token);
    await next();
  });
}

/** Admin authentication endpoints. */
export function createAdminAuthRoutes(options: TestOptions = {}) {
  const app = new Hono<AdminEnv>();
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });
  app.get('/config', (c) => {
    try { adminConfig(c.env); } catch {
      return c.json({ error: { code: 'UNAVAILABLE', message: 'Service unavailable' } }, 503);
    }
    return c.json({ googleClientId: c.env.GOOGLE_CLIENT_ID });
  });
  app.post('/challenge', async (c) => {
    const { origin, secure } = adminConfig(c.env);
    if (c.req.header('Origin') !== origin) return c.json(forbidden, 403);
    const nonce = await boundedChallenge(c.env.DB, options.clock?.() ?? new Date());
    if (!nonce) return c.json({ error: { code: 'UNAVAILABLE', message: 'Service unavailable' } }, 503);
    c.header('Set-Cookie', nonceCookie(nonce, secure), { append: true });
    return c.json({ nonce });
  });
  app.post('/login', async (c) => {
    const { origin, secure } = adminConfig(c.env);
    if (c.req.header('Origin') !== origin) return c.json(forbidden, 403);
    c.header('Set-Cookie', nonceCookie('', secure, true), { append: true });
    const nonce = cookie(c.req.raw, 'admin_nonce');
    let body: unknown;
    try { body = await readLoginBody(c.req.raw); } catch (error) {
      if (error instanceof RangeError) return c.json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request too large' } }, 413);
      return c.json(unauthorized, 401);
    }
    if (!nonce || !body || typeof body !== 'object' || !('idToken' in body) || typeof body.idToken !== 'string' || body.idToken.length > 16384) return c.json(unauthorized, 401);
    try {
      const session = await createAdminAuth({ db: c.env.DB, clientId: c.env.GOOGLE_CLIENT_ID, ...options }).login(body.idToken, nonce);
      c.header('Set-Cookie', sessionCookie(session.token, session.expiresAt, secure), { append: true });
      return c.json({ ok: true });
    } catch { return c.json(unauthorized, 401); }
  });
  app.get('/session', requireAdmin(options), async (c) => c.json({ user: c.get('admin'), csrfToken: await csrfSecret(c.get('adminToken')) }));
  app.post('/logout', requireAdmin(options), async (c) => {
    const { origin, secure } = adminConfig(c.env);
    const token = c.get('adminToken');
    if (!await verifyCsrf(c.req.raw, origin, token)) return c.json(forbidden, 403);
    await createAdminAuth({ db: c.env.DB, clientId: c.env.GOOGLE_CLIENT_ID, ...options }).revoke(token);
    c.header('Set-Cookie', clearSessionCookie(secure), { append: true });
    return c.json({ ok: true });
  });
  app.onError((_error, c) => c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500));
  return app;
}
