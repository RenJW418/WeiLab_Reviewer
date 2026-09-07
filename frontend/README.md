# Evidence Desk 前端

工作台只展示和筛选经校验的 `report.json`，不会在浏览器内改写科研判断。

- 开发：仓库根目录 `npm run dev`
- 构建：`npm run build`，产物为 `frontend/dist/`
- 仅静态预览：`npm run preview`
- 同源上传/展示：先构建，再在根目录运行 `REPORT_UPLOAD_TOKEN=... npm run serve`

Vite 开发服务器会把 `/api` 代理到 `http://localhost:8787`。测试用 `npm test`。
