export const SUPPORTED_SCHEMA_VERSIONS = ['1.0.0'];

export const LABELS = {
  check: { pass: '通过', fail: '未通过', blocked: '被阻塞', not_run: '未执行', not_applicable: '不适用' },
  issue: { confirmed: '已确认', conditional: '条件性问题', needs_clarification: '待澄清', ruled_out: '已排除', resolved: '已解决' },
  strength: { high: '高', medium: '中', low: '低', undetermined: '未确定' },
  impact: { reporting: '报告/标注', local_result: '局部结果', key_claim: '关键结论', unknown: '未知' },
  execution: { partial: '部分完成', completed: '已完成', failed: '失败', cancelled: '已取消' }
};

const groups = {
  paper: ['papers', 'paper_id'], material: ['materials', 'material_id'], claim: ['claims', 'claim_id'],
  evidence: ['evidence', 'evidence_id'], check: ['checks', 'check_id'], issue: ['issues', 'issue_id'],
  analysis: ['analyses', 'analysis_id'], artifact: ['artifacts', 'artifact_id']
};

export function validateRelations(report) {
  const errors = [];
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(report?.meta?.schema_version)) {
    errors.push({ path: '/meta/schema_version', message: `不支持的版本 ${report?.meta?.schema_version ?? '(缺失)'}；当前支持 ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}` });
  }
  const maps = {};
  const allIds = new Map();
  for (const [kind, [listName, idField]] of Object.entries(groups)) {
    maps[kind] = new Map();
    for (const [index, item] of (report?.[listName] ?? []).entries()) {
      const id = item?.[idField];
      if (!id) continue;
      if (allIds.has(id)) errors.push({ path: `/${listName}/${index}/${idField}`, message: `ID ${id} 与 ${allIds.get(id)} 重复；报告内所有实体 ID 必须唯一` });
      else allIds.set(id, `/${listName}/${index}/${idField}`);
      maps[kind].set(id, item);
    }
  }
  const ref = (kind, id, path, nullable = false) => {
    if ((id === null || id === undefined) && nullable) return;
    if (!maps[kind]?.has(id)) errors.push({ path, message: `引用 ${id ?? '(缺失)'} 不存在于 ${groups[kind]?.[0] ?? kind}` });
  };
  const refs = (kind, ids, path) => (ids ?? []).forEach((id, i) => ref(kind, id, `${path}/${i}`));

  for (const [i, p] of (report?.papers ?? []).entries()) for (const [j, r] of (p.version_relations ?? []).entries()) ref('paper', r.paper_id, `/papers/${i}/version_relations/${j}/paper_id`);
  for (const [i, m] of (report?.materials ?? []).entries()) ref('paper', m.paper_id, `/materials/${i}/paper_id`);
  for (const [i, c] of (report?.claims ?? []).entries()) {
    ref('paper', c.paper_id, `/claims/${i}/paper_id`); refs('evidence', c.supporting_evidence_ids, `/claims/${i}/supporting_evidence_ids`); refs('evidence', c.contradicting_evidence_ids, `/claims/${i}/contradicting_evidence_ids`);
  }
  for (const [i, e] of (report?.evidence ?? []).entries()) {
    ref('material', e.material_id, `/evidence/${i}/material_id`); ref('analysis', e.analysis_id, `/evidence/${i}/analysis_id`, true);
    if (e.run_id !== report?.meta?.run_id) errors.push({ path: `/evidence/${i}/run_id`, message: `run_id ${e.run_id} 与报告 meta.run_id 不一致` });
  }
  for (const [i, c] of (report?.checks ?? []).entries()) {
    ref('paper', c.paper_id, `/checks/${i}/paper_id`); refs('claim', c.claim_ids, `/checks/${i}/claim_ids`); refs('evidence', c.input_evidence_ids, `/checks/${i}/input_evidence_ids`);
  }
  for (const [i, issue] of (report?.issues ?? []).entries()) {
    refs('claim', issue.claim_ids, `/issues/${i}/claim_ids`); refs('evidence', issue.evidence_ids, `/issues/${i}/evidence_ids`); refs('check', issue.check_ids, `/issues/${i}/check_ids`); refs('analysis', issue.analysis_ids, `/issues/${i}/analysis_ids`);
    if (issue.status === 'confirmed') {
      const hasDirectEvidence = (issue.evidence_ids ?? []).some(id => maps.evidence.get(id)?.directly_verified);
      const hasExecutedVerification = (issue.check_ids ?? []).some(id => ['pass', 'fail'].includes(maps.check.get(id)?.status) && maps.check.get(id)?.execution_records?.length) || (issue.analysis_ids ?? []).some(id => maps.analysis.get(id)?.status === 'executed');
      if (!issue.direct_source_read || !hasDirectEvidence) errors.push({ path: `/issues/${i}`, message: 'confirmed 问题必须关联本次直接核验的定位证据，并将 direct_source_read 设为 true' });
      if (!hasExecutedVerification) errors.push({ path: `/issues/${i}`, message: 'confirmed 问题必须关联带实际执行记录的检查或分析' });
    }
  }
  for (const [i, a] of (report?.analyses ?? []).entries()) refs('evidence', a.input_evidence_ids, `/analyses/${i}/input_evidence_ids`);
  const summaryFields = ['scientific_question', 'methods'];
  for (const field of summaryFields) validateLinked(report?.summary?.[field], `/summary/${field}`, refs);
  for (const field of ['contributions', 'strengths', 'main_conclusions', 'limitations', 'recommendations', 'research_implications']) {
    (report?.summary?.[field] ?? []).forEach((entry, i) => validateLinked(entry, `/summary/${field}/${i}`, refs));
  }
  for (const [i, a] of (report?.artifacts ?? []).entries()) { refs('material', a.material_ids, `/artifacts/${i}/material_ids`); refs('analysis', a.analysis_ids, `/artifacts/${i}/analysis_ids`); }
  return errors;
}

