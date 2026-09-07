import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitUntilReady(origin, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`测试服务器提前退出：${child.exitCode}`);
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
    } catch { /* Server is still starting. */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('测试服务器启动超时');
}

async function jsonRequest(origin, path, { method = 'GET', cookie, body } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { response, body: await response.json() };
}

async function run() {
  const dataDir = await mkdtemp(join(tmpdir(), 'paper-review-auth-'));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['scripts/server.mjs'], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', REPORT_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverOutput = '';
  child.stdout.on('data', chunk => { serverOutput += chunk; });
  child.stderr.on('data', chunk => { serverOutput += chunk; });
  try {
    try { await waitUntilReady(origin, child); }
    catch (error) { throw new Error(`${error.message}\n${serverOutput}`); }

    const anonymous = await jsonRequest(origin, '/api/reports');
    assert.equal(anonymous.response.status, 401);

    const aliceRegistration = await jsonRequest(origin, '/api/auth/register', { method: 'POST', body: { name: 'Alice', password: 'alice-password' } });
    assert.equal(aliceRegistration.response.status, 201);
    const aliceCookie = aliceRegistration.response.headers.get('set-cookie').split(';', 1)[0];

    const duplicate = await jsonRequest(origin, '/api/auth/register', { method: 'POST', body: { name: ' alice ', password: 'different-password' } });
    assert.equal(duplicate.response.status, 409);

    const bobRegistration = await jsonRequest(origin, '/api/auth/register', { method: 'POST', body: { name: 'Bob', password: 'bob-password' } });
    assert.equal(bobRegistration.response.status, 201);
    const bobCookie = bobRegistration.response.headers.get('set-cookie').split(';', 1)[0];

    const report = JSON.parse(await readFile(join(projectRoot, 'reports/example/report.json'), 'utf8'));
    const upload = await jsonRequest(origin, '/api/reports', { method: 'POST', cookie: aliceCookie, body: report });
    assert.equal(upload.response.status, 201);

    const aliceReports = await jsonRequest(origin, '/api/reports', { cookie: aliceCookie });
    assert.equal(aliceReports.response.status, 200);
    assert.equal(aliceReports.body.reports.length, 1);

    const bobReports = await jsonRequest(origin, '/api/reports', { cookie: bobCookie });
    assert.equal(bobReports.response.status, 200);
    assert.equal(bobReports.body.reports.length, 0);

    const reportPath = `/api/reports/${encodeURIComponent(report.meta.report_id)}/${report.meta.report_revision}`;
    assert.equal((await jsonRequest(origin, reportPath, { cookie: bobCookie })).response.status, 404);
    assert.equal((await jsonRequest(origin, reportPath, { cookie: aliceCookie })).response.status, 200);

    assert.equal((await jsonRequest(origin, '/api/auth/login', { method: 'POST', body: { name: 'Alice', password: 'wrong-password' } })).response.status, 401);
    assert.equal((await jsonRequest(origin, '/api/auth/login', { method: 'POST', body: { name: 'Alice', password: 'alice-password' } })).response.status, 200);

    assert.equal((await jsonRequest(origin, '/api/auth/logout', { method: 'POST', cookie: aliceCookie })).response.status, 200);
    assert.equal((await jsonRequest(origin, '/api/reports', { cookie: aliceCookie })).response.status, 401);
    console.log('服务端认证与账号数据隔离测试通过');
  } finally {
    child.kill('SIGTERM');
    if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
}

await run();
