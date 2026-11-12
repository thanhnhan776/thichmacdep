import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const wrangler = join(root, 'node_modules/wrangler/bin/wrangler.js');
const env = { ...process.env, CI: 'true', NG_CLI_ANALYTICS: 'false', WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', WRANGLER_LOAD_DOT_ENV: 'false' };

async function chromePath() {
  const candidates = process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/opt/google/chrome/chrome',
  ];
  for (const path of candidates) {
    try { await access(path, constants.X_OK); return path; } catch { /* try next */ }
  }
}

function start(command, args, cwd = root) {
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-32000); });
  return { child, output: () => output };
}

async function stop(process) {
  const { child } = process;
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  try { globalThis.process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  if (!await Promise.race([exited.then(() => true), delay(5000).then(() => false)])) {
    try { globalThis.process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await exited;
  }
}

async function run(args, cwd = root) {
  const process = start(globalThis.process.execPath, args, cwd);
  try {
    const [code, signal] = await once(process.child, 'exit');
    assert.equal(code, 0, `command failed (${signal ?? code}): ${process.output()}`);
  } finally { await stop(process); }
}

async function port() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitFor(check, description, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

class CDP {
  constructor(socket) {
    this.socket = socket;
    this.next = 0;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
      } else for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('Chrome DevTools connection closed'));
      this.pending.clear();
    });
  }
  on(method, listener) { this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]); }
  send(method, params = {}) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
}

