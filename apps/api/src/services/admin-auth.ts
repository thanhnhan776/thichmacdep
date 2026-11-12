import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

const GOOGLE_KEYS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const encoder = new TextEncoder();

function randomToken(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface AuthOptions {
  db: D1Database;
  clientId: string;
  clock?: () => Date;
  keys?: JWTVerifyGetKey;
  sessionSeconds?: number;
}

/** Keys may be injected for offline tests; production uses Google's fixed JWKS URL. */
export function createAdminAuth(options: AuthOptions) {
  if (!options.clientId.trim()) throw new Error('Google client ID required');
  const clock = options.clock ?? (() => new Date());
  const lifetime = options.sessionSeconds ?? 8 * 60 * 60;
  if (!Number.isSafeInteger(lifetime) || lifetime <= 0) throw new Error('Invalid session lifetime');

  async function challenge(): Promise<string> {
    const nonce = randomToken();
    const now = clock();
    await options.db.batch([
      options.db.prepare('DELETE FROM admin_login_challenges WHERE expires_at <= ?').bind(now.toISOString()),
      options.db.prepare('INSERT INTO admin_login_challenges (nonce_hash, expires_at) VALUES (?, ?)')
        .bind(await hash(nonce), new Date(now.getTime() + 10 * 60_000).toISOString()),
    ]);
    return nonce;
  }

  async function login(idToken: string, nonce: string): Promise<{ token: string; expiresAt: string }> {
    if (!TOKEN_PATTERN.test(nonce)) throw new Error('Authentication failed');
    const now = clock();
    const verified = await jwtVerify(idToken, options.keys ?? GOOGLE_KEYS, {
      algorithms: ['RS256'], issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: options.clientId, requiredClaims: ['exp', 'sub'], currentDate: now,
    }).catch(() => { throw new Error('Authentication failed'); });
    const claims = verified.payload;
    if (claims.nonce !== nonce || claims.email_verified !== true || typeof claims.email !== 'string' ||
        !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@gmail\.com$/.test(claims.email) ||
        typeof claims.sub !== 'string' || !claims.sub.trim() ||
        (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== options.clientId) ||
        (claims.azp !== undefined && claims.azp !== options.clientId)) throw new Error('Authentication failed');

    // DELETE RETURNING makes each server-issued challenge usable at most once, even concurrently.
    const consumed = await options.db.prepare('DELETE FROM admin_login_challenges WHERE nonce_hash = ? AND expires_at > ? RETURNING nonce_hash')
      .bind(await hash(nonce), now.toISOString()).first();
    if (!consumed) throw new Error('Authentication failed');
    const user = await options.db.prepare(`UPDATE admin_users SET google_sub = ?, updated_at = ?
      WHERE email = ? AND is_enabled = 1 AND role = 'admin' AND (google_sub IS NULL OR google_sub = ?)
      RETURNING id`).bind(claims.sub, now.toISOString(), claims.email, claims.sub)
      .first<{ id: string }>().catch(() => { throw new Error('Authentication failed'); });
    if (!user) throw new Error('Authentication failed');
    const token = randomToken();
    const expiresAt = new Date(now.getTime() + lifetime * 1000).toISOString();
    // Recheck privileges in the INSERT to avoid creating a session for a disabled user.
    const result = await options.db.prepare(`INSERT INTO admin_sessions (id, user_id, token_hash, created_at, expires_at)
      SELECT ?, id, ?, ?, ? FROM admin_users WHERE id = ? AND is_enabled = 1 AND role = 'admin' AND google_sub = ?`)
      .bind(crypto.randomUUID(), await hash(token), now.toISOString(), expiresAt, user.id, claims.sub).run();
    if (result.meta.changes !== 1) throw new Error('Authentication failed');
    return { token, expiresAt };
  }

  async function authenticate(token: string): Promise<{ id: string; email: string } | null> {
    if (!TOKEN_PATTERN.test(token)) return null;
    return options.db.prepare(`SELECT u.id, u.email FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.is_enabled = 1 AND u.role = 'admin'`)
      .bind(await hash(token), clock().toISOString()).first<{ id: string; email: string }>();
  }

  async function revoke(token: string): Promise<void> {
    if (!TOKEN_PATTERN.test(token)) return;
    await options.db.prepare('UPDATE admin_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
      .bind(clock().toISOString(), await hash(token)).run();
  }

  return { challenge, login, authenticate, revoke };
}

/** Only use insecure cookies on an explicitly configured localhost development server. */
export function sessionCookie(token: string, expiresAt: string, secure: boolean): string {
  if (!TOKEN_PATTERN.test(token) || !Number.isFinite(Date.parse(expiresAt))) throw new Error('Invalid session');
  return `admin_session=${token}; Path=/; HttpOnly; SameSite=Strict; Expires=${new Date(expiresAt).toUTCString()}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `admin_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}

/** Return only to an authenticated same-origin client; never put it in a URL or log it. */
export async function csrfSecret(token: string): Promise<string> {
  if (!TOKEN_PATTERN.test(token)) throw new Error('Invalid session');
  return hash(`admin-csrf-v1:${token}`);
}

/** expectedOrigin must come from trusted server configuration, not request headers. */
export async function verifyCsrf(request: Request, expectedOrigin: string, token: string): Promise<boolean> {
  if (!TOKEN_PATTERN.test(token) || request.headers.get('Origin') !== expectedOrigin) return false;
  const supplied = request.headers.get('X-CSRF-Token');
  if (!supplied || !/^[a-f0-9]{64}$/.test(supplied)) return false;
  const expected = await csrfSecret(token);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return difference === 0;
}
