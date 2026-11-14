import { createAdminProductRoutes } from '../apps/api/src/routes/admin-products.ts';
import { getProductBySlug, listProducts } from '../apps/api/src/services/catalog.service.ts';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

export async function checkAdminProducts(db: D1Database, token: string, csrf: string, now: Date): Promise<void> {
  const bindings = {
    DB: db, GOOGLE_CLIENT_ID: 'test-client', ADMIN_ORIGIN: 'https://admin.example.test',
    IMAGE_PUBLIC_BASE_URL: 'https://images.example.test/',
    IMAGES: { head: async (key: string) => key === '12345678-1234-4123-8123-123456789abc.jpg' ? {} : null } as unknown as R2Bucket,
  };
  const routes = createAdminProductRoutes({ clock: () => now });
  const headers = { Cookie: `admin_session=${token}`, Origin: bindings.ADMIN_ORIGIN, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' };
  const product = {
    sku: 'MANUAL-1', slug: 'manual-product', name: 'Manual product', description: 'Description',
    brandName: 'Brand', priceMinor: 100, currency: 'VND', isActive: true, isTrending: true, trendingSortOrder: 3,
  };
  const request = (path: string, init?: RequestInit) => routes.request(`https://api.example.test${path}`, init, bindings);
  const write = (method: string, body: unknown, overrides: Record<string, string> = {}) =>
    ({ method, headers: { ...headers, ...overrides }, body: JSON.stringify(body) });

  assert((await request('/')).status === 401, 'listing requires authentication');
  assert((await request('/missing')).status === 401, 'product detail requires authentication');
  assert((await request('/missing', { headers })).status === 404, 'missing product detail returns 404');
  for (const query of ['limit=0', 'limit=101', 'limit=1.5', 'limit=1&limit=2', 'offset=-1', 'offset=9007199254740992', 'offset=abc']) {
    assert((await request(`/?${query}`, { headers })).status === 400, `invalid pagination rejected: ${query}`);
  }
  for (const query of ['status=deleted', 'trending=1', 'search=a&search=b', 'category=../bad', 'sort=bad', 'sort=name&sort=trending-asc', `search=${'x'.repeat(201)}`, 'search=%00']) {
    assert((await request(`/?${query}`, { headers })).status === 400, `invalid filter rejected: ${query}`);
  }
  const unread = new Request('https://api.example.test/', write('POST', product, { 'X-CSRF-Token': '' }));
  assert((await routes.fetch(unread, bindings)).status === 403 && !unread.bodyUsed, 'CSRF must be checked before reading body');
  assert((await request('/', write('POST', product, { Origin: 'https://evil.test' }))).status === 403, 'cross-origin writes must be rejected');

  for (const invalid of [
    { ...product, slug: 'Invalid Slug' }, { ...product, name: '  ' }, { ...product, priceMinor: -1 },
    { ...product, currency: 'vnd' }, { ...product, isTrending: 1 }, { ...product, trendingSortOrder: 1.5 },
    { ...product, extra: true }, { ...product, description: 'a'.repeat(20001) },
  ]) {
    assert((await request('/', write('POST', invalid))).status === 400, 'invalid product must be rejected');
  }
  assert((await request('/', { ...write('POST', product), body: '{' })).status === 400, 'malformed JSON must be rejected');
  assert((await request('/', write('POST', product, { 'Content-Type': 'text/plain' }))).status === 400, 'non-JSON must be rejected');
  assert((await request('/', { ...write('POST', product), body: ' '.repeat(32769) })).status === 400, 'oversized body must be rejected');
  assert((await request('/unexpected', write('POST', product))).status === 400, 'POST must target collection');
  assert((await request('/', write('PUT', product))).status === 400, 'PUT requires an id');

  const created = await request('/', write('POST', product));
  assert(created.status === 201 && created.headers.get('Cache-Control') === 'no-store', 'create must succeed without caching');
  const completed = await db.prepare("SELECT COUNT(*) AS count FROM sync_runs WHERE trigger_type = 'admin' AND status = 'completed'").first<{ count: number }>();
  assert((completed?.count ?? 0) > 0, 'successful admin write must be recorded as completed');
  const stored = await db.prepare('SELECT id, description, is_trending, trending_sort_order FROM products WHERE sku = ?')
    .bind(product.sku).first<{ id: string; description: string; is_trending: number; trending_sort_order: number }>();
  assert(stored?.description === product.description && stored.is_trending === 1 && stored.trending_sort_order === 3, 'create must persist metadata');
  const visibilityPath = `/${stored.id}/visibility`;
  assert((await request(visibilityPath, { method: 'PUT' })).status === 401, 'visibility write requires authentication');
  const unreadVisibility = new Request(`https://api.example.test${visibilityPath}`, write('PUT', { isHidden: true }, { 'X-CSRF-Token': '' }));
  assert((await routes.fetch(unreadVisibility, bindings)).status === 403 && !unreadVisibility.bodyUsed, 'visibility checks CSRF before reading body');
  for (const input of [{}, { isHidden: 1 }, { isHidden: true, extra: true }]) {
    assert((await request(visibilityPath, write('PUT', input))).status === 400, 'invalid visibility rejected');
  }
  assert((await request('/missing/visibility', write('PUT', { isHidden: true }))).status === 404, 'missing product visibility returns 404');
  const defaultVisibility = await (await request(`/${stored.id}`, { headers })).json() as { product: { isHidden: number } };
  assert(defaultVisibility.product.isHidden === 0 && !!await getProductBySlug(db, product.slug), 'missing settings means visible');
  assert((await request(visibilityPath, write('PUT', { isHidden: true }))).status === 200, 'hide creates missing settings');
  await db.prepare("UPDATE website_product_settings SET seo_title = 'SEO', marketing_description = 'Marketing', is_featured = 1, display_order = 42, created_at = 'original' WHERE product_id = ?").bind(stored.id).run();
  assert((await request(visibilityPath, write('PUT', { isHidden: true }))).status === 200, 'hide product');
  const hidden = await (await request(`/${stored.id}`, { headers })).json() as { product: { isHidden: number } };
  assert(hidden.product.isHidden === 1 && !await getProductBySlug(db, product.slug), 'hidden product absent from public detail');
  assert(!(await listProducts(db, { page: 1, pageSize: 100, keyword: product.sku })).items.some(item => item.id === stored.id), 'hidden product absent from public list');
  assert((await request(`/${stored.id}`, write('PUT', product))).status === 200, 'old product update remains supported');
  assert((await (await request(`/${stored.id}`, { headers })).json() as typeof hidden).product.isHidden === 1, 'old update preserves visibility');
  const settings = await db.prepare('SELECT seo_title, marketing_description, is_featured, display_order, created_at FROM website_product_settings WHERE product_id = ?').bind(stored.id)
    .first<{ seo_title: string; marketing_description: string; is_featured: number; display_order: number; created_at: string }>();
  assert(settings?.seo_title === 'SEO' && settings.marketing_description === 'Marketing' && settings.is_featured === 1 &&
    settings.display_order === 42 && settings.created_at === 'original', 'visibility preserves unrelated settings');
  assert((await request(visibilityPath, write('PUT', { isHidden: false }))).status === 200 && !!await getProductBySlug(db, product.slug), 'show active product');
  await db.prepare('UPDATE products SET is_active = 0 WHERE id = ?').bind(stored.id).run();
  assert(!await getProductBySlug(db, product.slug) && !(await listProducts(db, { page: 1, pageSize: 100, keyword: product.sku })).items.some(item => item.id === stored.id), 'show does not expose inactive product');
  await db.prepare('UPDATE products SET is_active = 1 WHERE id = ?').bind(stored.id).run();
  const detailResponse = await request(`/${stored.id}`, { headers });
  const detail = await detailResponse.json() as { product: { id: string; name: string; xlsxOwned: number } };
  assert(detailResponse.status === 200 && detailResponse.headers.get('Cache-Control') === 'no-store' &&
    detail.product.id === stored.id && detail.product.name === product.name && !detail.product.xlsxOwned, 'detail returns product without caching');
  const listing = await request('/', { headers });
  const listed = await listing.json() as { products: Array<{ id: string; isTrending: number }> };
  assert(listing.status === 200 && listed.products.some(item => item.id === stored.id && item.isTrending === 1), 'listing must include created product');
  const page = await (await request('/?limit=1&offset=0', { headers })).json() as { products: Array<{ id: string }>; total: number; limit: number; offset: number };
  const next = await (await request('/?limit=1&offset=1', { headers })).json() as typeof page;
  assert(page.limit === 1 && page.offset === 0 && page.total >= 1 && page.products.length === 1, 'page metadata and bounded results');
  assert(next.total === page.total && next.offset === 1 && (!next.products.length || next.products[0].id !== page.products[0].id), 'pages do not overlap');
  const secondProduct = { ...product, sku: 'TRENDING-SECOND', slug: 'trending-second', name: 'Trending second', isTrending: false };
  assert((await request('/', write('POST', secondProduct))).status === 201, 'second product created through admin');
  const second = await db.prepare('SELECT id FROM products WHERE sku = ?').bind(secondProduct.sku).first<{ id: string }>();
  assert(second, 'second product exists');
  assert((await request(`/${second.id}`, write('PUT', { ...secondProduct, isTrending: true }))).status === 200, 'admin flags second product');
  await db.prepare("INSERT INTO categories (id, name, slug, is_active, created_at, updated_at) VALUES ('admin-trending-test', 'Trending test', 'admin-trending-test', 1, '2020', '2020')").run();
  for (const id of [stored.id, second.id]) {
    await db.prepare("INSERT INTO product_category (product_id, category_id) VALUES (?, 'admin-trending-test')").bind(id).run();
  }
  await db.prepare("INSERT INTO products (id, slug, name, is_active, is_trending, trending_sort_order, created_at, updated_at) VALUES ('admin-trending-hidden', 'admin-trending-hidden', 'Hidden', 1, 1, 0, '2020', '2020'), ('admin-trending-inactive', 'admin-trending-inactive', 'Inactive', 0, 1, 0, '2020', '2020'), ('admin-trending-featured', 'admin-trending-featured', 'Featured', 1, 0, 0, '2099', '2099')").run();
  for (const id of ['admin-trending-hidden', 'admin-trending-inactive', 'admin-trending-featured']) {
    await db.prepare("INSERT INTO product_category (product_id, category_id) VALUES (?, 'admin-trending-test')").bind(id).run();
  }
  await db.prepare("INSERT INTO website_product_settings (product_id, is_featured, display_order, is_hidden, created_at, updated_at) VALUES ('admin-trending-hidden', 0, 0, 1, '2020', '2020'), ('admin-trending-featured', 1, -100, 0, '2020', '2020')").run();
  const beforePublicReorder = await (await request('/trending', { headers })).json() as { products: Array<{ id: string }>; version: string };
  const desired = [second.id, stored.id, ...beforePublicReorder.products.map(item => item.id).filter(id => id !== second.id && id !== stored.id)];
  assert((await request('/trending', write('PUT', { productIds: desired, version: beforePublicReorder.version }))).status === 200, 'admin reorders flagged products');
  for (const [index, id] of [second.id, stored.id, 'admin-trending-featured'].entries()) {
    const publicPage = await listProducts(db, { page: index + 1, pageSize: 1, category: 'admin-trending-test', sort: 'trending' });
    assert(publicPage.total === 3 && publicPage.items[0]?.id === id, 'public pages follow admin order, visibility, and not website featured flags');
  }
  await db.prepare('INSERT INTO product_images (id, product_id, source_url, position, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?), (?, ?, ?, 0, ?, ?)')
    .bind('trending-safe', stored.id, 'https://images.example.test/product.jpg', '2020', '2020',
      'trending-unsafe', second.id, 'https://evil.example.test/product.jpg', '2020', '2020').run();
  const thumbnails = await (await request('/trending', { headers })).json() as { products: Array<{ id: string; imageUrl: string | null }>; version: string };
  assert(thumbnails.products.find(item => item.id === stored.id)?.imageUrl === 'https://images.example.test/product.jpg', 'trending returns configured trusted image');
  assert(thumbnails.products.find(item => item.id === second.id)?.imageUrl === null, 'trending rejects untrusted image');
  const listImages = await (await request('/?search=TRENDING-SECOND', { headers })).json() as { products: Array<{ imageUrl: string | null }> };
  assert(listImages.products[0]?.imageUrl === null, 'trending and product list apply the same image safety');
  assert((await request(`/trending/${second.id}`, { method: 'DELETE' })).status === 401, 'trending removal requires authentication');
  const unreadRemoval = new Request(`https://api.example.test/trending/${second.id}`, write('DELETE', { version: thumbnails.version }, { 'X-CSRF-Token': '' }));
  assert((await routes.fetch(unreadRemoval, bindings)).status === 403 && !unreadRemoval.bodyUsed, 'removal checks CSRF before reading body');
  assert((await request(`/trending/${second.id}`, write('DELETE', { version: 'bad' }))).status === 400, 'removal requires valid version');
  assert((await request(`/trending/${second.id}`, write('DELETE', { version: '0'.repeat(64) }))).status === 409, 'stale removal conflicts');
  assert((await request(`/trending/${second.id}`, write('DELETE', { version: thumbnails.version }))).status === 200, 'trending removal succeeds');
  const removed = await (await request('/trending', { headers })).json() as typeof thumbnails;
  assert(removed.version !== thumbnails.version && removed.products.map(item => item.id).join(',') ===
    thumbnails.products.filter(item => item.id !== second.id).map(item => item.id).join(','), 'removal preserves remaining order and changes version');
  assert((await db.prepare('SELECT id FROM products WHERE id = ?').bind(second.id).first()) !== null, 'removal does not delete product');
  assert((await request(`/trending/${second.id}`, write('DELETE', { version: thumbnails.version }))).status === 409, 'repeated stale removal conflicts');
  assert((await request(`/trending/${second.id}`, write('DELETE', { version: removed.version }))).status === 404, 'nonmember removal returns not found');
  await db.prepare("DELETE FROM product_images WHERE id IN ('trending-safe', 'trending-unsafe')").run();
  await db.prepare("DELETE FROM products WHERE id IN ('admin-trending-hidden', 'admin-trending-inactive', 'admin-trending-featured', ?)").bind(second.id).run();
  await db.prepare("DELETE FROM categories WHERE id = 'admin-trending-test'").run();
  await db.prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x + 1 FROM n WHERE x < 501)
    INSERT INTO products (id, slug, name, created_at, updated_at)
    SELECT 'pagination-test-' || x, 'pagination-test-' || x, 'Pagination test', '2026', '2026' FROM n`).run();
  const seen = new Set<string>();
  let total = 0;
  for (let offset = 0; ; offset += 100) {
    const response = await (await request(`/?limit=100&offset=${offset}`, { headers })).json() as typeof page;
    total = response.total;
    for (const item of response.products) {
      assert(!seen.has(item.id), 'paginated products must not overlap');
      seen.add(item.id);
    }
    if (offset + 100 >= total) break;
  }
  assert(seen.size === total && seen.has('pagination-test-501'), 'all products beyond the old 500 limit are accessible');
  await db.prepare("UPDATE products SET sku = 'special_sku', is_active = 0, is_trending = 1 WHERE id = 'pagination-test-501'").run();
  const filtered = await (await request('/?search=special%5Fsku&status=inactive&trending=true&limit=1', { headers })).json() as typeof page;
  assert(filtered.total === 1 && filtered.products[0]?.id === 'pagination-test-501', 'combined filters search the full catalog');
  const wildcard = await (await request('/?search=%25', { headers })).json() as typeof page;
  assert(wildcard.total === 0, 'search wildcard characters are treated literally');
  const filteredFirst = await (await request('/?search=Pagination%20test&status=active&limit=1', { headers })).json() as typeof page;
  const filteredNext = await (await request('/?search=Pagination%20test&status=active&limit=1&offset=1', { headers })).json() as typeof page;
  assert(filteredFirst.total === 500 && filteredNext.total === 500 && filteredFirst.products[0]?.id !== filteredNext.products[0]?.id,
    'filtered total and pagination are consistent');
  assert((await request('/trending')).status === 401, 'trending list requires authentication');
  assert((await request('/trending', { method: 'PUT' })).status === 401, 'trending reorder requires authentication');
  const snapshot = await (await request('/trending', { headers })).json() as { products: Array<{ id: string; trendingSortOrder: number }>; version: string };
  const originalIds = snapshot.products.map(item => item.id);
  assert(originalIds.includes(stored.id) && originalIds.includes('pagination-test-501'), 'trending list includes inactive products');
  const sorted = await (await request('/?trending=true&sort=trending-asc&limit=1', { headers })).json() as typeof page;
  const sortedNext = await (await request('/?trending=true&sort=trending-asc&limit=1&offset=1', { headers })).json() as typeof page;
  assert(sorted.products[0]?.id === originalIds[0] && sortedNext.products[0]?.id === originalIds[1], 'trending sort is stable across pages');
  const unreadTrending = new Request('https://api.example.test/trending', write('PUT', { productIds: originalIds, version: snapshot.version }, { 'X-CSRF-Token': '' }));
  assert((await routes.fetch(unreadTrending, bindings)).status === 403 && !unreadTrending.bodyUsed, 'reorder checks CSRF before reading body');
  assert((await request('/trending', write('PUT', { productIds: [originalIds[0], originalIds[0]], version: snapshot.version }))).status === 400, 'duplicate IDs rejected');
  assert((await request('/trending', write('PUT', { productIds: ['foreign'], version: snapshot.version }))).status === 400, 'invalid membership rejected');
  const fresh = await (await request('/trending', { headers })).json() as typeof snapshot;
  assert(fresh.version === snapshot.version, 'invalid reorder leaves snapshot version unchanged');
  assert((await request('/trending', write('PUT', { productIds: ['foreign'], version: snapshot.version }))).status === 400, 'repeated invalid membership rejected');
  assert((await (await request('/trending', { headers })).json() as typeof snapshot).version === snapshot.version, 'repeated invalid reorder leaves version unchanged');
  const reversed = fresh.products.map(item => item.id).reverse();
  assert((await request('/trending', write('PUT', { productIds: reversed, version: fresh.version }))).status === 200, 'complete reorder succeeds');
  const { isTrending: _staleFlag, trendingSortOrder: _staleOrder, ...editorChanges } = product;
  assert((await request(`/${stored.id}`, write('PUT', { ...editorChanges, description: 'stale editor' }))).status === 200,
    'unrelated edit omits trending fields');
  const afterReorder = await (await request('/trending', { headers })).json() as typeof snapshot;
  assert(afterReorder.version !== fresh.version, 'changed order invalidates snapshot');
  assert(afterReorder.products.map(item => item.id).join(',') === reversed.join(',') &&
    afterReorder.products.every((item, index) => item.trendingSortOrder === index), 'reorder persists all positions');
  assert((await request('/trending', write('PUT', { productIds: originalIds, version: fresh.version }))).status === 409, 'stale concurrent reorder rejected');
  const afterStale = await (await request('/trending', { headers })).json() as typeof snapshot;
  assert(afterStale.version === afterReorder.version && afterStale.products.map(item => item.id).join(',') === reversed.join(','), 'stale reorder does not change snapshot');
  assert((await request('/trending', write('PUT', { productIds: originalIds, version: fresh.version }))).status === 409, 'repeated stale reorder rejected');
  assert((await (await request('/trending', { headers })).json() as typeof snapshot).version === afterReorder.version, 'repeated stale reorder leaves version unchanged');
  await db.prepare("DELETE FROM products WHERE id LIKE 'pagination-test-%'").run();
  const afterMembership = await (await request('/trending', { headers })).json() as typeof snapshot;
  assert(afterMembership.version !== afterReorder.version, 'changed membership invalidates snapshot');
  assert((await request('/trending', write('PUT', { productIds: reversed, version: afterReorder.version }))).status === 409, 'membership change rejects stale reorder');
  const failedBefore = await db.prepare("SELECT COUNT(*) AS count FROM sync_runs WHERE trigger_type = 'admin' AND status = 'failed'").first<{ count: number }>();
  assert((await request('/', write('POST', product))).status === 409, 'duplicate product must conflict');
  assert((await (await request('/trending', { headers })).json() as typeof snapshot).version === afterMembership.version, 'failed product write leaves snapshot unchanged');
  const failedAfter = await db.prepare("SELECT COUNT(*) AS count FROM sync_runs WHERE trigger_type = 'admin' AND status = 'failed' AND failed_count = 1 AND error_summary IS NOT NULL").first<{ count: number }>();
  assert(failedAfter?.count === (failedBefore?.count ?? 0) + 1, 'failed product write must be recorded as failed');

  const updated = { ...product, description: null, isTrending: false, trendingSortOrder: -2 };
  assert((await request(`/${stored.id}`, write('PUT', updated))).status === 200, 'update must succeed');
  const after = await db.prepare('SELECT description, is_trending, trending_sort_order FROM products WHERE id = ?')
    .bind(stored.id).first<{ description: string | null; is_trending: number; trending_sort_order: number }>();
  assert(after?.description === null && after.is_trending === 0 && after.trending_sort_order === -2, 'update must persist metadata');
  const nowText = now.toISOString();
  await db.prepare('INSERT INTO external_product_mappings (id, provider, external_id, product_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind('admin-xlsx-mapping', 'xlsx:kiotviet', 'manual-1', stored.id, nowText, nowText).run();
  const ownedListing = await (await request('/', { headers })).json() as { products: Array<{ id: string; xlsxOwned: number }> };
  assert(ownedListing.products.find(item => item.id === stored.id)?.xlsxOwned === 1, 'listing exposes XLSX ownership');
  const ownedDetail = await (await request(`/${stored.id}`, { headers })).json() as { product: { xlsxOwned: number } };
  assert(ownedDetail.product.xlsxOwned === 1, 'detail exposes XLSX ownership');
  for (const change of [
    { sku: 'OTHER' }, { name: 'Other' }, { brandName: null }, { priceMinor: null }, { currency: 'USD' }, { isActive: false },
  ]) {
    const response = await request(`/${stored.id}`, write('PUT', { ...updated, ...change, description: 'must not persist' }));
    assert(response.status === 409 && (await response.json() as { error: { code: string } }).error.code === 'XLSX_OWNED_FIELDS',
      'changed XLSX-owned field must return actionable conflict');
  }
  const preserved = await db.prepare('SELECT description, currency FROM products WHERE id = ?').bind(stored.id).first<{ description: string | null; currency: string }>();
  assert(preserved?.description === null && preserved.currency === 'VND', 'conflict must not partially save changes');
  assert((await request(`/${stored.id}`, write('PUT', { ...updated, description: 'Editorial', isTrending: true, trendingSortOrder: 4, slug: 'edited-slug' }))).status === 200,
    'unchanged XLSX fields and editorial changes must save');
  await db.prepare('DELETE FROM external_product_mappings WHERE id = ?').bind('admin-xlsx-mapping').run();
  assert((await request(`/${stored.id}`, write('PUT', { ...updated, name: 'Manual edit', currency: 'USD' }))).status === 200, 'manual product source fields remain editable');
  await db.prepare('INSERT INTO product_variants (id, product_id, name) VALUES (?, ?, ?)').bind('image-test-variant', stored.id, 'Variant').run();
  const descriptionPath = `/${stored.id}/variants/image-test-variant/description`;
  assert((await request(`/${stored.id}/variants`)).status === 401, 'variant listing requires authentication');
  assert((await request(descriptionPath, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"description":"x"}' })).status === 401, 'variant edit requires authentication');
  const unreadVariant = new Request(`https://api.example.test${descriptionPath}`, write('PUT', { description: 'x' }, { 'X-CSRF-Token': '' }));
  assert((await routes.fetch(unreadVariant, bindings)).status === 403 && !unreadVariant.bodyUsed, 'variant edit checks CSRF before reading');
  for (const input of [{}, { description: 1 }, { description: 'x', extra: true }, { description: 'x'.repeat(20001) }]) {
    assert((await request(descriptionPath, write('PUT', input))).status === 400, 'invalid variant description rejected');
  }
  assert((await request(descriptionPath, { ...write('PUT', {}), body: '{' })).status === 400, 'malformed variant JSON rejected');
  assert((await request(descriptionPath, write('PUT', { description: 'x' }, { 'Content-Type': 'text/plain' }))).status === 400, 'variant edit requires JSON');
  assert((await request(`/missing/variants/image-test-variant/description`, write('PUT', { description: 'x' }))).status === 404, 'variant must belong to product');
  assert((await request(descriptionPath, write('PUT', { description: 'Mô tả biến thể' }))).status === 200, 'variant description saved');
  const variants = await (await request(`/${stored.id}/variants`, { headers })).json() as { variants: Array<{ id: string; description: string | null }> };
  assert(variants.variants.find(item => item.id === 'image-test-variant')?.description === 'Mô tả biến thể', 'variant listing returns description');
  assert((await request(descriptionPath, write('PUT', { description: null }))).status === 200, 'variant description can be cleared');
  assert((await db.prepare('SELECT description FROM product_variants WHERE id = ?').bind('image-test-variant').first<{ description: string | null }>())?.description === null, 'cleared description persists');
  await db.prepare('INSERT INTO product_images (id, product_id, source_url, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind('image-test-one', stored.id, 'https://example.test/one', 0, nowText, nowText).run();
  await db.prepare('INSERT INTO product_images (id, product_id, source_url, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind('image-test-two', stored.id, 'https://example.test/two', 1, nowText, nowText).run();
  const imagesPath = `/${stored.id}/images`;
  const variantPath = `/${stored.id}/variants/image-test-variant/images`;
  assert((await request(imagesPath)).status === 401, 'image listing requires authentication');
  assert((await request(imagesPath, write('POST', { url: 'https://evil.test/image.jpg' }))).status === 400, 'untrusted upload URL rejected');
  const attachment = await request(imagesPath, write('POST', { url: 'https://images.example.test/12345678-1234-4123-8123-123456789abc.jpg' }));
  assert(attachment.status === 201, 'uploaded image attachment succeeds');
  const attached = await attachment.json() as { id: string };
  const untrustedImage = await (await request('/?search=MANUAL-1', { headers })).json() as { products: Array<{ imageUrl: string | null }> };
  assert(untrustedImage.products[0]?.imageUrl === null, 'untrusted primary image is not exposed');
  await db.prepare('UPDATE product_images SET position = -1 WHERE id = ?').bind(attached.id).run();
  const trustedImage = await (await request('/?search=MANUAL-1', { headers })).json() as { products: Array<{ imageUrl: string | null }> };
  assert(trustedImage.products[0]?.imageUrl === 'https://images.example.test/12345678-1234-4123-8123-123456789abc.jpg', 'trusted primary image is exposed');
  assert((await request(`${imagesPath}/${attached.id}`, { method: 'DELETE', headers })).status === 200, 'attached image can be detached');
  assert((await request(imagesPath, write('PUT', { imageIds: ['image-test-two', 'image-test-one'] }, { 'X-CSRF-Token': '' }))).status === 403, 'image ordering requires CSRF');
  assert((await request(imagesPath, write('PUT', { imageIds: ['image-test-two', 'image-test-one'] }))).status === 200, 'image reorder succeeds');
  const ordered = await (await request(imagesPath, { headers })).json() as { images: Array<{ id: string }> };
  assert(ordered.images[0]?.id === 'image-test-two', 'image order is persisted');
  const initialVariant = await (await request(variantPath, { headers })).json() as { version: string };
  const assignment = await request(variantPath, write('PUT', { imageIds: ['image-test-two', 'image-test-one'], version: initialVariant.version }));
  assert(assignment.status === 200, 'variant assignment succeeds');
  const assigned = await assignment.json() as { version: string };
  assert((await request(variantPath, write('PUT', { imageIds: ['image-test-one'], version: initialVariant.version }))).status === 409, 'stale toggle rejected');
  assert((await request(variantPath, write('PUT', { imageIds: ['image-test-one', 'image-test-two'], version: initialVariant.version }))).status === 409, 'stale reorder rejected');
  assert((await request(variantPath, write('POST', { imageId: 'image-test-one', version: initialVariant.version }))).status === 409, 'stale upload assignment rejected');
  const imageFailuresBefore = await db.prepare("SELECT COUNT(*) AS count FROM sync_runs WHERE trigger_type = 'admin' AND status = 'failed'").first<{ count: number }>();
  assert((await request(variantPath, write('PUT', { imageIds: ['foreign-image'], version: assigned.version }))).status === 400, 'foreign images rejected');
  const imageFailuresAfter = await db.prepare("SELECT COUNT(*) AS count FROM sync_runs WHERE trigger_type = 'admin' AND status = 'failed'").first<{ count: number }>();
  assert(imageFailuresAfter?.count === (imageFailuresBefore?.count ?? 0) + 1, 'rejected image write must be recorded as failed');
  const variantImages = await (await request(variantPath, { headers })).json() as { images: Array<{ id: string }> };
  assert(variantImages.images.map(item => item.id).join(',') === 'image-test-two,image-test-one', 'invalid assignment preserves variant order');
  await db.prepare('INSERT INTO xlsx_product_images (product_id, source_url, image_id, position, created_by_xlsx) VALUES (?, ?, ?, ?, ?)')
    .bind(stored.id, 'https://example.test/one', 'image-test-one', 0, 1).run();
  assert((await request(`${imagesPath}/image-test-one`, { method: 'DELETE', headers })).status === 409, 'XLSX image cannot be deleted');
  assert((await request(`${imagesPath}/image-test-two`, { method: 'DELETE', headers })).status === 200, 'editorial image can be deleted');
  assert((await request(`/${stored.id}/variants/missing/images`, { headers })).status === 404, 'variant ownership is required');
  assert((await request('/missing', write('PUT', updated))).status === 404, 'missing update must return 404');
  await db.prepare("INSERT INTO sync_runs (id, provider, trigger_type, started_at, status) VALUES ('busy-test', 'xlsx:kiotviet', 'admin', '2026', 'running')").run();
  assert((await request('/trending', write('PUT', { productIds: [], version: afterStale.version }))).status === 409, 'running import blocks reorder');
  assert((await request(`/trending/${stored.id}`, write('DELETE', { version: afterStale.version }))).status === 409, 'running import blocks trending removal');
  assert((await request(descriptionPath, write('PUT', { description: 'blocked' }))).status === 409, 'running import blocks variant edit');
  assert((await request(visibilityPath, write('PUT', { isHidden: true }))).status === 409, 'running import blocks visibility edit');
  assert((await request(`/${stored.id}`, { method: 'DELETE', headers })).status === 409, 'running import must block manual writes');
  await db.prepare("UPDATE sync_runs SET status = 'completed' WHERE id = 'busy-test'").run();
  assert((await request(`/${stored.id}`, { method: 'DELETE', headers })).status === 200, 'delete must succeed');
  assert((await request(`/${stored.id}`, { method: 'DELETE', headers })).status === 404, 'missing delete must return 404');
  const running = await db.prepare("SELECT COUNT(*) AS count FROM sync_runs WHERE provider = 'xlsx:kiotviet' AND status = 'running'").first<{ count: number }>();
  assert(running?.count === 0, 'manual writes must release catalog lock');
}
