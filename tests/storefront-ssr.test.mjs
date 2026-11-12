import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

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

test('local Workers SSR returns product HTML and its browser JavaScript', async () => {
  const port = await availablePort();
  const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--config', 'apps/storefront/wrangler.jsonc', '--ip', '127.0.0.1', '--port', String(port)], {
    cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => { output = (output + chunk.toString()).slice(-16000); });
  }
  try {
    const url = `http://127.0.0.1:${port}/_internal/sample`;
    const response = await waitForWorker(child, url, () => output);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/i);
    const html = await response.text();
    assert.match(html, /<h1[^>]*>\s*Sample product\s*<\/h1>/i);
    assert.match(html, /This is sample content, not a product available for sale\./);
    const base = html.match(/<base\b[^>]*href=["']([^"']+)["']/i)?.[1] ?? url;
    const script = html.match(/<script\b[^>]*\bsrc=["']([^"']+\.js(?:\?[^"']*)?)["']/i)?.[1];
    assert.ok(script, 'HTML must reference a browser JavaScript asset');
    const assetUrl = new URL(script, new URL(base, url));
    assert.equal(assetUrl.origin, new URL(url).origin, 'asset must be local');
    const asset = await fetch(assetUrl, { signal: AbortSignal.timeout(5000) });
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type') ?? '', /javascript/i);
    assert.ok((await asset.text()).length > 0, 'JavaScript asset must not be empty');
  } finally {
    await stopWorker(child);
  }
});

test('synthetic catalog worker renders isolated SEO metadata', { timeout: 60000 }, async () => {
  const port = await availablePort();
  const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--config', 'tests/wrangler.storefront-seo.jsonc', '--ip', '127.0.0.1', '--port', String(port)], {
    cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-16000); });
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitForWorker(child, `${base}/products/alpha`, () => output);
    const get = path => fetch(`${base}${path}`, { signal: AbortSignal.timeout(10000) });
    const [a, b, category, filtered, missing, noOrigin, home, products, filteredHome] = await Promise.all([
      get('/products/alpha'), get('/products/beta'), get('/categories/linen'),
      get('/products?keyword=linen'), get('/products/missing'), get('/products/alpha?no-origin'),
      get('/'), get('/products'), get('/?keyword=linen'),
    ]);
    assert.equal(missing.status, 404);
    const [ah, bh, ch, fh, mh, nh] = await Promise.all([a.text(), b.text(), category.text(), filtered.text(), missing.text(), noOrigin.text()]);
    assert.match(ah, /<title>Product alpha \| Thích Mặc Đẹp<\/title>/);
    assert.match(ah, /https:\/\/shop\.example\/products\/alpha/);
    assert.doesNotMatch(ah, /Product beta|127\.0\.0\.1:\d+\/products\/alpha/);
    assert.match(bh, /<title>Product beta \| Thích Mặc Đẹp<\/title>/);
    assert.doesNotMatch(bh, /Product alpha/);
    assert.match(ch, /https:\/\/shop\.example\/categories\/linen/);
    const [homeHtml, productsHtml, filteredHomeHtml] = await Promise.all([home.text(), products.text(), filteredHome.text()]);
    assert.match(homeHtml, /<title>Thích Mặc Đẹp \| Home<\/title>/);
    assert.match(homeHtml, /name="description" content="Discover Thích Mặc Đẹp and explore our catalog\."/);
    assert.match(homeHtml, /rel="canonical" href="https:\/\/shop\.example\/"/);
    assert.match(homeHtml, /property="og:url" content="https:\/\/shop\.example\/"/);
    assert.match(productsHtml, /<title>Products \| Thích Mặc Đẹp<\/title>/);
    assert.match(productsHtml, /name="description" content="Explore products at Thích Mặc Đẹp\."/);
    assert.match(productsHtml, /rel="canonical" href="https:\/\/shop\.example\/products"/);
    for (const html of [fh, mh, filteredHomeHtml]) {
      assert.match(html, /name="robots" content="noindex, follow"/);
      assert.doesNotMatch(html, /rel="canonical"|property="og:url"/);
    }
    assert.doesNotMatch(nh, /rel="canonical"|property="og:url"/);
    const map = await get('/sitemap.xml?sitemap-data');
    assert.equal(map.status, 200);
    assert.match(map.headers.get('content-type'), /application\/xml/);
    assert.match(map.headers.get('cache-control'), /no-store/);
    const xml = await map.text();
    assert.match(xml, /<loc>https:\/\/shop\.example\/<\/loc>/);
    assert.match(xml, /<loc>https:\/\/shop\.example\/products<\/loc>/);
    assert.match(xml, /https:\/\/shop\.example\/products\/silk%26lace/);
    assert.match(xml, /https:\/\/shop\.example\/products\/item-100/);
    assert.match(xml, /https:\/\/shop\.example\/products\/proof/);
    assert.match(xml, /https:\/\/shop\.example\/products\/sample/);
    assert.match(xml, /https:\/\/shop\.example\/categories\/linen/);
    assert.doesNotMatch(xml, /127\.0\.0\.1|\/admin|\/api\//);
    for (const option of ['no-origin', 'bad-origin', 'malformed', 'too-large', 'partial']) {
      const response = await get(`/sitemap.xml?${option}`);
      assert.equal(response.status, 503, option);
      assert.match(response.headers.get('cache-control'), /no-store/);
    }
    const head = await fetch(`${base}/sitemap.xml?sitemap-data`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal((await fetch(`${base}/sitemap.xml?partial`, { method: 'HEAD' })).status, 503);
    const robots = await (await get('/robots.txt?production')).text();
    assert.match(robots, /Disallow: \/api\//);
    assert.match(robots, /Disallow: \/admin\//);
    assert.ok(robots.includes(`Sitemap: ${base}/sitemap.xml`));
    for (const option of ['', '?no-origin', '?bad-origin']) assert.match(await (await get(`/robots.txt${option}`)).text(), /Disallow: \/\n/);
  } finally {
    await stopWorker(child);
  }
});
