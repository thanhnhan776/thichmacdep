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
    const url = `http://127.0.0.1:${port}/products/sample`;
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
