import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));

async function availablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForWorker(child, url, getOutput) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Wrangler exited before readiness: ${getOutput()}`);
    }
    // Wait for Wrangler's own readiness message rather than accepting an unrelated server.
    if (/ready on/i.test(getOutput())) {
      try {
        return await fetch(url, { signal: AbortSignal.timeout(2000) });
      } catch (error) {
        if (error.name !== 'TypeError' && error.name !== 'TimeoutError') throw error;
      }
    }
    await delay(200);
  }
  throw new Error(`Timed out waiting for Wrangler: ${getOutput()}`);
}

async function stopWorker(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
  const stopped = await Promise.race([exited.then(() => true), delay(5000).then(() => false)]);
  if (!stopped) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
    await exited;
  }
}

async function withWorker(config, run, persistPath) {
  const port = await availablePort();
  const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--config', config, '--port', String(port), '--ip', '127.0.0.1', ...(persistPath ? ['--persist-to', persistPath] : [])], {
    cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => { output = (output + chunk.toString()).slice(-16000); });
  }
  const url = `http://127.0.0.1:${port}`;
  try {
    await waitForWorker(child, `${url}/api/health`, () => output);
    return await run(url);
  } finally {
    await stopWorker(child);
  }
}

test('health endpoint returns ok and does not expose write routes', async () => {
  await withWorker('wrangler.jsonc', async (url) => {
    const health = await fetch(`${url}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });
    assert.equal((await fetch(`${url}/api/health`, { method: 'POST' })).status, 404);
  });
});

async function runD1(persistPath, args) {
  const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', ...args, '--local', '--config', 'wrangler.jsonc', '--persist-to', persistPath], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { output += chunk; });
  const [code, signal] = await once(child, 'exit');
  assert.equal(code, 0, `Wrangler D1 failed (${signal ?? code}): ${output}`);
}

test('local D1 catalog integration', { timeout: 120000 }, async (t) => {
  const persistPath = await mkdtemp(join(tmpdir(), 'catalog-d1-test-'));
  try {
    await runD1(persistPath, ['migrations', 'apply', 'DB']);
    const seed = () => runD1(persistPath, ['execute', 'DB', '--file', 'scripts/seed-local.sql']);
    await seed();
    await runD1(persistPath, ['execute', 'DB', '--command', "UPDATE website_product_settings SET seo_title = 'Owner title' WHERE product_id = 'prod-linen-shirt'; UPDATE store_settings SET store_name = 'Owner store' WHERE id = 'default';"]);
    await seed();
    await runD1(persistPath, ['execute', 'DB', '--command', `INSERT INTO product_images (id, product_id, source_url, r2_key, alt_text, position, created_at, updated_at) VALUES
      ('test-image-later', 'prod-linen-shirt', 'https://cdn1-retail-images.kiotviet.vn/synthetic-later.jpg', 'private-r2-key-sentinel', NULL, 20, '2020', '2020'),
      ('test-image-first', 'prod-linen-shirt', 'https://cdn2-retail-images.kiotviet.vn/synthetic-first.jpg', NULL, 'Synthetic', 1, '2020', '2020'),
      ('test-image-http', 'prod-linen-shirt', 'http://cdn2-retail-images.kiotviet.vn/unsafe', NULL, NULL, 2, '2020', '2020'),
      ('test-image-subdomain', 'prod-linen-shirt', 'https://cdn2-retail-images.kiotviet.vn.evil.test/unsafe', NULL, NULL, 3, '2020', '2020'),
      ('test-image-user', 'prod-linen-shirt', 'https://user@cdn2-retail-images.kiotviet.vn/unsafe', NULL, NULL, 4, '2020', '2020'),
      ('test-image-port', 'prod-linen-shirt', 'https://cdn2-retail-images.kiotviet.vn:444/unsafe', NULL, NULL, 5, '2020', '2020'),
      ('test-image-invalid', 'prod-linen-shirt', 'not-a-url', NULL, NULL, 6, '2020', '2020');`]);
    await withWorker('wrangler.jsonc', async (url) => {
      async function get(path, status = 200) {
        const response = await fetch(`${url}${path}`);
        assert.equal(response.status, status, path);
        return response.json();
      }
      const slugs = (result) => result.items.map((item) => item.slug);
      await t.test('pagination, visibility and limits', async () => {
        const all = await get('/api/products');
        assert.equal(all.total, 3);
        assert.deepEqual(slugs(all), ['linen-shirt', 'cotton-tee', 'wide-trousers']);
        const first = await get('/api/products?page=1&pageSize=2');
        const second = await get('/api/products?page=2&pageSize=2');
        assert.deepEqual([first.total, first.page, first.pageSize], [3, 1, 2]);
        assert.deepEqual(slugs(first), ['linen-shirt', 'cotton-tee']);
        assert.deepEqual(slugs(second), ['wide-trousers']);
        assert.deepEqual(slugs(await get('/api/products?page=3&pageSize=2')), []);
        assert.equal((await get('/api/products?pageSize=100')).pageSize, 100);
        for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=9007199254740992', 'page=9007199254740991&pageSize=100', 'pageSize=0', 'pageSize=101', 'page=1&page=2', 'extra=x', 'keyword=', 'keyword=%20', 'category=', `keyword=${'x'.repeat(201)}`, `category=${'x'.repeat(201)}`]) {
          assert.equal((await get(`/api/products?${query}`, 400)).error.code, 'INVALID_QUERY');
        }
      });
      await t.test('keyword and category filtering', async () => {
        assert.deepEqual(slugs(await get('/api/products?keyword=linen')), ['linen-shirt']);
        assert.deepEqual(slugs(await get('/api/products?keyword=TOP-COTTON')), ['cotton-tee']);
        for (const keyword of ['%', '_', '\\']) {
          assert.deepEqual(slugs(await get(`/api/products?keyword=${encodeURIComponent(keyword)}`)), []);
        }
        assert.deepEqual(slugs(await get('/api/products?category=tops')), ['linen-shirt', 'cotton-tee']);
        assert.deepEqual(slugs(await get('/api/products?category=tops&keyword=linen')), ['linen-shirt']);
        assert.deepEqual(slugs(await get('/api/products?category=accessories')), []);
        assert.deepEqual(slugs(await get('/api/products?category=unknown')), []);
      });
      await t.test('details and public fields do not expose provider or sync data', async () => {
        const product = await get('/api/products/linen-shirt');
        assert.equal(product.id, 'prod-linen-shirt');
        assert.deepEqual(product.website, { seoTitle: 'Owner title', seoDescription: 'A light linen shirt.', marketingDescription: 'A versatile everyday layer.', isFeatured: true, displayOrder: 10 });
        assert.equal(product.seoTitle, undefined);
        assert.deepEqual(product.images, [
          { id: 'test-image-first', url: 'https://cdn2-retail-images.kiotviet.vn/synthetic-first.jpg', altText: 'Synthetic', position: 1 },
          { id: 'test-image-later', url: 'https://cdn1-retail-images.kiotviet.vn/synthetic-later.jpg', altText: null, position: 20 },
        ]);
        assert.deepEqual(product.variants.map((variant) => variant.id).sort(), ['variant-linen-shirt-l', 'variant-linen-shirt-m']);
        assert.deepEqual(product.categories.map((category) => category.slug).sort(), ['clothing', 'tops']);
        for (const path of ['/api/products/missing', '/api/products/hidden-bag', '/api/products/inactive-hat']) {
          assert.equal((await get(path, 404)).error.code, 'NOT_FOUND');
        }
        const publicData = JSON.stringify([product, await get('/api/products'), await get('/api/categories'), await get('/api/store-settings')]);
        assert.doesNotMatch(publicData, /private-source-sentinel|private-r2-key-sentinel|source_url|sourceUrl|r2_key|r2Key/i);
        assert.doesNotMatch(publicData, /fixture-provider|external-1001|externalId|externalVariantId|provider|lastSyncedAt|sourceUpdatedAt|syncRun/i);
      });
      await t.test('categories and website-owned store settings', async () => {
        const categories = await get('/api/categories');
        assert.deepEqual(categories.map((category) => category.slug), ['accessories', 'bottoms', 'clothing', 'tops']);
        assert.deepEqual(await get('/api/categories/tops'), { id: 'cat-tops', name: 'Tops', slug: 'tops', parentId: 'cat-clothing' });
        assert.equal((await get('/api/categories/missing', 404)).error.code, 'NOT_FOUND');
        assert.deepEqual(await get('/api/store-settings'), { storeName: 'Owner store', defaultCurrency: 'VND', tiktokUrl: null, instagramUrl: null, zaloUrl: null, messengerUrl: null, otherContactUrl: null, logoUrl: null });
        for (const path of ['/api/categories?x=1', '/api/categories/tops?x=1', '/api/products/linen-shirt?x=1', '/api/store-settings?x=1']) await get(path, 400);
      });
      await t.test('public catalog does not offer write routes', async () => {
        for (const path of ['/api/products', '/api/products/linen-shirt', '/api/categories', '/api/categories/tops', '/api/store-settings']) {
          for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
            assert.equal((await fetch(`${url}${path}`, { method })).status, 404, `${method} ${path}`);
          }
        }
        assert.equal((await get('/api/products')).total, 3);
      });
    }, persistPath);
  } finally {
    await rm(persistPath, { recursive: true, force: true });
  }
});

test('local D1 and R2 bindings round trip', async () => {
  await withWorker('wrangler.test.jsonc', async (url) => {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { d1: 'ok', r2: 'ok' });
  });
});
