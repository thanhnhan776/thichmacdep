import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

function wrangler(args) {
  return spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], {
    cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
}

async function runWorker(config) {
  const persist = await mkdtemp(join(tmpdir(), 'sync-d1-'));
  let worker;
  try {
    const migration = wrangler(['d1', 'migrations', 'apply', 'DB', '--local', '--config', config, '--persist-to', persist]);
    let output = '';
    for (const stream of [migration.stdout, migration.stderr]) stream.on('data', (chunk) => { output += chunk; });
    const [code] = await once(migration, 'exit');
    assert.equal(code, 0, output);
    const server = createServer().listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    worker = wrangler(['dev', '--local', '--config', config, '--persist-to', persist, '--ip', '127.0.0.1', '--port', String(port)]);
    output = '';
    for (const stream of [worker.stdout, worker.stderr]) stream.on('data', (chunk) => { output += chunk; });
    const deadline = Date.now() + 30000;
    while (!/ready on/i.test(output) && Date.now() < deadline && worker.exitCode === null) await delay(200);
    assert.match(output, /ready on/i);
    const response = await fetch(`http://127.0.0.1:${port}/`);
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.deepEqual(result, { ok: true });
  } finally {
    if (worker && worker.exitCode === null) {
      const exited = once(worker, 'exit');
      process.kill(-worker.pid, 'SIGTERM');
      await exited;
    }
    await rm(persist, { recursive: true, force: true });
  }
}

test('repository writes are stable and isolated in local D1', { timeout: 120000 }, () => runWorker('tests/wrangler.sync.jsonc'));
test('initial sync is replayable and reports failures in local D1', { timeout: 120000 }, () => runWorker('tests/wrangler.sync-service.jsonc'));
test('admin authentication rejects invalid tokens and enforces session lifecycle', { timeout: 120000 }, () => runWorker('tests/wrangler.admin-auth.jsonc'));
test('XLSX input groups variants and binds validation to its digest', { timeout: 120000 }, () => runWorker('tests/wrangler.xlsx-input.jsonc'));
test('XLSX import preserves identities and catalog settings in local D1', { timeout: 120000 }, () => runWorker('tests/wrangler.xlsx-import.jsonc'));
