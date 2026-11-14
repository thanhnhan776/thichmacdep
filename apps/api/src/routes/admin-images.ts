import { Hono, type Context } from 'hono';
import { adminConfig, requireAdmin, type AdminAuthBindings, type TestOptions } from './admin-auth';
import { verifyCsrf } from '../services/admin-auth';
import { imageBaseUrl } from '../services/image-url';
import type { Bindings } from '../index';

type ImageBindings = AdminAuthBindings & Pick<Bindings, 'IMAGES' | 'IMAGE_PUBLIC_BASE_URL' | 'IMAGE_ALLOW_LOCAL'>;
type ImageEnv = { Bindings: ImageBindings; Variables: { admin: { id: string; email: string }; adminToken: string } };
const MAX_BYTES = 5 * 1024 * 1024;
const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp|gif)$/;

function imageType(bytes: Uint8Array): { mime: string; extension: string } | null {
  const starts = (signature: number[]) => signature.every((byte, i) => bytes[i] === byte);
  if (starts([0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', extension: 'jpg' };
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', extension: 'png' };
  if (starts([0x47, 0x49, 0x46, 0x38]) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return { mime: 'image/gif', extension: 'gif' };
  if (starts([0x52, 0x49, 0x46, 0x46]) && bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return { mime: 'image/webp', extension: 'webp' };
  return null;
}

async function readImage(request: Request): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { void reader.cancel().catch(() => {}); throw new RangeError(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export function createAdminImageRoutes(options: TestOptions = {}) {
  const app = new Hono<ImageEnv>();
  app.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
  app.use('*', requireAdmin(options));
  app.post('/', async c => {
    if (!await verifyCsrf(c.req.raw, adminConfig(c.env).origin, c.get('adminToken'))) {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Request denied' } }, 403);
    }
    const base = imageBaseUrl(c.env.IMAGE_PUBLIC_BASE_URL, c.env.IMAGE_ALLOW_LOCAL === 'true');
    if (!base) return c.json({ error: { code: 'NOT_CONFIGURED', message: 'Image storage is not configured' } }, 503);
    let bytes: Uint8Array;
    try { bytes = await readImage(c.req.raw); } catch (error) {
      if (error instanceof RangeError) return c.json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request too large' } }, 413);
      return c.json({ error: { code: 'INVALID_INPUT', message: 'Invalid image' } }, 400);
    }
    const type = imageType(bytes);
    if (!type || c.req.header('Content-Type')?.toLowerCase() !== type.mime) {
      return c.json({ error: { code: 'INVALID_INPUT', message: 'Invalid image' } }, 400);
    }
    const key = `${crypto.randomUUID()}.${type.extension}`;
    const local = c.env.IMAGE_ALLOW_LOCAL === 'true' && base.protocol === 'http:' && base.pathname === '/api/images/';
    const objectKey = local ? key : `${base.pathname.slice(1)}${key}`;
    await c.env.IMAGES.put(objectKey, bytes, { httpMetadata: { contentType: type.mime, cacheControl: 'public, max-age=31536000, immutable' } });
    return c.json({ url: new URL(key, base).href }, 201);
  });
  return app;
}

export async function serveLocalImage(c: Context<{ Bindings: Bindings }>) {
  const base = imageBaseUrl(c.env.IMAGE_PUBLIC_BASE_URL, c.env.IMAGE_ALLOW_LOCAL === 'true');
  const requestUrl = new URL(c.req.url);
  const key = c.req.param('key');
  if (c.env.IMAGE_ALLOW_LOCAL !== 'true' || !base || base.protocol !== 'http:' ||
      base.origin !== requestUrl.origin || base.pathname !== '/api/images/' || !key || !KEY.test(key)) return c.notFound();
  const object = await c.env.IMAGES.get(key);
  if (!object) return c.notFound();
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(object.body, { headers });
}
