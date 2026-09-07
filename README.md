# Paper Review Audit

一个可复用的论文技术审读 skill，以及读取同一 `report.json` 的只读工作台。它把论文主张、精确来源、验证过程、反证检查和影响判断连成可校验的证据链。

## 已交付

- `SKILL.md`：skill 入口和完成门槛；详细流程在 `references/`。
- `schemas/report.schema.json`：`1.0.0` 唯一数据契约；`scripts/validate-report.mjs` 同时检查 JSON Schema、全局 ID、跨对象引用和确认问题的证据门槛。
- `scripts/render-report.mjs`：从 JSON 生成可独立阅读的 Markdown。
- `scripts/extract-method-parameters.mjs`：从 Methods 纯文本全量提取带单位参数，减少厚度、温度、时间、浓度、剂量和阈值的漏检。
- `frontend/`：React/Vite 最终用户页面，按问题逐条展示；问题展开后显示证据、原文截图、定位、影响与建议。
- `scripts/server.mjs`：同源静态服务与报告 API，支持报告及证据图片的带令牌上传；相同 report_id/revision 或同名图片不覆盖。
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
REPORT_UPLOAD_TOKEN='请换成长随机值' npm run serve
```

打开 `http://localhost:8787`。读取报告无需令牌；服务器上传只有在配置 `REPORT_UPLOAD_TOKEN` 后才启用。浏览器中的令牌只保存在当前组件状态，不写 localStorage。

## 服务器部署与上传展示

### Docker（推荐）

```bash
export REPORT_UPLOAD_TOKEN='请使用密码管理器生成的长随机值'
docker compose up -d --build
```

持久化报告存放在 Docker volume `paper-review-data`。公开服务器前应在反向代理上启用 HTTPS、访问控制、请求速率限制和备份。此最小服务公开 GET 报告内容，因此不要把非公开稿件放在公开实例。

审查执行器生成并验证报告后，可上传：

```bash
curl --fail-with-body \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${REPORT_UPLOAD_TOKEN}" \
  --data-binary @reports/example/report.json \
  https://your-host.example/api/reports
```

如 evidence 对象包含 `image_path`，在报告上传成功后上传对应证据截图：

```bash
curl --fail-with-body \
  -H 'Content-Type: image/png' \
  -H "Authorization: Bearer ${REPORT_UPLOAD_TOKEN}" \
  --data-binary @evidence-page.png \
  https://your-host.example/api/reports/REPORT_ID/REVISION/assets/evidence-page.png
```

页面自动读取并展示服务器中最新的报告版本。服务端再次运行同一 schema 与引用校验；损坏报告返回 422，同一 report/revision 或同名证据图片返回 409。新修订应递增 `meta.report_revision` 并记录 `revision_reason`。

如果只部署静态前端，可将 `frontend/dist/` 放到任意静态服务器；本地导入仍完整可用，但没有 `/api/reports` 就不能远程列出或上传报告。

## 从审查到展示

```bash
node scripts/validate-report.mjs /path/to/run/report.json
node scripts/render-report.mjs /path/to/run/report.json /path/to/run/report.md
```

然后在页面导入 `report.json`，或通过上述 API 上传。服务器有报告时，页面自动打开最新版本，并以精简的问题—证据列表呈现。

## 安全与边界

- 报告文本按纯文本渲染，不注入 HTML，也不执行脚本；外链只允许 HTTP(S)。
- artifact 路径与 evidence `image_path` 只允许受控相对路径；证据图片接口只接受 PNG、JPEG 或 WebP。
- JSON API 默认最大 10 MiB，可用 `REPORT_MAX_BYTES` 调整；数据目录用 `REPORT_DATA_DIR` 指定。
- 格式/引用校验通过不代表科研结论已验证。页面没有真实性分数、假任务按钮或模拟后台进度。

## 当前边界

服务器上传结构化审查结果 JSON 和裁切后的证据图片。大体积 PDF、源数据和代码仍应通过受控存储提供；服务不会自动解压材料包或执行附件代码。参数提取脚本只生成待审候选，不能替代领域判断、原版页面核对或实验记录。
