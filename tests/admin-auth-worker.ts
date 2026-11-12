import { generateKeyPair, SignJWT } from 'jose';
import { createAdminAuth, csrfSecret, sessionCookie, verifyCsrf } from '../apps/api/src/services/admin-auth.ts';
import { createAdminAuthRoutes } from '../apps/api/src/routes/admin-auth.ts';
import { createAdminImportRoutes } from '../apps/api/src/routes/admin-import.ts';
import { createAdminUserRoutes } from '../apps/api/src/routes/admin-users.ts';

function assert(value: unknown): asserts value {
  if (!value) throw new Error('Authentication test assertion failed');
}

async function rejects(action: () => Promise<unknown>): Promise<void> {
  let rejected = false;
  try { await action(); } catch { rejected = true; }
  assert(rejected);
}

export default {
  async fetch(_request: Request, env: { DB: D1Database }): Promise<Response> {
    try {
      const db = env.DB;
      await db.prepare("INSERT INTO admin_users (id, email, role, is_enabled, created_at, updated_at) VALUES ('a', 'admin@gmail.com', 'admin', 1, '2026', '2026')").run();
      const keys = await generateKeyPair('RS256');
      const other = await generateKeyPair('RS256');
      let now = new Date('2026-11-12T00:00:00.000Z');
      const auth = createAdminAuth({ db, clientId: 'test-client', keys: async () => keys.publicKey, clock: () => now, sessionSeconds: 60 });
      const sign = (nonce: string, overrides: Record<string, unknown> = {}, key = keys.privateKey) => new SignJWT({
        email: 'admin@gmail.com', email_verified: true, nonce, ...overrides,
      }).setProtectedHeader({ alg: 'RS256' }).setIssuer('https://accounts.google.com')
        .setAudience('test-client').setSubject('google-subject').setExpirationTime(Math.floor(now.getTime() / 1000) + 60).sign(key);
      const nonce = await auth.challenge();
      const jwt = await sign(nonce);
      const session = await auth.login(jwt, nonce);
      assert((await auth.authenticate(session.token))?.id === 'a');
      assert(sessionCookie(session.token, session.expiresAt, true).includes('HttpOnly; SameSite=Strict;'));
      assert(await verifyCsrf(new Request('https://example.test/', { headers: { Origin: 'https://example.test', 'X-CSRF-Token': await csrfSecret(session.token) } }), 'https://example.test', session.token));
      assert(!await verifyCsrf(new Request('https://example.test/', { headers: { Origin: 'https://evil.test', 'X-CSRF-Token': await csrfSecret(session.token) } }), 'https://example.test', session.token));
      await rejects(() => auth.login(jwt, nonce));
      const n2 = await auth.challenge();
      await rejects(async () => auth.login(await sign(n2, {}, other.privateKey), n2));
      await rejects(async () => auth.login(await sign(n2, { nonce: 'wrong' }), n2));
      const wrongAudience = await new SignJWT({ nonce: n2, email: 'admin@gmail.com', email_verified: true }).setProtectedHeader({ alg: 'RS256' }).setIssuer('accounts.google.com').setAudience('wrong').setSubject('google-subject').setExpirationTime(Math.floor(now.getTime() / 1000) + 60).sign(keys.privateKey);
      await rejects(() => auth.login(wrongAudience, n2));
      const expired = await new SignJWT({ nonce: n2, email: 'admin@gmail.com', email_verified: true }).setProtectedHeader({ alg: 'RS256' }).setIssuer('accounts.google.com').setAudience('test-client').setSubject('google-subject').setExpirationTime(Math.floor(now.getTime() / 1000) - 1).sign(keys.privateKey);
      await rejects(() => auth.login(expired, n2));
      await auth.revoke(session.token);
      assert(!await auth.authenticate(session.token));
      const n3 = await auth.challenge();
      const session2 = await auth.login(await sign(n3), n3);
      now = new Date(now.getTime() + 60_000);
      assert(!await auth.authenticate(session2.token));
      const n4 = await auth.challenge();
      await db.prepare("UPDATE admin_users SET is_enabled = 0 WHERE id = 'a'").run();
      await rejects(async () => auth.login(await sign(n4), n4));
      await db.prepare("UPDATE admin_users SET is_enabled = 1 WHERE id = 'a'").run();
      const routes = createAdminAuthRoutes({ keys: async () => keys.publicKey, clock: () => now, sessionSeconds: 60 });
      const bindings = { DB: db, GOOGLE_CLIENT_ID: 'test-client', ADMIN_ORIGIN: 'https://admin.example.test' };
      const request = (path: string, init?: RequestInit) => routes.request(`https://api.example.test${path}`, init, bindings);
      const config = await request('/config');
      assert(config.status === 200 && config.headers.get('Cache-Control') === 'no-store');
      assert(JSON.stringify(await config.json()) === JSON.stringify({ googleClientId: 'test-client' }));
      const missingConfig = await routes.request('https://api.example.test/config', {}, { ...bindings, GOOGLE_CLIENT_ID: undefined } as unknown as typeof bindings);
      assert(missingConfig.status === 503 && missingConfig.headers.get('Cache-Control') === 'no-store');
      for (const invalid of [{ GOOGLE_CLIENT_ID: '' }, { GOOGLE_CLIENT_ID: '  ' }, { ADMIN_ORIGIN: '' }, { ADMIN_ORIGIN: 'http://localhost:4200' }]) {
        const response = await routes.request('https://api.example.test/config', {}, { ...bindings, ...invalid });
        assert(response.status === 503 && response.headers.get('Cache-Control') === 'no-store');
        assert(!JSON.stringify(await response.json()).includes('test-client'));
      }
      const getChallenge = await request('/challenge', { headers: { Origin: bindings.ADMIN_ORIGIN } });
      assert(getChallenge.status === 404 && !getChallenge.headers.has('Set-Cookie'));
      for (const origin of [undefined, 'https://evil.test']) {
        const headers: Record<string, string> = origin ? { Origin: origin } : {};
        const denied = await request('/challenge', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' });
        assert(denied.status === 403 && !denied.headers.has('Set-Cookie'));
        assert(!denied.headers.has('Access-Control-Allow-Origin') && !denied.headers.has('Access-Control-Allow-Credentials'));
        const deniedLogin = await request('/login', { method: 'POST', headers, body: '{}' });
        assert(deniedLogin.status === 403 && !deniedLogin.headers.has('Set-Cookie'));
      }
      const challenge = await request('/challenge', { method: 'POST', headers: { Origin: bindings.ADMIN_ORIGIN, 'Content-Type': 'application/json' }, body: '{}' });
      const challengeCookie = challenge.headers.get('Set-Cookie') ?? '';
      const { nonce: routeNonce } = await challenge.json() as { nonce: string };
      assert(challenge.status === 200 && challengeCookie.includes('HttpOnly; SameSite=Strict; Max-Age=600; Secure'));
      const jwt2 = await sign(routeNonce);
      const loginHeaders = { Origin: bindings.ADMIN_ORIGIN, Cookie: `admin_nonce=${routeNonce}`, 'Content-Type': 'application/json' };
      for (const length of [undefined, '1']) {
        const headers: Record<string, string> = { ...loginHeaders };
        if (length) headers['Content-Length'] = length;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(20 * 1024));
            controller.enqueue(new Uint8Array(1));
            controller.close();
          },
        });
        const oversized = await request('/login', { method: 'POST', headers, body });
        assert(oversized.status === 413);
      }
      assert((await request('/login', { method: 'POST', headers: { ...loginHeaders, Origin: 'https://evil.test' }, body: JSON.stringify({ idToken: jwt2 }) })).status === 403);
      assert((await request('/login', { method: 'POST', headers: { ...loginHeaders, Cookie: `admin_nonce=${routeNonce}; admin_nonce=bad` }, body: JSON.stringify({ idToken: jwt2 }) })).status === 401);
      const login = await request('/login', { method: 'POST', headers: loginHeaders, body: JSON.stringify({ idToken: jwt2 }) });
      const cookies = login.headers.get('Set-Cookie') ?? '';
      const sessionToken = /admin_session=([A-Za-z0-9_-]{43})/.exec(cookies)?.[1];
      assert(login.status === 200 && cookies.includes('admin_nonce=;') && cookies.includes('Max-Age=0') && cookies.includes('Secure') && sessionToken);
      assert((await request('/login', { method: 'POST', headers: loginHeaders, body: JSON.stringify({ idToken: jwt2 }) })).status === 401);
      const sessionHeaders = { Cookie: `admin_session=${sessionToken}` };
      const sessionResponse = await request('/session', { headers: sessionHeaders });
      const sessionBody = await sessionResponse.json() as { csrfToken: string; user: { id: string } };
      assert(sessionResponse.status === 200 && sessionBody.user.id === 'a' && sessionBody.csrfToken === await csrfSecret(sessionToken));
      await db.prepare("UPDATE admin_users SET is_enabled = 0 WHERE id = 'a'").run();
      assert((await request('/session', { headers: sessionHeaders })).status === 401);
      await db.prepare("UPDATE admin_users SET is_enabled = 1 WHERE id = 'a'").run();
      const imports = createAdminImportRoutes({ keys: async () => keys.publicKey, clock: () => now });
      const importRequest = (path: string, init: RequestInit) => imports.request(`https://api.example.test/${path}`, init, bindings);
      const importHeaders = { ...sessionHeaders, Origin: bindings.ADMIN_ORIGIN, 'X-CSRF-Token': sessionBody.csrfToken, 'Content-Type': 'application/json' };
      const rows = [{ 'Loại hàng': 'Hàng hóa', 'Mã hàng': 'TEST', 'Tên hàng': 'Example', 'Nhóm hàng(3 Cấp)': 'Category', 'Thương hiệu': 'Brand', 'Giá bán': 100, 'Đang kinh doanh': true, 'Được bán trực tiếp': true, 'Hình ảnh (url1,url2...)': 'https://cdn2-retail-images.kiotviet.vn/example.jpg', 'Thuộc tính': '' }];
      const post = (headers: Record<string, string>, body: unknown) => ({ method: 'POST', headers, body: JSON.stringify(body) });
      const users = createAdminUserRoutes({ clock: () => now });
      const userRequest = (headers: Record<string, string>, body: unknown) => users.request('https://api.example.test/', post(headers, body), bindings);
      const newAdmin = { email: 'new.admin@gmail.com' };
      assert((await userRequest({ 'Content-Type': 'application/json' }, newAdmin)).status === 401);
      assert((await userRequest({ ...importHeaders, 'X-CSRF-Token': '' }, newAdmin)).status === 403);
      assert((await userRequest({ ...importHeaders, Origin: 'https://evil.test' }, newAdmin)).status === 403);
      for (const email of ['Admin@gmail.com', 'bad..email@gmail.com', '.bad@gmail.com', 'bad@gmail.com.evil', 'bad@example.com', ' bad@gmail.com']) {
        assert((await userRequest(importHeaders, { email })).status === 400);
      }
      assert((await userRequest(importHeaders, { ...newAdmin, role: 'admin' })).status === 400);
      const createdAdmin = await userRequest(importHeaders, newAdmin);
      assert(createdAdmin.status === 201 && createdAdmin.headers.get('Cache-Control') === 'no-store');
      const createdBody = JSON.stringify(await createdAdmin.json());
      assert(!createdBody.includes(sessionToken) && !createdBody.includes(sessionBody.csrfToken));
      const added = await db.prepare('SELECT role, is_enabled, google_sub FROM admin_users WHERE email = ?').bind(newAdmin.email).first<{ role: string; is_enabled: number; google_sub: string | null }>();
      assert(added?.role === 'admin' && added.is_enabled === 1 && added.google_sub === null);
      assert((await userRequest(importHeaders, newAdmin)).status === 409);
      await db.prepare('UPDATE admin_users SET is_enabled = 0 WHERE email = ?').bind(newAdmin.email).run();
      assert((await userRequest(importHeaders, newAdmin)).status === 409);
      assert((await db.prepare('SELECT is_enabled FROM admin_users WHERE email = ?').bind(newAdmin.email).first<{ is_enabled: number }>())?.is_enabled === 0);
      await db.prepare('UPDATE admin_users SET is_enabled = 0 WHERE id = ?').bind('a').run();
      assert((await userRequest(importHeaders, { email: 'another@gmail.com' })).status === 401);
      await db.prepare('UPDATE admin_users SET is_enabled = 1 WHERE id = ?').bind('a').run();
      assert((await importRequest('preview', post({ 'Content-Type': 'application/json' }, { rows }))).status === 401);
      const unread = new Request('https://api.example.test/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"rows":[]}' });
      assert((await imports.fetch(unread, bindings)).status === 401 && !unread.bodyUsed);
      const noCsrf = new Request('https://api.example.test/preview', { method: 'POST', headers: { ...importHeaders, 'X-CSRF-Token': '' }, body: '{"rows":[]}' });
      assert((await imports.fetch(noCsrf, bindings)).status === 403 && !noCsrf.bodyUsed);
      assert((await imports.request('https://api.example.test/preview', post(importHeaders, { rows }), { ...bindings, GOOGLE_CLIENT_ID: '' })).status === 500);
      assert((await imports.request('https://api.example.test/preview', post(importHeaders, { rows }), { ...bindings, ADMIN_ORIGIN: '' })).status === 500);
      assert((await importRequest('preview', post({ ...importHeaders, Origin: 'https://evil.test' }, { rows }))).status === 403);
      assert((await importRequest('preview', post({ ...importHeaders, 'X-CSRF-Token': '' }, { rows }))).status === 403);
      await db.prepare("UPDATE admin_users SET is_enabled = 0 WHERE id = 'a'").run();
      assert((await importRequest('preview', post(importHeaders, { rows }))).status === 401);
      await db.prepare("UPDATE admin_users SET is_enabled = 1 WHERE id = 'a'").run();
      const oversized = new ReadableStream<Uint8Array>({ start(controller) {
        for (let i = 0; i < 6; i++) controller.enqueue(new Uint8Array(1024 * 1024));
        controller.close();
      } });
      assert((await importRequest('preview', { method: 'POST', headers: { ...importHeaders, 'Content-Length': '1' }, body: oversized })).status === 413);
      assert((await importRequest('preview', post(importHeaders, { rows: [{}], extra: true }))).status === 400);
      assert((await importRequest('preview', post(importHeaders, { rows: [{ bad: {} }] }))).status === 400);
      const preview = await importRequest('preview', post(importHeaders, { rows }));
      const previewBody = await preview.json() as { digest: string; catalogSnapshot: string; errors: unknown[] };
      assert(preview.status === 200 && previewBody.errors.length === 0 && /^[a-f0-9]{64}$/.test(previewBody.digest) && /^[a-f0-9]{64}$/.test(previewBody.catalogSnapshot));
      assert((await importRequest('apply', post(importHeaders, { rows, digest: '0'.repeat(64), catalogSnapshot: previewBody.catalogSnapshot }))).status === 400);
      const applied = await importRequest('apply', post(importHeaders, { rows, digest: previewBody.digest, catalogSnapshot: previewBody.catalogSnapshot }));
      const result = await applied.json() as { created: number; updated: number };
      assert(applied.status === 200 && result.created === 1 && result.updated === 0);
      assert((await importRequest('apply', post(importHeaders, { rows, digest: previewBody.digest, catalogSnapshot: previewBody.catalogSnapshot }))).status === 409);
      assert((await request('/logout', { method: 'POST', headers: { ...sessionHeaders, Origin: bindings.ADMIN_ORIGIN } })).status === 403);
      assert((await request('/logout', { method: 'POST', headers: { ...sessionHeaders, Origin: 'https://evil.test', 'X-CSRF-Token': sessionBody.csrfToken } })).status === 403);
      const logout = await request('/logout', { method: 'POST', headers: { ...sessionHeaders, Origin: bindings.ADMIN_ORIGIN, 'X-CSRF-Token': sessionBody.csrfToken } });
      assert(logout.status === 200 && (logout.headers.get('Set-Cookie') ?? '').includes('Max-Age=0'));
      assert((await request('/session', { headers: sessionHeaders })).status === 401);
      assert((await routes.request('http://localhost/challenge', { method: 'POST' }, { ...bindings, ADMIN_ORIGIN: 'http://localhost' })).status === 500);
      const local = await routes.request('http://localhost/challenge', { method: 'POST', headers: { Origin: 'http://localhost' }, body: '{}' }, { ...bindings, ADMIN_ORIGIN: 'http://localhost', ADMIN_ALLOW_INSECURE_LOCALHOST: 'true' });
      assert(local.status === 200 && !(local.headers.get('Set-Cookie') ?? '').includes('Secure'));
      await db.prepare('DELETE FROM admin_login_challenges').run();
      await db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 1000)
        INSERT INTO admin_login_challenges (nonce_hash, expires_at) SELECT printf('%064x', x), '2099-01-01T00:00:00.000Z' FROM n`).run();
      const full = await request('/challenge', { method: 'POST', headers: { Origin: bindings.ADMIN_ORIGIN }, body: '{}' });
      assert(full.status === 503 && !full.headers.has('Set-Cookie'));
      const count = await db.prepare('SELECT COUNT(*) AS count FROM admin_login_challenges').first<{ count: number }>();
      assert(count?.count === 1000);
      return Response.json({ ok: true });
    } catch {
      return Response.json({ ok: false }, { status: 500 });
    }
  },
};
