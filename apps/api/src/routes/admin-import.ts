import { Hono } from 'hono';
import { adminConfig, requireAdmin, type AdminAuthBindings, type TestOptions } from './admin-auth';
import { verifyCsrf } from '../services/admin-auth';
import { validateXlsxInput } from '../services/xlsx-input';
import { previewXlsxImport } from '../services/xlsx-preview';
import { applyXlsxImport } from '../services/xlsx-import';

type AdminEnv = { Bindings: AdminAuthBindings; Variables: { admin: { id: string; email: string }; adminToken: string } };
// Includes a small allowance for the JSON envelope around the 5 MiB row limit.
const MAX_BODY_BYTES = 5 * 1024 * 1024 + 1024;
const invalid = { error: { code: 'INVALID_INPUT', message: 'Invalid import request' } };

async function readBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        throw new RangeError();
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export function createAdminImportRoutes(options: TestOptions = {}) {
  const app = new Hono<AdminEnv>();
  app.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
  app.use('*', requireAdmin(options));
  app.use('*', async (c, next) => {
    if (!await verifyCsrf(c.req.raw, adminConfig(c.env).origin, c.get('adminToken'))) {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Request denied' } }, 403);
    }
    await next();
  });
  app.post('/:action', async (c) => {
    const action = c.req.param('action');
    if (action !== 'preview' && action !== 'apply') return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    if (!/^application\/json(?:\s*;|\s*$)/i.test(c.req.header('Content-Type') ?? '')) return c.json(invalid, 400);
    let body: unknown;
    try { body = await readBody(c.req.raw); } catch (error) {
      if (error instanceof RangeError) return c.json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request too large' } }, 413);
      return c.json(invalid, 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json(invalid, 400);
    const data = body as Record<string, unknown>;
    const allowed = action === 'preview' ? ['rows'] : ['rows', 'digest', 'catalogSnapshot'];
    if (Object.keys(data).some(key => !allowed.includes(key)) || !Object.hasOwn(data, 'rows') ||
        (action === 'apply' && (typeof data.digest !== 'string' || !/^[a-f0-9]{64}$/.test(data.digest) ||
          typeof data.catalogSnapshot !== 'string' || !/^[a-f0-9]{64}$/.test(data.catalogSnapshot)))) return c.json(invalid, 400);
    try { await validateXlsxInput(data.rows); } catch { return c.json(invalid, 400); }
    if (action === 'preview') return c.json(await previewXlsxImport(c.env.DB, data.rows));
    try {
      return c.json(await applyXlsxImport(c.env.DB, data.rows, data.digest as string, data.catalogSnapshot as string));
    } catch (error) {
      if (error instanceof Error && ['XLSX digest mismatch', 'XLSX validation failed', 'XLSX import exceeds apply limits'].includes(error.message)) return c.json(invalid, 400);
      if (error instanceof Error && ['XLSX preview stale', 'XLSX SKU group conflict', 'XLSX category change requires manual resolution', 'Unable to acquire XLSX import lock'].includes(error.message)) {
        return c.json({ error: { code: 'IMPORT_CONFLICT', message: 'Import conflict; preview again or resolve manually' } }, 409);
      }
      throw error;
    }
  });
  app.onError((_error, c) => c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500));
  return app;
}
