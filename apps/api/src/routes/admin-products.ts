import { Hono } from 'hono';
import { adminConfig, requireAdmin, type AdminAuthBindings, type TestOptions } from './admin-auth';
import { verifyCsrf } from '../services/admin-auth';
import { imageBaseUrl, publicImageUrl } from '../services/image-url';
import type { Bindings } from '../index';

type AdminEnv = { Bindings: AdminAuthBindings & Partial<Pick<Bindings, 'IMAGES' | 'IMAGE_PUBLIC_BASE_URL' | 'IMAGE_ALLOW_LOCAL'>>; Variables: { admin: { id: string; email: string }; adminToken: string } };
type ProductInput = {
  sku: string | null; slug: string; name: string; description: string | null;
  brandName: string | null; priceMinor: number | null; currency: string;
  isActive: boolean; isTrending: boolean; trendingSortOrder: number;
};
const invalid = { error: { code: 'INVALID_INPUT', message: 'Invalid product' } };
const conflict = { error: { code: 'CONFLICT', message: 'Catalog is busy or product conflicts with existing data' } };

function productInput(value: unknown, partialTrending = false): ProductInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const fields = ['sku', 'slug', 'name', 'description', 'brandName', 'priceMinor', 'currency', 'isActive', 'isTrending', 'trendingSortOrder'];
  if (Object.keys(v).some(key => !fields.includes(key)) || fields.some(key =>
    !Object.hasOwn(v, key) && !(partialTrending && (key === 'isTrending' || key === 'trendingSortOrder')))) return null;
  const nullableText = (item: unknown, max: number) => item === null || (typeof item === 'string' && item.length <= max);
  if (typeof v.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v.slug) || v.slug.length > 200 ||
      typeof v.name !== 'string' || !v.name.trim() || v.name.length > 200 ||
      !nullableText(v.sku, 200) || !nullableText(v.brandName, 200) || !nullableText(v.description, 20000) ||
      !(v.priceMinor === null || (Number.isSafeInteger(v.priceMinor) && (v.priceMinor as number) >= 0)) ||
      typeof v.currency !== 'string' || !/^[A-Z]{3}$/.test(v.currency) ||
      typeof v.isActive !== 'boolean' ||
      (Object.hasOwn(v, 'isTrending') && typeof v.isTrending !== 'boolean') ||
      (Object.hasOwn(v, 'trendingSortOrder') && !Number.isSafeInteger(v.trendingSortOrder))) return null;
  return v as ProductInput;
}

async function readJson(request: Request, maxBytes = 32768): Promise<unknown> {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('Content-Type') ?? '')) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { void reader.cancel().catch(() => {}); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { return null; } finally { reader.releaseLock(); }
}

function imageIds(value: unknown, variant = false): string[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== (variant ? 2 : 1) || !Array.isArray(v.imageIds) || v.imageIds.length > 500 ||
      v.imageIds.some(id => typeof id !== 'string' || !id || id.length > 200) ||
      new Set(v.imageIds).size !== v.imageIds.length) return null;
  return v.imageIds as string[];
}

