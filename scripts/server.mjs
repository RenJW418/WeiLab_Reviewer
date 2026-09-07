#!/usr/bin/env node
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { validateReport } from './validation.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'frontend', 'dist');
const dataDir = resolve(process.env.REPORT_DATA_DIR || join(root, 'server-data', 'reports'));
const port = Number(process.env.PORT || 8787);
const uploadToken = process.env.REPORT_UPLOAD_TOKEN || '';
const maxBodyBytes = Number(process.env.REPORT_MAX_BYTES || 10 * 1024 * 1024);
await mkdir(dataDir, { recursive: true });

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const sendJson = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const keyFor = report => `${report.meta.report_id}--r${report.meta.report_revision}.json`;
const validKey = value => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);

async function readBody(req) {
  return (await readBinaryBody(req)).toString('utf8');
}

async function readBinaryBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) { const e = new Error(`上传超过 ${maxBodyBytes} 字节限制`); e.status = 413; throw e; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function listReports() {
  const files = (await readdir(dataDir)).filter(name => name.endsWith('.json'));
  const reports = [];
  for (const file of files) {
    try {
      const report = JSON.parse(await readFile(join(dataDir, file), 'utf8'));
      const result = validateReport(report);
      if (result.valid) reports.push({ report_id: report.meta.report_id, report_revision: report.meta.report_revision, title: report.meta.title, generated_at: report.meta.generated_at, execution_status: report.meta.execution_status, data_origin: report.meta.data_origin, papers: report.papers.map(p => ({ paper_id: p.paper_id, title: p.title, version: p.version })) });
    } catch { /* invalid server files are not advertised */ }
  }
  return reports.sort((a, b) => b.generated_at.localeCompare(a.generated_at));
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health') return sendJson(res, 200, { ok: true, uploads_enabled: Boolean(uploadToken) });
  if (req.method === 'GET' && url.pathname === '/api/reports') return sendJson(res, 200, { reports: await listReports() });
  const assetMatch = url.pathname.match(/^\/api\/reports\/([^/]+)\/(\d+)\/assets\/([^/]+)$/);
  if (assetMatch) {
    const reportId = decodeURIComponent(assetMatch[1]); const revision = Number(assetMatch[2]); const assetName = decodeURIComponent(assetMatch[3]);
    const validAssetName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(?:png|jpe?g|webp)$/.test(assetName);
    if (!validKey(reportId) || !Number.isInteger(revision) || revision < 1 || !validAssetName) return sendJson(res, 400, { error: '报告标识、revision 或证据图片名称非法' });
    const assetDir = join(dataDir, 'assets', `${reportId}--r${revision}`); const target = join(assetDir, assetName);
    if (req.method === 'GET') {
      try {
        const info = await stat(target); const type = assetName.endsWith('.png') ? 'image/png' : assetName.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
        res.writeHead(200, { 'content-type': type, 'content-length': info.size, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
        return createReadStream(target).pipe(res);
      } catch (error) { return sendJson(res, error.code === 'ENOENT' ? 404 : 500, { error: error.code === 'ENOENT' ? '证据图片不存在' : '读取证据图片失败' }); }
    }
    if (req.method === 'POST') {
      if (!uploadToken) return sendJson(res, 403, { error: '服务器未启用上传；请配置 REPORT_UPLOAD_TOKEN' });
      if (req.headers.authorization !== `Bearer ${uploadToken}`) return sendJson(res, 401, { error: '上传令牌无效' });
      const contentType = String(req.headers['content-type'] || '').toLowerCase().split(';')[0];
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(contentType)) return sendJson(res, 415, { error: '仅接受 PNG、JPEG 或 WebP 证据图片' });
      try {
        await stat(join(dataDir, `${reportId}--r${revision}.json`)); await mkdir(assetDir, { recursive: true });
        try { await stat(target); return sendJson(res, 409, { error: '同名证据图片已存在，服务器不会静默覆盖' }); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        const temporary = join(assetDir, `.${randomUUID()}.tmp`); await writeFile(temporary, await readBinaryBody(req), { flag: 'wx', mode: 0o600 }); await rename(temporary, target);
        return sendJson(res, 201, { ok: true, report_id: reportId, report_revision: revision, asset: assetName });
      } catch (error) { return sendJson(res, error.code === 'ENOENT' ? 404 : error.status || 500, { error: error.code === 'ENOENT' ? '请先上传对应报告版本' : error.message }); }
    }
  }
  const match = url.pathname.match(/^\/api\/reports\/([^/]+)\/(\d+)$/);
  if (req.method === 'GET' && match) {
    const reportId = decodeURIComponent(match[1]); const revision = Number(match[2]);
    if (!validKey(reportId) || !Number.isInteger(revision) || revision < 1) return sendJson(res, 400, { error: '报告标识或 revision 非法' });
    try { return sendJson(res, 200, JSON.parse(await readFile(join(dataDir, `${reportId}--r${revision}.json`), 'utf8'))); }
    catch (error) { return sendJson(res, error.code === 'ENOENT' ? 404 : 500, { error: error.code === 'ENOENT' ? '报告不存在' : '读取报告失败' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/reports') {
    if (!uploadToken) return sendJson(res, 403, { error: '服务器未启用上传；请配置 REPORT_UPLOAD_TOKEN' });
    if (req.headers.authorization !== `Bearer ${uploadToken}`) return sendJson(res, 401, { error: '上传令牌无效' });
    if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return sendJson(res, 415, { error: '仅接受 application/json' });
    try {
      const report = JSON.parse(await readBody(req));
      const result = validateReport(report);
      if (!result.valid) return sendJson(res, 422, { error: '报告校验失败', details: result.errors });
      const target = join(dataDir, keyFor(report));
      try { await stat(target); return sendJson(res, 409, { error: '相同 report_id 与 revision 已存在；请增加 revision，服务器不会静默覆盖' }); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      const temporary = join(dataDir, `.${randomUUID()}.tmp`);
      await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      await rename(temporary, target);
      return sendJson(res, 201, { ok: true, report_id: report.meta.report_id, report_revision: report.meta.report_revision });
    } catch (error) { return sendJson(res, error.status || (error instanceof SyntaxError ? 400 : 500), { error: error instanceof SyntaxError ? 'JSON 损坏或无法解析' : error.message }); }
  }
  return sendJson(res, 404, { error: '接口不存在' });
}

async function serveStatic(req, res, url) {
  let relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^\/+/, '');
  let file = resolve(dist, relative);
  if (!file.startsWith(`${resolve(dist)}${sep}`)) return sendJson(res, 403, { error: '禁止越界路径' });
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, 'index.html');
  } catch (error) {
    const isNavigationRoute = !extname(relative) && !relative.startsWith('assets/');
    if (error.code === 'ENOENT' && isNavigationRoute) file = join(dist, 'index.html');
    else return sendJson(res, error.code === 'ENOENT' ? 404 : 500, { error: error.code === 'ENOENT' ? '静态资源不存在，请刷新页面获取最新入口' : '读取静态资源失败' });
  }
  try {
    const info = await stat(file);
    const isHtml = extname(file) === '.html';
    res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream', 'content-length': info.size, 'cache-control': isHtml ? 'no-cache, no-store, must-revalidate' : relative.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'" });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
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
server.listen(port, () => console.log(`Evidence Desk: http://localhost:${port}\n报告目录: ${dataDir}\n上传: ${uploadToken ? '已启用' : '未启用（设置 REPORT_UPLOAD_TOKEN）'}`));