function validateLinked(entry, path, refs) {
  if (!entry) return;
  refs('claim', entry.claim_ids, `${path}/claim_ids`); refs('evidence', entry.evidence_ids, `${path}/evidence_ids`);
}

export function deriveStats(report) {
  const checkCounts = Object.fromEntries(Object.keys(LABELS.check).map(k => [k, 0]));
  const issueCounts = Object.fromEntries(Object.keys(LABELS.issue).map(k => [k, 0]));
  for (const c of report.checks ?? []) if (c.status in checkCounts) checkCounts[c.status] += 1;
  for (const i of report.issues ?? []) if (i.status in issueCounts) issueCounts[i.status] += 1;
  const denominator = checkCounts.pass + checkCounts.fail + checkCounts.blocked + checkCounts.not_run;
  const coverage = report.scope?.checklist_defined && denominator > 0 ? (checkCounts.pass + checkCounts.fail) / denominator : null;
  return {
    checkCounts, issueCounts, coverage,
    currentIssueCount: issueCounts.confirmed + issueCounts.conditional + issueCounts.needs_clarification,
    materialCounts: {
      total: report.materials?.length ?? 0,
      obtained: (report.materials ?? []).filter(m => m.access_status === 'obtained').length,
      textRead: (report.materials ?? []).filter(m => m.text_read).length,
      imagesViewed: (report.materials ?? []).filter(m => m.images_viewed).length
    }
  };
}

export function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function isSafeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.includes('\0')) return false;
  return !value.split(/[\\/]/).includes('..');
}

const text = value => value == null ? '—' : String(value);
const bullets = entries => entries?.length ? entries.map(v => `- ${typeof v === 'string' ? v : v.text}`).join('\n') : '- 无';
const ids = values => values?.length ? values.map(v => `\`${v}\``).join('、') : '—';

