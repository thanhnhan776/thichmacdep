import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

const root = fileURLToPath(new URL('../', import.meta.url));
const wrangler = join(root, 'node_modules/wrangler/bin/wrangler.js');
const env = { ...process.env, CI: 'true', NG_CLI_ANALYTICS: 'false', WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', WRANGLER_LOAD_DOT_ENV: 'false' };

function start(args, cwd = root) {
  const child = spawn(process.execPath, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { output = (output + chunk).slice(-32000); });
  return { child, output: () => output };
}

async function run(args, cwd = root) {
  const process = start(args, cwd);
  const [code, signal] = await once(process.child, 'exit');
  assert.equal(code, 0, `command failed (${signal ?? code}): ${process.output()}`);
}

async function stop({ child }) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  if (!await Promise.race([exited.then(() => true), delay(5000).then(() => false)])) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await exited;
  }
}

async function port() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

test('isolated multiworker D1 data reaches dynamic raw SSR HTML', { timeout: 180000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'storefront-proof-'));
  const state = join(dir, 'state');
  const envFile = join(dir, 'empty.env');
  let worker;
  try {
    await writeFile(envFile, '');
    const d1 = (...args) => run([wrangler, 'd1', ...args, '--local', '-c', 'wrangler.jsonc', '--persist-to', state]);
    await d1('migrations', 'apply', 'DB');
    await d1('execute', 'DB', '--file', 'scripts/seed-local.sql');
    await d1('execute', 'DB', '--command', "INSERT INTO product_images (id, product_id, source_url, alt_text, position, created_at, updated_at) VALUES ('proof-image', 'prod-linen-shirt', 'https://cdn2-retail-images.kiotviet.vn/synthetic-proof.jpg', 'Synthetic linen image', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')");
    await run([join(root, 'apps/storefront/node_modules/@angular/cli/bin/ng.js'), 'build', '--project', 'storefront'], join(root, 'apps/storefront'));
    const base = `http://127.0.0.1:${await port()}`;
    worker = start([wrangler, 'dev', '-c', 'apps/storefront/wrangler.jsonc', '-c', 'wrangler.jsonc', '--local', '--ip', '127.0.0.1', '--port', new URL(base).port, '--persist-to', state, '--env-file', envFile, '--var', 'SITE_ORIGIN:https://storefront.example.test']);
    const deadline = Date.now() + 45000;
    while (!/ready on/i.test(worker.output())) {
      if (worker.child.exitCode !== null || worker.child.signalCode !== null || Date.now() > deadline) throw new Error(`Workers not ready: ${worker.output()}`);
      await delay(200);
    }
    const get = (path) => fetch(`${base}${path}`, { signal: AbortSignal.timeout(10000) });
    const health = await get('/api/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });
    const privateData = /Canvas Bag|Cotton Hat|private-r2-key-sentinel|private-source-sentinel|fixture-provider|external-1001/;
    const page = async (path) => {
      const response = await get(path);
      assert.equal(response.status, 200, path);
      const html = await response.text();
      assert.doesNotMatch(html, privateData, path);
      return html;
    };
    for (const path of ['/', '/products']) {
      const html = await page(path);
      assert.match(html, /<h1[^>]*>Tất cả sản phẩm<\/h1>/);
      assert.match(html, /Linen Shirt/);
      assert.match(html, /Cotton Tee/);
      assert.match(html, /Tops/);
      if (path === '/') {
        assert.match(html, /<title>Thích Mặc Đẹp \| Home<\/title>/);
        assert.match(html, /<link[^>]*rel="canonical"[^>]*href="https:\/\/storefront\.example\.test\/"/);
      } else {
        assert.match(html, /<title>Products \| Thích Mặc Đẹp<\/title>/);
        assert.match(html, /<link[^>]*rel="canonical"[^>]*href="https:\/\/storefront\.example\.test\/products"/);
      }
    }
    const tops = await page('/categories/tops');
    assert.match(tops, /<h1[^>]*>Tops<\/h1>/);
    assert.match(tops, /Linen Shirt/);
    assert.match(tops, /Cotton Tee/);
    assert.doesNotMatch(tops, /Wide Trousers/);
    assert.match(tops, /<title>Tops \| Thích Mặc Đẹp<\/title>/);
    const detail = await page('/products/linen-shirt');
    assert.match(detail, /<h1[^>]*>Linen Shirt<\/h1>/);
    assert.match(detail, /<img[^>]+src="https:\/\/cdn2-retail-images\.kiotviet\.vn\/synthetic-proof\.jpg"/);
    assert.match(detail, /<title>Linen Shirt \| Fixture Store<\/title>/);
    assert.match(detail, /<meta[^>]*name="description"[^>]*content="A light linen shirt\."/);
    assert.match(detail, /<link[^>]*rel="canonical"[^>]*href="https:\/\/storefront\.example\.test\/products\/linen-shirt"/);
    const filtered = await page('/products?keyword=linen&category=tops');
    assert.match(filtered, /Linen Shirt/);
    assert.doesNotMatch(filtered, /Cotton Tee|Wide Trousers/);
    assert.match(filtered, /<meta[^>]*name="robots"[^>]*content="noindex, follow"/);
    assert.doesNotMatch(filtered, /rel="canonical"/);
    const secondPage = await page('/products?page=2');
    assert.match(secondPage, /Trang 2/);
    assert.match(secondPage, /Không có sản phẩm trên trang này/);
    assert.doesNotMatch(secondPage, /Linen Shirt|Cotton Tee|Wide Trousers/);
    for (const path of ['/categories/no-such-category', '/products/no-such-product', '/products/hidden-bag', '/products/inactive-hat']) {
      assert.equal((await get(path)).status, 404, path);
    }
    for (const path of ['/products?page=0', '/products?keyword=linen&keyword=cotton', '/products?unknown=value']) {
      assert.equal((await get(path)).status, 400, path);
    }
    const response = await get('/_internal/proof?keyword=linen');
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Linen Shirt/);
    assert.doesNotMatch(html, /Cotton Tee|Canvas Bag|private-r2-key-sentinel|fixture-provider|external-1001/);
    const script = html.match(/<script\b[^>]*\bsrc=["']([^"']+\.js(?:\?[^"']*)?)["']/i)?.[1];
    assert.ok(script);
    const asset = await fetch(new URL(script, base), { signal: AbortSignal.timeout(10000) });
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type') ?? '', /javascript/i);
    assert.equal((await get('/no-such-page')).status, 404);
    assert.equal((await get('/missing-asset.js')).status, 404);
    assert.equal((await get('/no-such-page.css')).status, 404);
    const admin = await get('/admin/import');
    assert.equal(admin.status, 200);
    assert.match(await admin.text(), /Quản trị sản phẩm/);
    await d1('execute', 'DB', '--command', "UPDATE products SET name = 'Linen Proof Changed' WHERE id = 'prod-linen-shirt'");
    const updatedApi = await get('/api/products/linen-shirt');
    assert.equal(updatedApi.status, 200);
    assert.equal((await updatedApi.json()).name, 'Linen Proof Changed');
    const updatedDetail = await page('/products/linen-shirt');
    assert.match(updatedDetail, /<h1[^>]*>Linen Proof Changed<\/h1>/);
    const changed = await get('/_internal/proof?keyword=linen');
    assert.equal(changed.status, 200);
    const changedHtml = await changed.text();
    assert.match(changedHtml, /Linen Proof Changed/);
    assert.doesNotMatch(changedHtml, /Linen Shirt/);
    assert.equal((await get('/api/no-such-route')).status, 404);
  } finally {
    if (worker) await stop(worker);
    await rm(dir, { recursive: true, force: true });
  }
});

