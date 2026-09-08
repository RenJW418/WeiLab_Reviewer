# report.json 数据契约说明

`schemas/report.schema.json` 是 v1 的规范来源，当前仅支持 `schema_version: 1.0.0`。`report.md`、前端统计与导出必须从同一 JSON 派生。

## 对话内展示

完整交付不能只有附件。最终回复必须从最终 `report.json` 直接生成问题—证据摘要：

- 展示全部当前问题，即状态为 `confirmed`、`conditional` 或 `needs_clarification` 的 issue，并按该状态顺序排列；同一状态内保持 JSON 原始顺序。
- 每条问题显示状态、标题、`observation`、`status_reason`、`impact_scope`、`impact_reason` 和 `recommended_action`。
- 展开列出该 issue 的全部 `evidence_ids`；每项至少显示 `content`、材料名称或来源，以及页码、图号、表号、章节、行号等已有 locator，不得只写证据 ID。
- evidence 包含 `image_path` 时，在支持本地媒体展示的对话界面直接内嵌 `evidence/<image_path>`；不能内嵌时提供可点击链接。
- 对话摘要与 ZIP、Markdown、前端必须引用同一 JSON 对象，问题数量、状态和证据不得出现分叉。
- 没有当前问题时明确写“当前范围内未发现可报告问题”，同时列出已完成检查、未完成项和材料盲区，不将其表述为论文真实性认证。

对话末尾提供 `review-package.zip` 的可点击链接。已排除和已解决问题可在当前问题之后压缩列示。

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
