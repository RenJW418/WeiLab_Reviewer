import React, { useEffect, useMemo, useRef, useState } from 'react';
import { validateReport } from './lib/validation.js';

const statusLabels = { confirmed: '已确认', needs_clarification: '待澄清', conditional: '条件性问题', ruled_out: '已排除', resolved: '已解决' };
const impactLabels = { reporting: '报告表述', local_result: '局部结果', key_claim: '关键结论', unknown: '影响待定' };
const formatLocator = locator => Object.entries(locator || {}).filter(([, value]) => value != null && value !== '').map(([key, value]) => `${key}: ${value}`).join(' · ');

export default function App() {
  const [report, setReport] = useState(null);
  const [openIssueId, setOpenIssueId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const useReport = next => {
    const result = validateReport(next);
    if (!result.valid) {
      setError(`报告格式校验失败：${result.errors[0]?.path || '/'} ${result.errors[0]?.message || ''}`);
      return false;
    }
    setReport(next);
    setOpenIssueId(null);
    setError('');
    return true;
  };

  useEffect(() => {
    let cancelled = false;
    const loadLatest = async () => {
      try {
        const listResponse = await fetch('/api/reports');
        if (!listResponse.ok) throw new Error(`HTTP ${listResponse.status}`);
        const list = await listResponse.json();
        const latest = list.reports?.[0];
        if (!latest) throw new Error('服务器中还没有报告');
        const reportResponse = await fetch(`/api/reports/${encodeURIComponent(latest.report_id)}/${latest.report_revision}`);
        if (!reportResponse.ok) throw new Error(`HTTP ${reportResponse.status}`);
        const next = await reportResponse.json();
        if (!cancelled) useReport(next);
      } catch (loadError) {
        if (!cancelled) setError(`暂时无法读取报告：${loadError.message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadLatest();
    return () => { cancelled = true; };
  }, []);

  const issues = useMemo(() => report?.issues.filter(issue => !['ruled_out', 'resolved'].includes(issue.status)) ?? [], [report]);
  const evidenceById = useMemo(() => new Map((report?.evidence ?? []).map(item => [item.evidence_id, item])), [report]);
  const materialById = useMemo(() => new Map((report?.materials ?? []).map(item => [item.material_id, item])), [report]);

  const importReport = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { useReport(JSON.parse(await file.text())); }
    catch (importError) { setError(`无法读取文件：${importError.message}`); }
    event.target.value = '';
  };

  return <div className="site-shell">
    <header className="document-nav">
      <div className="nav-inner">
        <a className="wordmark" href="/" aria-label="论文核查报告首页"><span className="wordmark-mark">核</span><span>论文核查报告</span></a>
        <button className="quiet-action" onClick={() => fileRef.current?.click()}>导入报告</button>
        <input ref={fileRef} className="sr-only" aria-label="导入 report.json" type="file" accept="application/json,.json" onChange={importReport} />
      </div>
    </header>

    <main className="page-wrap">
      {loading && <div className="state-card"><span className="loading-dot" />正在读取报告…</div>}
      {!loading && error && !report && <div className="state-card error-state"><strong>报告暂不可用</strong><p>{error}</p><button onClick={() => fileRef.current?.click()}>从本地导入</button></div>}
      {report && <>
        <section className="report-intro">
          <div className="eyebrow">REVIEW REPORT</div>
          <h1>{report.papers[0]?.title || report.meta.title}</h1>
          <p className="report-subtitle">{report.scope.objective}</p>
          <div className="report-meta">
            <span>{report.papers[0]?.publication?.venue || '论文'}</span>
            {report.papers[0]?.doi && <span>DOI {report.papers[0].doi}</span>}
            <span>{issues.length} 条当前问题</span>
            <span>{report.meta.generated_at.slice(0, 10)}</span>
          </div>
          {error && <p className="inline-error">{error}</p>}
        </section>

        <section className="issues-section" aria-labelledby="issues-title">
          <div className="section-heading">
            <div><div className="eyebrow">FINDINGS</div><h2 id="issues-title">发现的问题</h2></div>
            <p>点击任一问题查看对应证据与核查细节</p>
          </div>

          <div className="issue-list">
            {issues.map((issue, index) => {
              const expanded = openIssueId === issue.issue_id;
              const evidence = issue.evidence_ids.map(id => evidenceById.get(id)).filter(Boolean);
              return <article className={`issue-row status-${issue.status}`} key={issue.issue_id}>
                <button className="issue-summary" aria-expanded={expanded} aria-controls={`issue-detail-${issue.issue_id}`} onClick={() => setOpenIssueId(expanded ? null : issue.issue_id)}>
                  <span className="issue-number">{String(index + 1).padStart(2, '0')}</span>
                  <span className="issue-copy">
                    <span className="issue-labels"><span className="status-label"><i />{statusLabels[issue.status] || issue.status}</span><span>{impactLabels[issue.impact_scope] || issue.impact_scope}</span></span>
                    <strong>{issue.title}</strong>
                    <span className="issue-observation">{issue.observation}</span>
                  </span>
                  <span className="expand-icon" aria-hidden="true">{expanded ? '−' : '+'}</span>
                </button>

                {expanded && <div className="issue-detail" id={`issue-detail-${issue.issue_id}`}>
                  <section className="detail-block evidence-block">
                    <h3>对应证据</h3>
                    <div className="evidence-stack">
                      {evidence.map((item, evidenceIndex) => {
                        const material = materialById.get(item.material_id);
                        return <div className="evidence-row" key={item.evidence_id}>
                          <div className="evidence-index">证据 {evidenceIndex + 1}</div>
                          <div>
                            <p>{item.content}</p>
                            <div className="evidence-source"><span>{formatLocator(item.locator)}</span>{material?.file_name && <span>{material.file_name}</span>}</div>
                            {item.image_path && <a className="evidence-image" href={`/api/reports/${encodeURIComponent(report.meta.report_id)}/${report.meta.report_revision}/assets/${encodeURIComponent(item.image_path)}`} target="_blank" rel="noreferrer">
                              <img src={`/api/reports/${encodeURIComponent(report.meta.report_id)}/${report.meta.report_revision}/assets/${encodeURIComponent(item.image_path)}`} alt={`${item.content}的原文截图`} loading="lazy" />
                              <span>查看原图</span>
                            </a>}
                          </div>
                        </div>;
                      })}
                    </div>
                  </section>

                  <div className="detail-grid">
                    <section className="detail-block"><h3>核查结论</h3><p>{issue.status_reason}</p></section>
                    <section className="detail-block"><h3>影响判断</h3><p>{issue.impact_reason}</p></section>
                    <section className="detail-block"><h3>核查方法</h3><p>{issue.verification_method}</p><ul>{issue.verification_steps.map(step => <li key={step}>{step}</li>)}</ul></section>
                    <section className="detail-block recommendation"><h3>建议处理</h3><p>{issue.recommended_action}</p></section>
                  </div>

                  {issue.missing_materials.length > 0 && <section className="missing-note"><strong>仍需材料</strong><span>{issue.missing_materials.join('；')}</span></section>}
                </div>}
              </article>;
            })}
          </div>
          {!issues.length && <div className="state-card">当前报告没有待展示的问题。</div>}
        </section>

        <footer className="report-footer"><span>{report.meta.report_id} · revision {report.meta.report_revision}</span><span>结论以当前已取得材料为限</span></footer>
      </>}
    </main>
  </div>;
}