export function renderMarkdown(report) {
  const s = deriveStats(report);
  const demo = report.meta.data_origin === 'synthetic_demo' ? '> **演示数据：** 本报告使用匿名合成材料，不代表真实论文审查。\n\n' : '';
  const coverage = s.coverage == null ? '未定义' : `${Math.round(s.coverage * 100)}%`;
  const claims = report.claims.map(c => `### ${c.claim_id} · ${c.statement}\n\n- 类型：${c.claim_type}\n- 评价：${c.assessment}\n- 支撑证据：${ids(c.supporting_evidence_ids)}\n- 反驳证据：${ids(c.contradicting_evidence_ids)}\n- 边界：${c.boundaries.join('；') || '—'}`).join('\n\n');
  const issues = report.issues.length ? report.issues.map(i => `### ${i.issue_id} · ${i.title}\n\n- 状态：${LABELS.issue[i.status]}（${i.status_reason}）\n- 证据强度：${LABELS.strength[i.evidence_strength]}（${i.evidence_strength_reason}）\n- 影响范围：${LABELS.impact[i.impact_scope]}（${i.impact_reason}）\n- 关联：主张 ${ids(i.claim_ids)}；证据 ${ids(i.evidence_ids)}；检查 ${ids(i.check_ids)}；分析 ${ids(i.analysis_ids)}\n- 作者表述：${i.author_statement}\n- 本次观察：${i.observation}\n- 反证检查：${i.alternative_explanations.map(a => `${a.explanation} → ${a.outcome}：${a.reason}`).join('；') || '—'}\n- 可证伪条件：${i.falsification_condition}\n- 最小修正：${i.recommended_action}`).join('\n\n') : '本次没有问题条目；这不等同于整篇论文真实性认证。';
  const checks = report.checks.map(c => `- **${c.check_id} · ${LABELS.check[c.status]}**：${c.check_type}。${text(c.result ?? c.blocked_reason ?? c.not_applicable_reason)}`).join('\n') || '- 未建立检查条目';
  const analyses = report.analyses.map(a => `- **${a.analysis_id} · ${a.analysis_type}**：${a.status} / ${a.result_kind}${a.bound_type !== 'none' ? ` / ${a.bound_type} bound` : ''}。发表值：${a.published_values.map(v => `${v.label}=${text(v.value)} ${text(v.unit)}`).join('；') || '—'}；复算值：${a.recalculated_values.map(v => `${v.label}=${text(v.value)} ${text(v.unit)}`).join('；') || '—'}`).join('\n') || '- 未执行分析';
  return `# ${report.meta.title}\n\n${demo}- 报告：${report.meta.report_id} · revision ${report.meta.report_revision}\n- 生成：${report.meta.generated_at}\n- 审查状态：${LABELS.execution[report.meta.execution_status]}\n- 数据来源：${report.meta.data_origin}\n- 选定检查执行比例：${coverage}（仅表示本次清单，不表示论文可靠性）\n\n## 1. 审查范围、材料版本与完成度\n\n${report.scope.objective}\n\n**限制**\n\n${bullets(report.scope.limitations)}\n\n材料共 ${s.materialCounts.total} 项；取得 ${s.materialCounts.obtained}，读文 ${s.materialCounts.textRead}，读图 ${s.materialCounts.imagesViewed}。\n\n## 2. 论文问题、方法、贡献和关键优势\n\n### 科学问题\n\n${report.summary.scientific_question.text}\n\n### 方法\n\n${report.summary.methods.text}\n\n### 贡献\n\n${bullets(report.summary.contributions)}\n\n### 优势\n\n${bullets(report.summary.strengths)}\n\n## 3. 核心主张—证据对应表\n\n${claims || '暂无主张条目'}\n\n## 4. 已完成的检查\n\n${checks}\n\n## 5–6. 问题证据卡\n\n${issues}\n\n## 7. 已排除或已解决的疑点\n\n${bullets(report.issues.filter(i => ['ruled_out', 'resolved'].includes(i.status)).map(i => `${i.issue_id}：${i.title}——${i.status_reason}`))}\n\n## 8. 敏感性分析与解释边界\n\n${analyses}\n\n## 9. 未完成检查与所需材料\n\n${bullets(report.checks.filter(c => ['blocked', 'not_run'].includes(c.status)).map(c => `${c.check_id}：${c.blocked_reason ?? '未执行'}`))}\n\n## 10. 综合评价\n\n${bullets(report.summary.main_conclusions)}\n\n### 局限\n\n${bullets(report.summary.limitations)}\n\n### 最小修正建议\n\n${bullets(report.summary.recommendations)}\n\n### 研究启示\n\n${bullets(report.summary.research_implications)}\n`;
}