test('local SSR catalog hydrates and works in offline Chrome', { timeout: 180000 }, async t => {
  const chrome = await chromePath();
  if (!chrome || typeof WebSocket !== 'function') {
    t.skip(`requires ${!chrome ? 'Google Chrome (or CHROME_PATH)' : 'Node native WebSocket'}`);
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), 'storefront-browser-'));
  const state = join(dir, 'state');
  const envFile = join(dir, 'empty.env');
  let worker, browser, socket;
  try {
    await writeFile(envFile, '');
    const d1 = (...args) => run([wrangler, 'd1', ...args, '--local', '-c', 'wrangler.jsonc', '--persist-to', state]);
    await d1('migrations', 'apply', 'DB');
    await d1('execute', 'DB', '--file', 'scripts/seed-local.sql');
    await d1('execute', 'DB', '--command', "INSERT INTO product_images (id, product_id, source_url, alt_text, position, created_at, updated_at) VALUES ('browser-image', 'prod-linen-shirt', 'https://cdn2-retail-images.kiotviet.vn/synthetic-browser.jpg', 'Synthetic image', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')");
    await run([join(root, 'apps/storefront/node_modules/@angular/cli/bin/ng.js'), 'build', '--project', 'storefront'], join(root, 'apps/storefront'));
    const base = `http://127.0.0.1:${await port()}`;
    worker = start(process.execPath, [wrangler, 'dev', '-c', 'apps/storefront/wrangler.jsonc', '-c', 'wrangler.jsonc', '--local', '--ip', '127.0.0.1', '--port', new URL(base).port, '--persist-to', state, '--env-file', envFile, '--var', 'SITE_ORIGIN:https://storefront.example.test']);
    await waitFor(() => {
      if (worker.child.exitCode !== null || worker.child.signalCode !== null) throw new Error(`Worker exited: ${worker.output()}`);
      return /ready on/i.test(worker.output());
    }, 'Worker', 45000);
    for (const [path, heading] of [['/products', 'All products'], ['/products/linen-shirt', 'Linen Shirt']]) {
      const response = await fetch(base + path, { signal: AbortSignal.timeout(10000) });
      assert.equal(response.status, 200);
      assert.match(await response.text(), new RegExp(`<h1[^>]*>${heading}</h1>`));
    }
    const debugPort = await port();
    browser = start(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost', `--user-data-dir=${join(dir, 'profile')}`, `--remote-debugging-port=${debugPort}`, 'about:blank']);
    const targets = await waitFor(async () => {
      if (browser.child.exitCode !== null || browser.child.signalCode !== null) throw new Error(`Chrome exited: ${browser.output()}`);
      try { return await (await fetch(`http://127.0.0.1:${debugPort}/json`, { signal: AbortSignal.timeout(1000) })).json(); } catch { return null; }
    }, 'Chrome DevTools');
    const target = targets.find(item => item.type === 'page');
    assert.ok(target?.webSocketDebuggerUrl, 'Chrome page target');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await once(socket, 'open');
    const cdp = new CDP(socket);
    const errors = [];
    const blocked = [];
    cdp.on('Runtime.consoleAPICalled', event => {
      if (event.type === 'error' || event.type === 'warning') errors.push(event.args.map(arg => arg.value ?? arg.description ?? '').join(' '));
    });
    cdp.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.text + ' ' + (event.exceptionDetails.exception?.description ?? '')));
    cdp.on('Fetch.requestPaused', event => {
      const url = new URL(event.request.url);
      const local = url.hostname === '127.0.0.1' && url.port === new URL(base).port;
      if (!local) blocked.push(event.request.url);
      cdp.send(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', local ? { requestId: event.requestId } : { requestId: event.requestId, errorReason: 'BlockedByClient' }).catch(error => errors.push(String(error)));
    });
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    const wait = (expression, label) => waitFor(() => cdp.evaluate(expression), label, 20000);
    const navigate = async path => {
      await cdp.evaluate('window.__browserTestPreviousDocument = true');
      await cdp.send('Page.navigate', { url: base + path });
      await wait(`!window.__browserTestPreviousDocument && location.pathname === ${JSON.stringify(path.split('?')[0])} && document.readyState === 'complete'`, path);
    };
    const viewport = async width => {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      assert.equal(await cdp.evaluate('document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth'), true, `horizontal overflow at ${width}px`);
    };
    await navigate('/products');
    await wait("document.querySelector('app-product-card h3')?.textContent.includes('Linen Shirt')", 'listing');
    await wait("document.querySelector('app-product-card .image-fallback')", 'offline listing image fallback');
    await viewport(375);
    await viewport(1440);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    assert.equal(await cdp.evaluate("document.activeElement?.classList.contains('skip-link')"), true, 'keyboard Tab focuses skip link');
    await cdp.evaluate("document.querySelector('#catalog-search').value = 'linen'; document.querySelector('.search').requestSubmit()");
    await wait("location.search.includes('keyword=linen') && document.querySelectorAll('app-product-card').length === 1 && document.querySelector('app-product-card h3')?.textContent.includes('Linen Shirt')", 'hydrated search');
    await cdp.evaluate("document.querySelector('app-product-card a').click()");
    await wait("location.pathname === '/products/linen-shirt' && document.querySelector('app-product-detail h1')?.textContent === 'Linen Shirt'", 'client navigation');
    // Also load detail directly so this page's server HTML is hydrated independently.
    await navigate('/products/linen-shirt');
    await wait("document.querySelector('app-product-detail .placeholder')?.textContent.includes('Image unavailable')", 'offline detail image fallback');
    await viewport(375);
    await viewport(1440);
    await cdp.evaluate("[...document.querySelectorAll('.variants button')].find(b => b.textContent.trim() === 'Medium').click()");
    await wait("[...document.querySelectorAll('.variants button')].find(b => b.textContent.trim() === 'Medium')?.getAttribute('aria-pressed') === 'true'", 'hydrated detail variant');
    assert.ok(blocked.some(url => url.includes('synthetic-browser.jpg')), 'synthetic external image was blocked');
    assert.deepEqual(errors.filter(error => /hydrat|NG05\d\d/i.test(error)), [], `hydration errors: ${errors.join('\n')}`);
  } finally {
    socket?.close();
    if (browser) await stop(browser);
    if (worker) await stop(worker);
    await rm(dir, { recursive: true, force: true });
  }
});