test('synthetic admin import and reimport update raw SSR without a rebuild', { timeout: 180000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'admin-ssr-proof-'));
  const state = join(dir, 'state');
  const envFile = join(dir, 'empty.env');
  const config = join(dir, 'api.json');
  let worker;
  try {
    const keys = await generateKeyPair('RS256', { extractable: true });
    const base = `http://127.0.0.1:${await port()}`;
    const origin = 'https://admin.example.test';
    await writeFile(envFile, '');
    await writeFile(config, JSON.stringify({
      name: 'thichmacdep-api-local', main: join(root, 'tests/admin-ssr-api-worker.ts'),
      compatibility_date: '2026-11-01',
      d1_databases: [{ binding: 'DB', database_name: 'thichmacdep-local', database_id: '00000000-0000-0000-0000-000000000000', migrations_dir: join(root, 'drizzle/migrations') }],
      r2_buckets: [{ binding: 'IMAGES', bucket_name: 'thichmacdep-local' }],
      vars: { GOOGLE_CLIENT_ID: 'synthetic-client', ADMIN_ORIGIN: origin, TEST_PUBLIC_JWK: JSON.stringify(await exportJWK(keys.publicKey)), IMAGE_PUBLIC_BASE_URL: `${base}/api/images/`, IMAGE_ALLOW_LOCAL: 'true' },
    }));
    const d1 = (...args) => run([wrangler, 'd1', ...args, '--local', '-c', config, '--persist-to', state]);
    await d1('migrations', 'apply', 'DB');
    await d1('execute', 'DB', '--command', "INSERT INTO admin_users (id, email, role, is_enabled, created_at, updated_at) VALUES ('synthetic-admin', 'synthetic@gmail.com', 'admin', 1, '2026', '2026')");
    await run([join(root, 'apps/storefront/node_modules/@angular/cli/bin/ng.js'), 'build', '--project', 'storefront'], join(root, 'apps/storefront'));
    worker = start([wrangler, 'dev', '-c', 'apps/storefront/wrangler.jsonc', '-c', config, '--local', '--ip', '127.0.0.1', '--port', new URL(base).port, '--persist-to', state, '--env-file', envFile, '--var', 'SITE_ORIGIN:https://storefront.example.test']);
    const deadline = Date.now() + 45000;
    while (!/ready on/i.test(worker.output())) {
      if (worker.child.exitCode !== null || worker.child.signalCode !== null || Date.now() > deadline) throw new Error(`Workers not ready: ${worker.output()}`);
      await delay(200);
    }
    const request = (path, init = {}) => fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(10000) });
    const post = (headers, body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const rows = [{ 'Loại hàng': 'Hàng hóa', 'Mã hàng': 'SYNTHETIC-SSR-001', 'Tên hàng': 'Synthetic Original Shirt', 'Nhóm hàng(3 Cấp)': 'Synthetic Category', 'Thương hiệu': 'Synthetic Brand', 'Giá bán': 100, 'Đang kinh doanh': true, 'Được bán trực tiếp': true, 'Hình ảnh (url1,url2...)': 'https://cdn2-retail-images.kiotviet.vn/synthetic-import.jpg', 'Thuộc tính': '' }];
    const previewPath = '/api/admin/import/preview';
    assert.equal((await request(previewPath, post({}, { rows }))).status, 401);
    assert.equal((await request('/api/admin/import/apply', post({}, { rows, digest: '0'.repeat(64), catalogSnapshot: '0'.repeat(64) }))).status, 401);
    assert.equal((await (await request('/api/products')).json()).total, 0, 'isolated catalog starts empty');
    const challenge = await request('/api/admin/auth/challenge', post({ Origin: origin }, {}));
    assert.equal(challenge.status, 200);
    const { nonce } = await challenge.json();
    assert.match(challenge.headers.get('set-cookie') ?? '', /admin_nonce=/);
    const idToken = await new SignJWT({ email: 'synthetic@gmail.com', email_verified: true, nonce })
      .setProtectedHeader({ alg: 'RS256' }).setIssuer('https://accounts.google.com').setAudience('synthetic-client')
      .setSubject('synthetic-subject').setExpirationTime('5m').sign(keys.privateKey);
    const login = await request('/api/admin/auth/login', post({ Origin: origin, Cookie: `admin_nonce=${nonce}` }, { idToken }));
    assert.equal(login.status, 200);
    const session = /admin_session=([A-Za-z0-9_-]{43})/.exec(login.headers.get('set-cookie') ?? '')?.[1];
    assert.ok(session);
    const cookie = `admin_session=${session}`;
    const sessionResponse = await request('/api/admin/auth/session', { headers: { Cookie: cookie } });
    assert.equal(sessionResponse.status, 200);
    const { csrfToken } = await sessionResponse.json();
    assert.ok(csrfToken);
    const headers = { Cookie: cookie, Origin: origin, 'X-CSRF-Token': csrfToken };
    assert.equal((await request(previewPath, post({ ...headers, 'X-CSRF-Token': '' }, { rows }))).status, 403);
    const importRows = async (input, created, updated) => {
      const preview = await request(previewPath, post(headers, { rows: input }));
      assert.equal(preview.status, 200);
      const { digest, catalogSnapshot, errors } = await preview.json();
      assert.deepEqual(errors, []);
      const apply = await request('/api/admin/import/apply', post(headers, { rows: input, digest, catalogSnapshot }));
      assert.equal(apply.status, 200);
      const result = await apply.json();
      assert.equal(result.created, created);
      assert.equal(result.updated, updated);
    };
    await importRows(rows, 1, 0);
    const list = await (await request('/api/products')).json();
    assert.equal(list.total, 1);
    const { id, slug } = list.items[0];
    assert.ok(id && slug);
    const localConfig = await readFile(join(root, 'wrangler.storefront-local.jsonc'), 'utf8');
    assert.match(localConfig, /"IMAGE_PUBLIC_BASE_URL":\s*"http:\/\/localhost:4200\/api\/images\/"/);
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const upload = await request('/api/admin/images', { method: 'POST', headers: { ...headers, 'Content-Type': 'image/png' }, body: png });
    assert.equal(upload.status, 201);
    const { url } = await upload.json();
    assert.equal(new URL(url).origin, base);
    const attach = await request(`/api/admin/products/${id}/images`, post(headers, { url }));
    assert.equal(attach.status, 201);
    const image = await fetch(url);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.deepEqual(new Uint8Array(await image.arrayBuffer()), png);
    const imageProduct = await (await request(`/api/products/${encodeURIComponent(slug)}`)).json();
    assert.ok(imageProduct.images.some(image => image.url === url));
    const page = async () => {
      const response = await request(`/products/${encodeURIComponent(slug)}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /text\/html/i);
      return response.text();
    };
    assert.match(await page(), /<h1[^>]*>Synthetic Original Shirt<\/h1>/);
    const changed = [{ ...rows[0], 'Tên hàng': 'Synthetic Updated Shirt' }];
    await importRows(changed, 0, 1);
    const updated = await (await request(`/api/products/${encodeURIComponent(slug)}`)).json();
    assert.equal(updated.id, id);
    assert.equal(updated.slug, slug);
    assert.equal(updated.name, 'Synthetic Updated Shirt');
    const html = await page();
    assert.match(html, /<h1[^>]*>Synthetic Updated Shirt<\/h1>/);
    assert.doesNotMatch(html, /Synthetic Original Shirt/);
    assert.equal((await (await request('/api/products')).json()).total, 1, 'reimport must not duplicate the product');
  } finally {
    if (worker) await stop(worker);
    await rm(dir, { recursive: true, force: true });
  }
});
