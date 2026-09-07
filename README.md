# Paper Review Audit

一个可复用的论文技术审读 skill，以及读取同一 `report.json` 的只读工作台。它把论文主张、精确来源、验证过程、反证检查和影响判断连成可校验的证据链。

## 已交付

- `SKILL.md`：skill 入口和完成门槛；详细流程在 `references/`。
- `schemas/report.schema.json`：`1.0.0` 唯一数据契约；`scripts/validate-report.mjs` 同时检查 JSON Schema、全局 ID、跨对象引用和确认问题的证据门槛。
- `scripts/render-report.mjs`：从 JSON 生成可独立阅读的 Markdown。
- `scripts/extract-method-parameters.mjs`：从 Methods 纯文本全量提取带单位参数，减少厚度、温度、时间、浓度、剂量和阈值的漏检。
- `frontend/`：React/Vite 最终用户页面，按问题逐条展示；问题展开后显示证据、原文截图、定位、影响与建议。
- `scripts/server.mjs`：同源静态服务、姓名密码认证和报告 API；每个账号的报告及证据图片独立持久化，相同 report_id/revision 或同名图片不覆盖。
- `reports/example/`：持续标记为 `synthetic_demo` 的匿名合成报告。
- `tests/`：契约、引用、统计、安全路径和关键界面交互测试，以及 A–U 行为验收设计。

## 本地运行

需要 Node.js 20+。

```bash
npm install
npm run validate
npm run render
npm test
npm run dev
```

开发地址为 `http://localhost:5173`。要验证完整服务器模式：

```bash
npm run build
npm run serve
```

打开 `http://localhost:8787`，先用姓名和至少 8 位密码创建账号。登录会话保存在 HttpOnly、SameSite=Lax Cookie 中，密码使用随机盐和 scrypt 哈希保存，不以明文落盘。登录后只能列出、读取和上传当前账号自己的报告。

## 服务器部署与上传展示

### Docker（推荐）

```bash
docker compose up -d --build
```

页面开放在 `http://服务器地址:3000`，账号、会话、报告与证据图片均存放在 Docker volume `paper-review-data`。所有报告接口都要求登录，并按账号隔离。

公开服务器应在反向代理上启用 HTTPS、登录速率限制和数据备份；启用 HTTPS 后同时设置 `COOKIE_SECURE=1`。在仅有 HTTP 的 IP 地址上，密码传输不加密，请勿使用其他服务的复用密码。

浏览器中可以将 `report.json` 与它引用的证据图片一起多选导入。若通过 API 上传，先注册或登录并保存 Cookie：

```bash
curl -c session.cookie -H 'Content-Type: application/json' \
  --data '{"name":"姓名","password":"至少八位密码"}' \
  http://your-host:3000/api/auth/register

curl --fail-with-body -b session.cookie -H 'Content-Type: application/json' \
  --data-binary @reports/example/report.json \
  http://your-host:3000/api/reports
```

如 evidence 对象包含 `image_path`，在报告上传成功后上传对应证据截图：

```bash
curl --fail-with-body \
  -b session.cookie \
  -H 'Content-Type: image/png' \
  --data-binary @evidence-page.png \
  http://your-host:3000/api/reports/REPORT_ID/REVISION/assets/evidence-page.png
```

页面登录后自动读取并展示当前账号最新的报告版本。服务端再次运行同一 schema 与引用校验；损坏报告返回 422，同一 report/revision 或同名证据图片返回 409。新修订应递增 `meta.report_revision` 并记录 `revision_reason`。

登录、保存和账号隔离依赖同源 Node 服务，因此不能只部署 `frontend/dist/` 静态文件。

## 从审查到展示

```bash
node scripts/validate-report.mjs /path/to/run/report.json
node scripts/render-report.mjs /path/to/run/report.json /path/to/run/report.md
```

然后在页面导入 `report.json`，或通过上述 API 上传。服务器有报告时，页面自动打开最新版本，并以精简的问题—证据列表呈现。

## 安全与边界

- 报告文本按纯文本渲染，不注入 HTML，也不执行脚本；外链只允许 HTTP(S)。
- artifact 路径与 evidence `image_path` 只允许受控相对路径；证据图片接口只接受 PNG、JPEG 或 WebP。
- JSON API 默认最大 10 MiB，可用 `REPORT_MAX_BYTES` 调整；数据目录用 `REPORT_DATA_DIR` 指定，会话时长用 `SESSION_MAX_AGE_SECONDS` 调整。
- 格式/引用校验通过不代表科研结论已验证。页面没有真实性分数、假任务按钮或模拟后台进度。

## 当前边界

服务器上传结构化审查结果 JSON 和裁切后的证据图片。大体积 PDF、源数据和代码仍应通过受控存储提供；服务不会自动解压材料包或执行附件代码。参数提取脚本只生成待审候选，不能替代领域判断、原版页面核对或实验记录。
