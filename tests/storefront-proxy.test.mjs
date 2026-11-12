import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const storefront = join(root, 'apps/storefront');

async function availablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function start(args, cwd) {
  const child = spawn(process.execPath, args, {
    cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: 'true', NG_CLI_ANALYTICS: 'false', WRANGLER_SEND_METRICS: 'false', BROWSER: 'none' },
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => { output = (output + chunk.toString()).slice(-32000); });
  }
  child.on('error', (error) => { output += `\n${error.stack}`; });
  return { child, output: () => output };
}

async function waitFor(server, pattern, name) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null || server.child.signalCode !== null) {
      throw new Error(`${name} exited before readiness:\n${server.output()}`);
    }
    if (pattern.test(server.output())) return;
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${name}:\n${server.output()}`);
}

async function stop(server) {
  const { child } = server;
  if (!child.pid) return;
  const exited = child.exitCode === null && child.signalCode === null ? once(child, 'exit') : Promise.resolve();
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
  if (!await Promise.race([exited.then(() => true), delay(5000).then(() => false)])) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
    await exited;
  }
}

test('Angular dev server proxies same-origin API health to local Wrangler', { timeout: 120000 }, async () => {
  const tempRoot = join(tmpdir(), 'opencode');
  await mkdir(tempRoot, { recursive: true });
  const dir = await mkdtemp(join(tempRoot, 'storefront-proxy-test-'));
  const servers = [];
  try {
    const apiPort = await availablePort();
    let angularPort = await availablePort();
    while (angularPort === apiPort) angularPort = await availablePort();

    const angularConfig = JSON.parse(await readFile(join(storefront, 'angular.json'), 'utf8'));
    const configuredProxy = angularConfig.projects.storefront.architect.serve.options.proxyConfig;
    assert.equal(configuredProxy, 'proxy.conf.json');
    const proxy = JSON.parse(await readFile(join(storefront, configuredProxy), 'utf8'));
    assert.ok(proxy['/api/**'], 'the storefront proxy must match API paths');
    proxy['/api/**'].target = `http://127.0.0.1:${apiPort}`;
    const proxyPath = join(dir, 'proxy.conf.json');
    await writeFile(proxyPath, JSON.stringify(proxy));

    const api = start([join(root, 'node_modules/wrangler/bin/wrangler.js'), 'dev', '--local', '--ip', '127.0.0.1', '--port', String(apiPort), '--persist-to', join(dir, 'state')], root);
    servers.push(api);
    await waitFor(api, /ready on/i, 'Wrangler');

    const angular = start([join(storefront, 'node_modules/@angular/cli/bin/ng.js'), 'serve', '--host', '127.0.0.1', '--port', String(angularPort), '--proxy-config', proxyPath], storefront);
    servers.push(angular);
    await waitFor(angular, /Local:\s+http:\/\/127\.0\.0\.1:/i, 'Angular dev server');

    const response = await fetch(`http://127.0.0.1:${angularPort}/api/health`, { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  } finally {
    try {
      await Promise.all(servers.map(stop));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});
