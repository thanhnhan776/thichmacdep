interface ApiBinding { fetch(request: Request): Promise<Response> }

const PAGE_SIZE = 100;
const MAX_PAGES = 50;
const MAX_CATEGORIES = 5000;
const MAX_BYTES = 1024 * 1024;

function origin(value: unknown): string | null {
  if (typeof value !== 'string' || value !== value.trim()) return null;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
      && url.pathname === '/' && !url.search && !url.hash ? url.origin : null;
  } catch { return null; }
}

function slug(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200
    || /[/\\%?#\u0000-\u001f\u007f]/.test(value) || value === '.' || value === '..') throw new Error('Invalid slug');
  return encodeURIComponent(value);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid catalog');
  return value as Record<string, unknown>;
}

async function json(api: ApiBinding, path: string): Promise<unknown> {
  // The binding URL is fixed and never derived from the inbound request or catalog data.
  const response = await api.fetch(new Request(`https://catalog.internal${path}`));
  if (response.status !== 200 || response.redirected || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) throw new Error('Catalog unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('Catalog too large');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

const escapeXml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

async function sitemap(api: ApiBinding, site: string): Promise<string> {
  const categories = await json(api, '/api/categories');
  if (!Array.isArray(categories) || categories.length > MAX_CATEGORIES) throw new Error('Invalid categories');
  const paths = new Set(['/', '/products']);
  for (const item of categories) {
    const path = `/categories/${slug(object(item)['slug'])}`;
    if (paths.has(path)) throw new Error('Duplicate category');
    paths.add(path);
  }
  let total = -1;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = object(await json(api, `/api/products?page=${page}&pageSize=${PAGE_SIZE}`));
    const items = result['items'];
    const count = result['total'];
    if (!Number.isSafeInteger(count) || (count as number) < 0 || (count as number) > MAX_PAGES * PAGE_SIZE
      || (total !== -1 && count !== total) || result['page'] !== page || result['pageSize'] !== PAGE_SIZE
      || !Array.isArray(items) || items.length !== Math.min(PAGE_SIZE, Math.max(0, (count as number) - (page - 1) * PAGE_SIZE))) throw new Error('Invalid product page');
    total = count as number;
    for (const item of items) {
      const segment = slug(object(item)['slug']);
      const path = `/products/${segment}`;
      if (paths.has(path)) throw new Error('Duplicate product');
      paths.add(path);
    }
    if (page * PAGE_SIZE >= total) {
      return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...paths].map(path => `  <url><loc>${escapeXml(site + path)}</loc></url>`).join('\n')}\n</urlset>\n`;
    }
  }
  throw new Error('Catalog incomplete');
}

export async function crawlerResponse(request: Request, api: ApiBinding, configuredSite: unknown): Promise<Response> {
  const site = origin(configuredSite);
  const head = request.method === 'HEAD';
  const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' };
  if (new URL(request.url).pathname === '/robots.txt') {
    // Never authorize crawling a preview deployment using the production origin's configuration.
    const body = site && new URL(request.url).origin === site
      ? `User-agent: *\nDisallow: /api/\nDisallow: /admin/\nDisallow: /_internal/\nDisallow: /api\nDisallow: /admin\nSitemap: ${site}/sitemap.xml\n`
      : 'User-agent: *\nDisallow: /\n';
    return new Response(head ? null : body, { headers });
  }
  try {
    if (!site) throw new Error('Invalid origin');
    const body = await sitemap(api, site);
    return new Response(head ? null : body, { headers: { ...headers, 'Content-Type': 'application/xml; charset=utf-8' } });
  } catch {
    return new Response(head ? null : 'Sitemap unavailable\n', { status: 503, headers });
  }
}
