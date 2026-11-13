import { checkApiRateLimit, type RateLimitEnv } from './api-rate-limit';

describe('storefront API rate limits', () => {
  const request = (path: string, method = 'POST', ip: string | null = '192.0.2.1', extra: Record<string, string> = {}) =>
    new Request(`https://example.test${path}`, { method, headers: { ...extra, ...(ip === null ? {} : { 'CF-Connecting-IP': ip }) } });

  it('shares the auth bucket and separates admin writes by IP', async () => {
    const auth: string[] = [], writes: string[] = [];
    const env: RateLimitEnv = {
      AUTH_RATE_LIMITER: { limit: async ({ key }) => { auth.push(key); return { success: auth.length <= 2 }; } },
      ADMIN_WRITE_RATE_LIMITER: { limit: async ({ key }) => { writes.push(key); return { success: true }; } },
    };
    expect(await checkApiRateLimit(request('/api/admin/auth/challenge'), env)).toBeNull();
    expect(await checkApiRateLimit(request('/api/admin/auth/login'), env)).toBeNull();
    const denied = await checkApiRateLimit(request('/api/admin/auth/login'), env);
    expect(denied?.status).toBe(429);
    expect(denied?.headers.get('Retry-After')).toBe('60');
    expect(denied?.headers.get('Cache-Control')).toBe('no-store');
    expect(await checkApiRateLimit(request('/api/admin/users', 'DELETE', '192.0.2.2'), env)).toBeNull();
    expect(auth).toEqual(['192.0.2.1', '192.0.2.1', '192.0.2.1']);
    expect(writes).toEqual(['192.0.2.2']);
    expect(await checkApiRateLimit(request('/api/admin/auth/session', 'GET', null), env)).toBeNull();
    expect(await checkApiRateLimit(request('/api/products', 'GET', null), env)).toBeNull();
  });

  it('fails closed for untrusted, invalid, or missing IPs and broken bindings', async () => {
    const ok: RateLimitEnv = { AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) } };
    for (const ip of [null, 'unknown', '192.0.2.1, 192.0.2.2', '999.1.1.1', '::1%eth0']) {
      expect((await checkApiRateLimit(request('/api/admin/auth/login', 'POST', ip, { 'X-Forwarded-For': '192.0.2.1' }), ok))?.status).toBe(503);
    }
    expect((await checkApiRateLimit(request('/api/admin/auth/login'), {}))?.status).toBe(503);
    const broken: RateLimitEnv = { AUTH_RATE_LIMITER: { limit: async () => { throw new Error('unavailable'); } } };
    expect((await checkApiRateLimit(request('/api/admin/auth/login'), broken))?.status).toBe(503);
    expect(await checkApiRateLimit(request('/api/admin/auth/login', 'POST', '2001:db8::1'), ok)).toBeNull();
  });

  it('rejects encoded paths before forwarding and does not trust spoofed proxy headers', async () => {
    const env: RateLimitEnv = { AUTH_RATE_LIMITER: { limit: async () => ({ success: false }) } };
    for (const path of ['/api/%61dmin/auth/login', '/api/admin/auth/%6cogin', '/api/admin/auth/login%2f', '/api/admin/auth/%256cogin']) {
      expect((await checkApiRateLimit(request(path), env))?.status).toBe(400);
    }
    expect((await checkApiRateLimit(request('/api/admin/auth/login', 'POST', null, { 'X-Real-IP': '192.0.2.1' }), env))?.status).toBe(503);
  });
});
