# report.json 数据契约说明

`schemas/report.schema.json` 是 v1 的规范来源，当前仅支持 `schema_version: 1.0.0`。`report.md`、前端统计与导出必须从同一 JSON 派生。

## 默认交付包

默认交付单文件 `review-package.zip`，结构固定为：

```text
review-package.zip
├── report.json
├── report.md
└── evidence/
    └── <image_path>.png
```

- `report.json` 仍是唯一机器契约；ZIP 是传输容器，不替代 JSON Schema。
- 每个非空 `evidence[].image_path` 必须在 ZIP 内存在同名 `evidence/<image_path>`；不允许只有路径没有图片。
- `report.md` 必须从包内同一份 `report.json` 生成，不能单独维护结论。
- 不在 JSON 或 Markdown 中嵌入 base64 图片，以免报告膨胀和重复存储。
- 使用 `scripts/package-report.mjs` 生成并回读校验报告包；缺少任一引用图片时打包失败。

## 对象关系

- `meta`：报告/修订/run 身份、语言、模式、任务状态与 `real | synthetic_demo` 来源。
- `scope`：目标、输入、版本、选定检查、排除、限制，以及检查清单是否已经确定。
- `papers` → `materials` → `evidence` 构成来源链。PDF 页码对外从 1 开始；定位未实际看到时不猜。
- `claims` 引用支撑/反驳 evidence；`checks` 和 `analyses` 记录真实执行；`issues` 将 claim/evidence/check/analysis 串成证据卡。
- `summary` 的事实性段落使用 `linkedText` 关联 claim/evidence。
- `artifacts.path` 只能是受控相对路径，禁止绝对路径、盘符和 `..`。

所有实体 ID 在报告内全局唯一。跨报告引用必须同时携带 report_id；当前 v1 不在单份报告内保存外部实体引用。

## 统计口径

- 检查数从 `checks` 原始对象按 pass/fail/blocked/not_run/not_applicable 计算。
- 问题数从 `issues` 按五个状态计算；“当前发现”只含 confirmed + conditional + needs_clarification。
- 清单执行比例：`(pass + fail) / (pass + fail + blocked + not_run)`；not_applicable 排除。`scope.checklist_defined=false` 或分母为 0 时为未定义。
- 该比例仅指选定检查项，不是可靠性、真实性或全篇复现率。

## 条件与兼容

- confirmed 必须关联本次直接核验证据和带执行记录的 check 或 executed analysis。
- pass/fail 必须有 result 与 execution_records；blocked 和 not_applicable 必须说明原因；resolved 必须写解决版本。
- 未知数值使用 null，不能用 0 代替。
- 补充可选字段且旧读取器可安全忽略时提升 minor；修改枚举/语义或必填字段提升 major。读取器遇到不支持版本必须拒绝正式展示，不做静默迁移。
- 修订保留相同 report_id、递增 report_revision、写 revision_reason；服务器拒绝覆盖同一 revision。
