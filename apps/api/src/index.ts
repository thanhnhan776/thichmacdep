import { Hono } from 'hono';
import { getCategoryBySlug, getProductBySlug, getStoreSettings, listCategories, listProducts } from './services/catalog.service';
import { createAdminAuthRoutes } from './routes/admin-auth';
import { createAdminImportRoutes } from './routes/admin-import';
import { createAdminUserRoutes } from './routes/admin-users';

export type Bindings = {
  DB: D1Database;
  IMAGES: R2Bucket;
  GOOGLE_CLIENT_ID: string;
  ADMIN_ORIGIN: string;
  ADMIN_ALLOW_INSECURE_LOCALHOST?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.route('/api/admin/auth', createAdminAuthRoutes());
app.route('/api/admin/import', createAdminImportRoutes());
app.route('/api/admin/users', createAdminUserRoutes());

app.get('/api/health', (context) => context.json({ status: 'ok' }));

const invalidQuery = { error: { code: 'INVALID_QUERY', message: 'Invalid query parameters' } };
const notFound = { error: { code: 'NOT_FOUND', message: 'Not found' } };

function validQuery(url: string, allowed: string[]): boolean {
  const params = new URL(url).searchParams;
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) return false;
  }
  return true;
}

function positiveInteger(value: string | undefined, fallback: number): number | null {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

app.get('/api/products', async (context) => {
  if (!validQuery(context.req.url, ['page', 'pageSize', 'keyword', 'category'])) return context.json(invalidQuery, 400);
  const page = positiveInteger(context.req.query('page'), 1);
  const pageSize = positiveInteger(context.req.query('pageSize'), 20);
  const keyword = context.req.query('keyword');
  const category = context.req.query('category');
  if (page === null || pageSize === null || pageSize > 100 || !Number.isSafeInteger((page - 1) * pageSize)
    || (keyword !== undefined && (!keyword.trim() || keyword.length > 200))
    || (category !== undefined && (!category.trim() || category.length > 200))) {
    return context.json(invalidQuery, 400);
  }
  const result = await listProducts(context.env.DB, { page, pageSize, keyword, category });
  context.header('Cache-Control', 'public, max-age=60');
  return context.json(result);
});

app.get('/api/products/:slug', async (context) => {
  if (!validQuery(context.req.url, [])) return context.json(invalidQuery, 400);
  const product = await getProductBySlug(context.env.DB, context.req.param('slug'));
  if (!product) return context.json(notFound, 404);
  context.header('Cache-Control', 'public, max-age=60');
  return context.json(product);
});

app.get('/api/categories', async (context) => {
  if (!validQuery(context.req.url, [])) return context.json(invalidQuery, 400);
  const categories = await listCategories(context.env.DB);
  context.header('Cache-Control', 'public, max-age=60');
  return context.json(categories);
});

app.get('/api/categories/:slug', async (context) => {
  if (!validQuery(context.req.url, [])) return context.json(invalidQuery, 400);
  const category = await getCategoryBySlug(context.env.DB, context.req.param('slug'));
  if (!category) return context.json(notFound, 404);
  context.header('Cache-Control', 'public, max-age=60');
  return context.json(category);
});

app.get('/api/store-settings', async (context) => {
  if (!validQuery(context.req.url, [])) return context.json(invalidQuery, 400);
  const settings = await getStoreSettings(context.env.DB);
  if (!settings) return context.json(notFound, 404);
  context.header('Cache-Control', 'public, max-age=60');
  return context.json(settings);
});

app.onError((_error, context) => context.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500));

export default app;
