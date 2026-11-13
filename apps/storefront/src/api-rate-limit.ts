interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface RateLimitEnv {
  AUTH_RATE_LIMITER?: RateLimiter;
  ADMIN_WRITE_RATE_LIMITER?: RateLimiter;
}

function clientIp(value: string | null): string | null {
  if (!value || value !== value.trim()) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(value)) {
    const parts = value.split('.');
    return parts.every((part) => String(Number(part)) === part && Number(part) <= 255) ? value : null;
  }
  if (!/^[a-f\d:.]+$/i.test(value) || !value.includes(':')) return null;
  try {
    return new URL(`http://[${value}]/`).hostname.slice(1, -1);
  } catch {
    return null;
  }
}

// Reject encoded mutation paths rather than guessing how an upstream router decodes them.
export async function checkApiRateLimit(request: Request, env: RateLimitEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return null;
  if (path.includes('%') || path.includes('\\')) return new Response('Invalid path', { status: 400, headers: { 'Cache-Control': 'no-store' } });
  if (path !== '/api/admin' && !path.startsWith('/api/admin/')) return null;
  const isAuth = request.method === 'POST' && (path === '/api/admin/auth/challenge' || path === '/api/admin/auth/login');
  const limiter = isAuth ? env.AUTH_RATE_LIMITER : env.ADMIN_WRITE_RATE_LIMITER;
  const ip = clientIp(request.headers.get('CF-Connecting-IP'));
  if (!ip || !limiter || typeof limiter.limit !== 'function') return unavailable();
  try {
    const result = await limiter.limit({ key: ip });
    if (result?.success === true) return null;
    if (result?.success === false) return new Response('Too Many Requests', { status: 429, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } });
  } catch {
    // A failing binding must not turn off the protection.
  }
  return unavailable();
}

function unavailable(): Response {
  return new Response('Service Unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } });
}
