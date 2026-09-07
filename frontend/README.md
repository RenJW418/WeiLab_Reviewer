# 论文核查报告前端

页面只展示经校验的 `report.json`，不会在浏览器内改写科研判断。姓名密码登录后，报告与证据图片会保存到服务器的当前账号下。

- 开发：仓库根目录 `npm run dev`
- 构建：`npm run build`，产物为 `frontend/dist/`
- 仅静态预览：`npm run preview`
- 同源登录、上传和展示：先构建，再在根目录运行 `npm run serve`

Vite 开发服务器会把 `/api` 代理到 `http://localhost:8787`。测试用 `npm test`。