async function variantImageSnapshot(db: D1Database, productId: string, variantId: string) {
  const result = await db.prepare('SELECT i.id, i.source_url AS url, v.position FROM product_variant_images v JOIN product_images i ON i.id = v.image_id WHERE v.variant_id = ? AND i.product_id = ? ORDER BY v.position, i.id').bind(variantId, productId).all<{ id: string; url: string; position: number }>();
  const bytes = new TextEncoder().encode(JSON.stringify(result.results.map(({ id, position }) => [id, position])));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return { images: result.results, version: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') };
}

type TrendingRow = { id: string; name: string; slug: string; trendingSortOrder: number; imageUrl: string | null };

async function trendingSnapshot(db: D1Database): Promise<{ products: TrendingRow[]; version: string }> {
  const result = await db.prepare(`SELECT id, name, slug, trending_sort_order AS trendingSortOrder,
    (SELECT i.source_url FROM product_images i WHERE i.product_id = products.id ORDER BY i.position, i.id LIMIT 1) AS imageUrl
    FROM products WHERE is_trending = 1
    ORDER BY trending_sort_order ASC, id ASC`).all<TrendingRow>();
  const products = result.results;
  // Only membership and ordering affect reorder conflicts; failed and unrelated writes do not.
  const bytes = new TextEncoder().encode(JSON.stringify(products.map(({ id, trendingSortOrder }) => [id, trendingSortOrder])));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const version = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return { products, version };
}

export function createAdminProductRoutes(options: TestOptions = {}) {
  const app = new Hono<AdminEnv>();
  app.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
  app.use('*', requireAdmin(options));
  app.get('/', async c => {
    const params = new URL(c.req.url).searchParams;
    const parse = (key: string, fallback: number, min: number, max: number): number | null => {
      const values = params.getAll(key);
      if (!values.length) return fallback;
      if (values.length !== 1 || !/^(0|[1-9]\d*)$/.test(values[0])) return null;
      const value = Number(values[0]);
      return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
    };
    const limit = parse('limit', 50, 1, 100);
    const offset = parse('offset', 0, 0, Number.MAX_SAFE_INTEGER);
    if (limit === null || offset === null) return c.json({ error: { code: 'INVALID_INPUT', message: 'Invalid pagination' } }, 400);
    const keys = ['search', 'status', 'trending', 'category', 'sort'];
    if (keys.some(key => params.getAll(key).length > 1)) return c.json(invalid, 400);
    const search = params.get('search')?.trim() ?? '';
    const status = params.get('status') ?? '';
    const trending = params.get('trending') ?? '';
    const category = params.get('category') ?? '';
    const sort = params.get('sort') ?? 'name';
    if (search.length > 200 || /[\u0000-\u001f\u007f]/.test(search) ||
        !['', 'active', 'inactive'].includes(status) || !['', 'true', 'false'].includes(trending) || !['name', 'trending-asc'].includes(sort) ||
        (category !== '' && (category.length > 200 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(category)))) return c.json(invalid, 400);
    const conditions: string[] = [];
    const args: (string | number)[] = [];
    if (search) {
      const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
      conditions.push("(products.name LIKE ? ESCAPE '\\' OR products.sku LIKE ? ESCAPE '\\')");
      args.push(pattern, pattern);
    }
    if (status) { conditions.push('products.is_active = ?'); args.push(Number(status === 'active')); }
    if (trending) { conditions.push('products.is_trending = ?'); args.push(Number(trending === 'true')); }
    if (category) {
      conditions.push('EXISTS (SELECT 1 FROM product_category pc JOIN categories c ON c.id = pc.category_id WHERE pc.product_id = products.id AND c.slug = ?)');
      args.push(category);
    }
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const count = await c.env.DB.prepare(`SELECT COUNT(*) AS total FROM products${where}`).bind(...args).first<{ total: number }>();
    const results = await c.env.DB.prepare(`SELECT id, sku, slug, name, description, brand_name AS brandName,
      price_minor AS priceMinor, currency, is_active AS isActive, is_trending AS isTrending,
      trending_sort_order AS trendingSortOrder,
      (EXISTS (SELECT 1 FROM external_product_mappings m WHERE m.product_id = products.id AND m.provider = 'xlsx:kiotviet')
       OR EXISTS (SELECT 1 FROM xlsx_product_state s WHERE s.product_id = products.id)) AS xlsxOwned,
      (SELECT i.source_url FROM product_images i WHERE i.product_id = products.id ORDER BY i.position, i.id LIMIT 1) AS imageUrl
      FROM products${where} ORDER BY ${sort === 'trending-asc' ? 'trending_sort_order ASC, id ASC' : 'name, id'} LIMIT ? OFFSET ?`).bind(...args, limit, offset).all<{ id: string; imageUrl: string | null }>();
    const products = results.results.map(item => ({
      ...item, imageUrl: publicImageUrl(item.imageUrl, c.env.IMAGE_PUBLIC_BASE_URL, c.env.IMAGE_ALLOW_LOCAL === 'true'),
    }));
    return c.json({ products, total: count?.total ?? 0, limit, offset });
  });
  app.get('/trending', async c => {
    const snapshot = await trendingSnapshot(c.env.DB);
    return c.json({ ...snapshot, products: snapshot.products.map(product => ({
      ...product, imageUrl: publicImageUrl(product.imageUrl, c.env.IMAGE_PUBLIC_BASE_URL, c.env.IMAGE_ALLOW_LOCAL === 'true'),
    })) });
  });
  app.put('/trending', async c => {
    if (!await verifyCsrf(c.req.raw, adminConfig(c.env).origin, c.get('adminToken'))) {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Request denied' } }, 403);
    }
    const body = await readJson(c.req.raw, 1048576);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json(invalid, 400);
    const input = body as Record<string, unknown>;
    if (Object.keys(input).length !== 2 || typeof input.version !== 'string' || !/^[a-f0-9]{64}$/.test(input.version) ||
        !Array.isArray(input.productIds) || input.productIds.some(id => typeof id !== 'string' || !id || id.length > 200) ||
        new Set(input.productIds).size !== input.productIds.length) return c.json(invalid, 400);
    const ids = input.productIds as string[];
    const db = c.env.DB;
    const runId = crypto.randomUUID();
    try {
      await db.prepare("INSERT INTO sync_runs (id, provider, trigger_type, started_at, status) VALUES (?, 'xlsx:kiotviet', 'admin', ?, 'running')")
        .bind(runId, new Date().toISOString()).run();
    } catch { return c.json(conflict, 409); }
    let succeeded = false;
    try {
      const current = await trendingSnapshot(db);
      if (current.version !== input.version) return c.json(conflict, 409);
      const members = new Set(current.products.map(product => product.id));
      if (ids.length !== members.size || ids.some(id => !members.has(id))) return c.json(invalid, 400);
      if (ids.length) {
        await db.batch(ids.map((id, position) => db.prepare('UPDATE products SET trending_sort_order = ? WHERE id = ? AND is_trending = 1').bind(position, id)));
      }
      succeeded = true;
      return c.json({ ok: true });
    } catch {
      return c.json(conflict, 409);
    } finally {
      await db.prepare("UPDATE sync_runs SET status = ?, completed_at = ?, failed_count = ?, error_summary = ? WHERE id = ? AND status = 'running'")
        .bind(succeeded ? 'completed' : 'failed', new Date().toISOString(), succeeded ? 0 : 1, succeeded ? null : 'Admin catalog write failed', runId).run();
    }
  });
  app.delete('/trending/:id', async c => {
    if (!await verifyCsrf(c.req.raw, adminConfig(c.env).origin, c.get('adminToken'))) {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Request denied' } }, 403);
    }
    const body = await readJson(c.req.raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json(invalid, 400);
    const input = body as Record<string, unknown>;
    const id = c.req.param('id');
    if (Object.keys(input).length !== 1 || typeof input.version !== 'string' ||
        !/^[a-f0-9]{64}$/.test(input.version) || !id || id.length > 200) return c.json(invalid, 400);
    const db = c.env.DB;
    const runId = crypto.randomUUID();
    try {
      await db.prepare("INSERT INTO sync_runs (id, provider, trigger_type, started_at, status) VALUES (?, 'xlsx:kiotviet', 'admin', ?, 'running')")
        .bind(runId, new Date().toISOString()).run();
    } catch { return c.json(conflict, 409); }
    let succeeded = false;
    try {
      const current = await trendingSnapshot(db);
      if (current.version !== input.version) return c.json(conflict, 409);
      if (!current.products.some(product => product.id === id)) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Trending product not found' } }, 404);
      }
      await db.prepare('UPDATE products SET is_trending = 0 WHERE id = ? AND is_trending = 1').bind(id).run();
      succeeded = true;
      return c.json({ ok: true });
    } catch {
      return c.json(conflict, 409);
    } finally {
      await db.prepare("UPDATE sync_runs SET status = ?, completed_at = ?, failed_count = ?, error_summary = ? WHERE id = ? AND status = 'running'")
        .bind(succeeded ? 'completed' : 'failed', new Date().toISOString(), succeeded ? 0 : 1, succeeded ? null : 'Admin catalog write failed', runId).run();
    }
  });
  app.get('/:id', async c => {
    const product = await c.env.DB.prepare(`SELECT id, sku, slug, name, description, brand_name AS brandName,
      price_minor AS priceMinor, currency, is_active AS isActive, is_trending AS isTrending,
      trending_sort_order AS trendingSortOrder,
      COALESCE((SELECT w.is_hidden FROM website_product_settings w WHERE w.product_id = products.id), 0) AS isHidden,
      (EXISTS (SELECT 1 FROM external_product_mappings m WHERE m.product_id = products.id AND m.provider = 'xlsx:kiotviet')
       OR EXISTS (SELECT 1 FROM xlsx_product_state s WHERE s.product_id = products.id)) AS xlsxOwned
      FROM products WHERE id = ?`).bind(c.req.param('id')).first();
    if (!product) return c.json({ error: { code: 'NOT_FOUND', message: 'Product not found' } }, 404);
    return c.json({ product });
  });
  app.put('/:id/visibility', async c => {
    if (!await verifyCsrf(c.req.raw, adminConfig(c.env).origin, c.get('adminToken'))) {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Request denied' } }, 403);
    }
    const body = await readJson(c.req.raw);
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).length !== 1 || typeof (body as Record<string, unknown>).isHidden !== 'boolean') return c.json(invalid, 400);
    const db = c.env.DB;
    const runId = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      await db.prepare("INSERT INTO sync_runs (id, provider, trigger_type, started_at, status) VALUES (?, 'xlsx:kiotviet', 'admin', ?, 'running')")
        .bind(runId, now).run();
    } catch { return c.json(conflict, 409); }
    let succeeded = false;
    try {
      const id = c.req.param('id');
      if (!await db.prepare('SELECT id FROM products WHERE id = ?').bind(id).first()) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Product not found' } }, 404);
      }
      await db.prepare(`INSERT INTO website_product_settings (product_id, is_hidden, created_at, updated_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(product_id) DO UPDATE SET is_hidden = excluded.is_hidden, updated_at = excluded.updated_at`)
        .bind(id, Number((body as { isHidden: boolean }).isHidden), now, now).run();
      succeeded = true;
      return c.json({ ok: true });
    } catch {
      return c.json(conflict, 409);
    } finally {
      await db.prepare("UPDATE sync_runs SET status = ?, completed_at = ?, failed_count = ?, error_summary = ? WHERE id = ? AND status = 'running'")
        .bind(succeeded ? 'completed' : 'failed', new Date().toISOString(), succeeded ? 0 : 1, succeeded ? null : 'Admin catalog write failed', runId).run();
    }
  });
  app.get('/:id/variants', async c => {
    const id = c.req.param('id');
    if (!await c.env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(id).first()) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Product not found' } }, 404);
    }
    const results = await c.env.DB.prepare('SELECT id, name, sku, description FROM product_variants WHERE product_id = ? ORDER BY name, id').bind(id).all();
    return c.json({ variants: results.results });
  });
  app.put('/:id/variants/:variantId/description', async c => {
    if (!await verifyCsrf(c.req.raw, adminConfig(c.env).origin, c.get('adminToken'))) {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Request denied' } }, 403);
    }
    const body = await readJson(c.req.raw);
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).length !== 1 || !Object.hasOwn(body, 'description')) return c.json(invalid, 400);
    const description = (body as Record<string, unknown>).description;
    if (!(description === null || (typeof description === 'string' && description.length <= 20000))) return c.json(invalid, 400);
    const db = c.env.DB;
    const runId = crypto.randomUUID();
    try {
      await db.prepare("INSERT INTO sync_runs (id, provider, trigger_type, started_at, status) VALUES (?, 'xlsx:kiotviet', 'admin', ?, 'running')")
        .bind(runId, new Date().toISOString()).run();
    } catch { return c.json(conflict, 409); }
    let succeeded = false;
    try {
      const result = await db.prepare('UPDATE product_variants SET description = ? WHERE id = ? AND product_id = ?')
        .bind(description, c.req.param('variantId'), c.req.param('id')).run();
      if (!result.meta.changes) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
      succeeded = true;
      return c.json({ ok: true });
    } catch {
      return c.json(conflict, 409);
    } finally {
      await db.prepare("UPDATE sync_runs SET status = ?, completed_at = ?, failed_count = ?, error_summary = ? WHERE id = ? AND status = 'running'")
        .bind(succeeded ? 'completed' : 'failed', new Date().toISOString(), succeeded ? 0 : 1, succeeded ? null : 'Admin catalog write failed', runId).run();
    }
  });
  app.on(['GET', 'POST', 'PUT', 'DELETE'], ['/:id/images', '/:id/images/:imageId', '/:id/variants/:variantId/images'], async c => {
    const db = c.env.DB;
    const productId = c.req.param('id');
    const imageId = c.req.param('imageId');
    const variantId = c.req.param('variantId');
    const method = c.req.method;
    const missing = { error: { code: 'NOT_FOUND', message: 'Not found' } };
    if (method !== 'GET' && !await verifyCsrf(c.req.raw, adminConfig(c.env).origin, c.get('adminToken'))) {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Request denied' } }, 403);
    }
    if ((variantId && !['GET', 'POST', 'PUT'].includes(method)) ||
        (imageId && method !== 'DELETE') || (!variantId && !imageId && !['GET', 'POST', 'PUT'].includes(method))) return c.json(invalid, 400);
    const body = method === 'POST' || method === 'PUT' ? await readJson(c.req.raw) : null;
    const ids = method === 'PUT' ? imageIds(body, !!variantId) : null;
    if (method === 'PUT' && !ids) return c.json(invalid, 400);
    if (variantId && method !== 'GET' && (!body || typeof body !== 'object' || Array.isArray(body) ||
        typeof (body as Record<string, unknown>).version !== 'string' ||
        !/^[a-f0-9]{64}$/.test((body as { version: string }).version))) return c.json(invalid, 400);
    let url: string | undefined;
    if (method === 'POST' && variantId) {
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 2 ||
          typeof (body as Record<string, unknown>).imageId !== 'string' ||
          !(body as { imageId: string }).imageId || (body as { imageId: string }).imageId.length > 200) return c.json(invalid, 400);
    }
    if (method === 'POST' && !variantId) {
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 ||
          typeof (body as Record<string, unknown>).url !== 'string') return c.json(invalid, 400);
      url = (body as { url: string }).url;
      const base = imageBaseUrl(c.env.IMAGE_PUBLIC_BASE_URL, c.env.IMAGE_ALLOW_LOCAL === 'true');
      if (!base || !c.env.IMAGES) return c.json(invalid, 400);
      const key = url.startsWith(base.href) ? url.slice(base.href.length) : '';
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp|gif)$/.test(key)) return c.json(invalid, 400);
      const local = c.env.IMAGE_ALLOW_LOCAL === 'true' && base.protocol === 'http:' && base.pathname === '/api/images/';
      if (!await c.env.IMAGES.head(local ? key : `${base.pathname.slice(1)}${key}`)) return c.json(invalid, 400);
    }
    const runId = crypto.randomUUID();
    if (method !== 'GET') {
      try {
        await db.prepare("INSERT INTO sync_runs (id, provider, trigger_type, started_at, status) VALUES (?, 'xlsx:kiotviet', 'admin', ?, 'running')").bind(runId, new Date().toISOString()).run();
      } catch { return c.json(conflict, 409); }
    }
    let succeeded = false;
    try {
      if (!await db.prepare('SELECT id FROM products WHERE id = ?').bind(productId).first()) return c.json(missing, 404);
      if (variantId && !await db.prepare('SELECT id FROM product_variants WHERE id = ? AND product_id = ?').bind(variantId, productId).first()) return c.json(missing, 404);
      if (method === 'GET') {
        if (variantId) return c.json(await variantImageSnapshot(db, productId, variantId));
        const result = await db.prepare('SELECT id, source_url AS url, position FROM product_images WHERE product_id = ? ORDER BY position, id').bind(productId).all();
        return c.json({ images: result.results });
      }
      if (variantId && (await variantImageSnapshot(db, productId, variantId)).version !== (body as { version: string }).version) return c.json(conflict, 409);
      if (method === 'POST') {
        if (variantId) {
          const selectedImageId = (body as { imageId: string }).imageId;
          if (!await db.prepare('SELECT id FROM product_images WHERE id = ? AND product_id = ?').bind(selectedImageId, productId).first()) return c.json(missing, 404);
          await db.prepare('INSERT INTO product_variant_images (variant_id, image_id, position) SELECT ?, ?, COALESCE(MAX(position) + 1, 0) FROM product_variant_images WHERE variant_id = ?')
            .bind(variantId, selectedImageId, variantId).run();
          succeeded = true;
          return c.json({ ok: true, version: (await variantImageSnapshot(db, productId, variantId)).version }, 201);
        }
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        await db.prepare('INSERT INTO product_images (id, product_id, source_url, position, created_at, updated_at) SELECT ?, ?, ?, COALESCE(MAX(position) + 1, 0), ?, ? FROM product_images WHERE product_id = ?').bind(id, productId, url, now, now, productId).run();
        succeeded = true;
        return c.json({ id }, 201);
      }
      if (method === 'DELETE') {
        const row = await db.prepare('SELECT id FROM product_images WHERE id = ? AND product_id = ?').bind(imageId, productId).first();
        if (!row) return c.json(missing, 404);
        if (await db.prepare('SELECT image_id FROM xlsx_product_images WHERE image_id = ?').bind(imageId).first()) return c.json(conflict, 409);
        await db.prepare('DELETE FROM product_images WHERE id = ? AND product_id = ?').bind(imageId, productId).run();
        succeeded = true;
        return c.json({ ok: true });
      }
      const stored = await db.prepare('SELECT id FROM product_images WHERE product_id = ?').bind(productId).all<{ id: string }>();
      const owned = new Set(stored.results.map(row => row.id));
      if (ids!.some(id => !owned.has(id)) || (!variantId && ids!.length !== owned.size)) return c.json(invalid, 400);
      if (variantId) {
        const statements = [db.prepare('DELETE FROM product_variant_images WHERE variant_id = ?').bind(variantId)];
        for (const [position, id] of ids!.entries()) statements.push(db.prepare('INSERT INTO product_variant_images (variant_id, image_id, position) VALUES (?, ?, ?)').bind(variantId, id, position));
        await db.batch(statements);
      } else if (ids!.length) {
        await db.batch(ids!.map((id, position) => db.prepare('UPDATE product_images SET position = ? WHERE id = ? AND product_id = ?').bind(position, id, productId)));
      }
      succeeded = true;
      return c.json(variantId ? { ok: true, version: (await variantImageSnapshot(db, productId, variantId)).version } : { ok: true });
    } catch {
      return c.json(conflict, 409);
    } finally {
      if (method !== 'GET') await db.prepare("UPDATE sync_runs SET status = ?, completed_at = ?, failed_count = ?, error_summary = ? WHERE id = ? AND status = 'running'")
        .bind(succeeded ? 'completed' : 'failed', new Date().toISOString(), succeeded ? 0 : 1, succeeded ? null : 'Admin catalog write failed', runId).run();
    }
  });
  app.on(['POST', 'PUT', 'DELETE'], ['/', '/:id'], async c => {
    if (!await verifyCsrf(c.req.raw, adminConfig(c.env).origin, c.get('adminToken'))) {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Request denied' } }, 403);
    }
    const id = c.req.param('id');
    const method = c.req.method;
    if ((method === 'POST' && id) || (method !== 'POST' && !id)) return c.json(invalid, 400);
    const product = method === 'DELETE' ? null : productInput(await readJson(c.req.raw), method === 'PUT');
    if (method !== 'DELETE' && !product) return c.json(invalid, 400);
    const runId = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      await c.env.DB.prepare("INSERT INTO sync_runs (id, provider, trigger_type, started_at, status) VALUES (?, 'xlsx:kiotviet', 'admin', ?, 'running')").bind(runId, now).run();
    } catch { return c.json(conflict, 409); }
    let succeeded = false;
    try {
      let result: D1Result;
      if (method === 'DELETE') {
        result = await c.env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run();
      } else {
        const p = product!;
        if (method === 'PUT') {
          const existing = await c.env.DB.prepare(`SELECT sku, name, brand_name AS brandName, price_minor AS priceMinor, currency,
            is_active AS isActive,
            (EXISTS (SELECT 1 FROM external_product_mappings m WHERE m.product_id = products.id AND m.provider = 'xlsx:kiotviet')
             OR EXISTS (SELECT 1 FROM xlsx_product_state s WHERE s.product_id = products.id)) AS xlsxOwned
            FROM products WHERE id = ?`).bind(id).first<{
              sku: string | null; name: string; brandName: string | null; priceMinor: number | null;
              currency: string; isActive: number; xlsxOwned: number;
            }>();
          if (existing?.xlsxOwned && (existing.sku !== p.sku || existing.name !== p.name ||
              existing.brandName !== p.brandName || existing.priceMinor !== p.priceMinor || existing.currency !== p.currency ||
              Boolean(existing.isActive) !== p.isActive)) {
            return c.json({ error: { code: 'XLSX_OWNED_FIELDS', message: 'SKU, name, brand, price, currency and active status are managed by XLSX. Change them in the spreadsheet and reimport.' } }, 409);
          }
        }
        const values = [p.sku, p.slug, p.name, p.description, p.brandName, p.priceMinor, p.currency, Number(p.isActive), Number(p.isTrending), p.trendingSortOrder];
        result = method === 'POST'
          ? await c.env.DB.prepare('INSERT INTO products (id, sku, slug, name, description, brand_name, price_minor, currency, is_active, is_trending, trending_sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), ...values, now, now).run()
          : await c.env.DB.prepare('UPDATE products SET sku = ?, slug = ?, name = ?, description = ?, brand_name = ?, price_minor = ?, currency = ?, is_active = ?, is_trending = COALESCE(?, is_trending), trending_sort_order = COALESCE(?, trending_sort_order), updated_at = ? WHERE id = ?')
            .bind(...values.slice(0, 8), p.isTrending === undefined ? null : Number(p.isTrending), p.trendingSortOrder ?? null, now, id).run();
      }
      if (!result.meta.changes) return c.json({ error: { code: 'NOT_FOUND', message: 'Product not found' } }, 404);
      succeeded = true;
      return c.json({ ok: true }, method === 'POST' ? 201 : 200);
    } catch {
      return c.json(conflict, 409);
    } finally {
      await c.env.DB.prepare("UPDATE sync_runs SET status = ?, completed_at = ?, failed_count = ?, error_summary = ? WHERE id = ? AND status = 'running'")
        .bind(succeeded ? 'completed' : 'failed', new Date().toISOString(), succeeded ? 0 : 1, succeeded ? null : 'Admin catalog write failed', runId).run();
    }
  });
  app.onError((_error, c) => c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500));
  return app;
}
