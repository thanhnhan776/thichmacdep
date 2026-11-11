import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
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

async function withWorker(config, run) {
  const port = await availablePort();
  const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--config', config, '--port', String(port), '--ip', '127.0.0.1'], {
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

test('local D1 and R2 bindings round trip', async () => {
  await withWorker('wrangler.test.jsonc', async (url) => {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { d1: 'ok', r2: 'ok' });
  });
});
