#!/usr/bin/env node
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { validateReport } from './validation.mjs';

const scrypt = promisify(scryptCallback);
const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'frontend', 'dist');
const dataRoot = resolve(process.env.REPORT_DATA_DIR || join(root, 'server-data'));
const authRoot = join(dataRoot, 'auth');
const usersDir = join(authRoot, 'users');
const sessionsDir = join(authRoot, 'sessions');
const reportsRoot = join(dataRoot, 'users');
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '0.0.0.0';
const maxBodyBytes = Number(process.env.REPORT_MAX_BYTES || 10 * 1024 * 1024);
const sessionSeconds = Number(process.env.SESSION_MAX_AGE_SECONDS || 7 * 24 * 60 * 60);
const secureCookie = process.env.COOKIE_SECURE === '1';
await Promise.all([mkdir(usersDir, { recursive: true }), mkdir(sessionsDir, { recursive: true }), mkdir(reportsRoot, { recursive: true })]);

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const sendJson = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }); res.end(JSON.stringify(body)); };
const keyFor = report => `${report.meta.report_id}--r${report.meta.report_revision}.json`;
const validKey = value => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const normalizedName = value => String(value || '').normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
const nameKey = value => createHash('sha256').update(normalizedName(value)).digest('hex');
const tokenKey = value => createHash('sha256').update(value).digest('hex');

async function readBinaryBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) { const error = new Error(`请求超过 ${maxBodyBytes} 字节限制`); error.status = 413; throw error; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(req) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) { const error = new Error('仅接受 application/json'); error.status = 415; throw error; }
  return JSON.parse((await readBinaryBody(req)).toString('utf8'));
}

function validateCredentials(name, password) {
  const cleanName = String(name || '').normalize('NFKC').trim();
  if (cleanName.length < 1 || cleanName.length > 60 || /[\u0000-\u001f\u007f]/u.test(cleanName)) return '姓名须为 1–60 个有效字符';
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) return '密码须为 8–128 个字符';
  return null;
}

async function passwordHash(password, saltHex) {
  return Buffer.from(await scrypt(password, Buffer.from(saltHex, 'hex'), 64)).toString('hex');
}

function sessionCookie(token, maxAge = sessionSeconds) {
  return `review_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secureCookie ? '; Secure' : ''}`;
}

function cookieValue(req, name) {
  const entry = String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
}

