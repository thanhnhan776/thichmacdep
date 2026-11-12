// Local integration-test service only: production's API Worker is never modified.
import { importJWK } from 'jose';
import api from '../apps/api/src/index';
import { createAdminAuthRoutes } from '../apps/api/src/routes/admin-auth';
import { createAdminImportRoutes } from '../apps/api/src/routes/admin-import';

type Env = { DB: D1Database; GOOGLE_CLIENT_ID: string; ADMIN_ORIGIN: string; TEST_PUBLIC_JWK: string };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    const prefix = path.startsWith('/api/admin/auth/') ? '/api/admin/auth'
      : path.startsWith('/api/admin/import/') ? '/api/admin/import' : null;
    if (!prefix) return api.fetch(request, env as Parameters<typeof api.fetch>[1], ctx);
    const key = await importJWK(JSON.parse(env.TEST_PUBLIC_JWK), 'RS256');
    if (!(key instanceof CryptoKey)) throw new Error('Expected public key');
    const options = { keys: async () => key };
    const routes = prefix.endsWith('/auth') ? createAdminAuthRoutes(options) : createAdminImportRoutes(options);
    const url = new URL(request.url);
    url.pathname = url.pathname.slice(prefix.length);
    return routes.fetch(new Request(url, request), env, ctx);
  },
};