async function createSession(user) {
  const token = randomBytes(32).toString('base64url');
  const session = { user_id: user.user_id, expires_at: Date.now() + sessionSeconds * 1000 };
  await writeFile(join(sessionsDir, `${tokenKey(token)}.json`), `${JSON.stringify(session)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  return token;
}

async function currentUser(req) {
  const token = cookieValue(req, 'review_session');
  if (!token) return null;
  try {
    const sessionPath = join(sessionsDir, `${tokenKey(token)}.json`);
    const session = JSON.parse(await readFile(sessionPath, 'utf8'));
    if (session.expires_at <= Date.now()) { await unlink(sessionPath).catch(() => {}); return null; }
    const files = await readdir(usersDir);
    for (const file of files) {
      const user = JSON.parse(await readFile(join(usersDir, file), 'utf8'));
      if (user.user_id === session.user_id) return { user_id: user.user_id, name: user.name };
    }
  } catch { return null; }
  return null;
}

const userRoot = user => join(reportsRoot, user.user_id);
const userReportsDir = user => join(userRoot(user), 'reports');
const userAssetsDir = user => join(userRoot(user), 'assets');

async function listReports(user) {
  const directory = userReportsDir(user); await mkdir(directory, { recursive: true });
  const files = (await readdir(directory)).filter(name => name.endsWith('.json'));
  const reports = [];
  for (const file of files) {
    try {
      const report = JSON.parse(await readFile(join(directory, file), 'utf8'));
      const result = validateReport(report);
      if (result.valid) reports.push({ report_id: report.meta.report_id, report_revision: report.meta.report_revision, title: report.meta.title, generated_at: report.meta.generated_at, execution_status: report.meta.execution_status, data_origin: report.meta.data_origin, current_issue_count: report.issues.filter(issue => !['ruled_out', 'resolved'].includes(issue.status)).length, total_issue_count: report.issues.length, evidence_count: report.evidence.length, papers: report.papers.map(paper => ({ paper_id: paper.paper_id, title: paper.title, version: paper.version })) });
    } catch { /* Invalid files are never advertised. */ }
  }
  return reports.sort((a, b) => b.generated_at.localeCompare(a.generated_at));
}

async function handleAuth(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/auth/session') {
    const user = await currentUser(req);
    return sendJson(res, 200, user ? { authenticated: true, user } : { authenticated: false });
  }
  if (req.method === 'POST' && ['/api/auth/register', '/api/auth/login'].includes(url.pathname)) {
    try {
      const { name, password } = await readJsonBody(req); const credentialError = validateCredentials(name, password);
      if (credentialError) return sendJson(res, 400, { error: credentialError });
      const cleanName = String(name).normalize('NFKC').trim(); const file = join(usersDir, `${nameKey(cleanName)}.json`);
      let user;
      if (url.pathname.endsWith('/register')) {
        const salt = randomBytes(16).toString('hex');
        user = { user_id: randomUUID(), name: cleanName, normalized_name: normalizedName(cleanName), salt, password_hash: await passwordHash(password, salt), created_at: new Date().toISOString() };
        try { await writeFile(file, `${JSON.stringify(user)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 }); }
        catch (error) { if (error.code === 'EEXIST') return sendJson(res, 409, { error: '该姓名已注册，请直接登录' }); throw error; }
      } else {
        try { user = JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return sendJson(res, 401, { error: '姓名或密码不正确' }); throw error; }
        const actual = Buffer.from(await passwordHash(password, user.salt), 'hex'); const expected = Buffer.from(user.password_hash, 'hex');
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return sendJson(res, 401, { error: '姓名或密码不正确' });
      }
      const token = await createSession(user);
      return sendJson(res, url.pathname.endsWith('/register') ? 201 : 200, { authenticated: true, user: { user_id: user.user_id, name: user.name } }, { 'set-cookie': sessionCookie(token) });
    } catch (error) { return sendJson(res, error.status || (error instanceof SyntaxError ? 400 : 500), { error: error instanceof SyntaxError ? 'JSON 损坏或无法解析' : error.message }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const token = cookieValue(req, 'review_session'); if (token) await unlink(join(sessionsDir, `${tokenKey(token)}.json`)).catch(() => {});
    return sendJson(res, 200, { ok: true }, { 'set-cookie': sessionCookie('', 0) });
  }
  return false;
}

async function handleApi(req, res, url) {
  if (url.pathname.startsWith('/api/auth/')) { const handled = await handleAuth(req, res, url); if (handled !== false) return; }
  if (req.method === 'GET' && url.pathname === '/api/health') return sendJson(res, 200, { ok: true, authentication: 'required' });
  const user = await currentUser(req);
  if (!user) return sendJson(res, 401, { error: '请先登录' });

  if (req.method === 'GET' && url.pathname === '/api/reports') return sendJson(res, 200, { reports: await listReports(user) });
  const assetMatch = url.pathname.match(/^\/api\/reports\/([^/]+)\/(\d+)\/assets\/([^/]+)$/);
  if (assetMatch) {
    const reportId = decodeURIComponent(assetMatch[1]); const revision = Number(assetMatch[2]); const assetName = decodeURIComponent(assetMatch[3]);
    const validAssetName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(?:png|jpe?g|webp)$/.test(assetName);
    if (!validKey(reportId) || !Number.isInteger(revision) || revision < 1 || !validAssetName) return sendJson(res, 400, { error: '报告标识、revision 或证据图片名称非法' });
    const assetDir = join(userAssetsDir(user), `${reportId}--r${revision}`); const target = join(assetDir, assetName);
    if (['GET', 'HEAD'].includes(req.method)) {
      try {
        const info = await stat(target); const type = mime[extname(assetName)] || 'application/octet-stream';
        res.writeHead(200, { 'content-type': type, 'content-length': info.size, 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' });
        if (req.method === 'HEAD') return res.end();
        return createReadStream(target).pipe(res);
      } catch (error) { return sendJson(res, error.code === 'ENOENT' ? 404 : 500, { error: error.code === 'ENOENT' ? '证据图片不存在' : '读取证据图片失败' }); }
    }
    if (req.method === 'POST') {
      const contentType = String(req.headers['content-type'] || '').toLowerCase().split(';')[0];
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(contentType)) return sendJson(res, 415, { error: '仅接受 PNG、JPEG 或 WebP 证据图片' });
      try {
        await stat(join(userReportsDir(user), `${reportId}--r${revision}.json`)); await mkdir(assetDir, { recursive: true });
        try { await stat(target); return sendJson(res, 409, { error: '同名证据图片已存在，服务器不会静默覆盖' }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        const temporary = join(assetDir, `.${randomUUID()}.tmp`); await writeFile(temporary, await readBinaryBody(req), { flag: 'wx', mode: 0o600 }); await rename(temporary, target);
        return sendJson(res, 201, { ok: true, report_id: reportId, report_revision: revision, asset: assetName });
      } catch (error) { return sendJson(res, error.code === 'ENOENT' ? 404 : error.status || 500, { error: error.code === 'ENOENT' ? '请先上传对应报告版本' : error.message }); }
    }
  }

  const match = url.pathname.match(/^\/api\/reports\/([^/]+)\/(\d+)$/);
  if (req.method === 'GET' && match) {
    const reportId = decodeURIComponent(match[1]); const revision = Number(match[2]);
    if (!validKey(reportId) || !Number.isInteger(revision) || revision < 1) return sendJson(res, 400, { error: '报告标识或 revision 非法' });
    try { return sendJson(res, 200, JSON.parse(await readFile(join(userReportsDir(user), `${reportId}--r${revision}.json`), 'utf8'))); }
    catch (error) { return sendJson(res, error.code === 'ENOENT' ? 404 : 500, { error: error.code === 'ENOENT' ? '报告不存在' : '读取报告失败' }); }
  }

  if (req.method === 'POST' && url.pathname === '/api/reports') {
    try {
      const report = await readJsonBody(req); const result = validateReport(report);
      if (!result.valid) return sendJson(res, 422, { error: '报告校验失败', details: result.errors });
      const directory = userReportsDir(user); await mkdir(directory, { recursive: true }); const target = join(directory, keyFor(report));
      try { await stat(target); return sendJson(res, 409, { error: '相同 report_id 与 revision 已存在；请增加 revision' }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const temporary = join(directory, `.${randomUUID()}.tmp`); await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 }); await rename(temporary, target);
      return sendJson(res, 201, { ok: true, report_id: report.meta.report_id, report_revision: report.meta.report_revision });
    } catch (error) { return sendJson(res, error.status || (error instanceof SyntaxError ? 400 : 500), { error: error instanceof SyntaxError ? 'JSON 损坏或无法解析' : error.message }); }
  }
  return sendJson(res, 404, { error: '接口不存在' });
}

async function serveStatic(req, res, url) {
  const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^\/+/, '');
  let file = resolve(dist, relative);
  if (!file.startsWith(`${resolve(dist)}${sep}`)) return sendJson(res, 403, { error: '禁止越界路径' });
  try { const info = await stat(file); if (info.isDirectory()) file = join(file, 'index.html'); }
  catch (error) {
    const isNavigationRoute = !extname(relative) && !relative.startsWith('assets/');
    if (error.code === 'ENOENT' && isNavigationRoute) file = join(dist, 'index.html');
    else return sendJson(res, error.code === 'ENOENT' ? 404 : 500, { error: error.code === 'ENOENT' ? '静态资源不存在，请刷新页面' : '读取静态资源失败' });
  }
  try {
    const info = await stat(file); const isHtml = extname(file) === '.html';
    res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream', 'content-length': info.size, 'cache-control': isHtml ? 'no-cache, no-store, must-revalidate' : relative.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
    if (req.method === 'HEAD') res.end(); else createReadStream(file).pipe(res);
  } catch { sendJson(res, 503, { error: '前端尚未构建，请先运行 npm run build' }); }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (['GET', 'HEAD'].includes(req.method)) await serveStatic(req, res, url);
    else sendJson(res, 405, { error: '方法不允许' });
  } catch (error) { sendJson(res, 500, { error: '服务器内部错误', detail: error.message }); }
});

server.listen(port, host, () => console.log(`论文核查报告: http://${host}:${port}\n数据目录: ${dataRoot}\n认证: 姓名 + 密码`));
