import React, { useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { validateReport } from './lib/validation.js';

const statusLabels = { confirmed: '已确认', needs_clarification: '待澄清', conditional: '条件性问题', ruled_out: '已排除', resolved: '已解决' };
const issueStatusOrder = { confirmed: 0, conditional: 1, needs_clarification: 2 };
const impactLabels = { reporting: '报告表述', local_result: '局部结果', key_claim: '关键结论', unknown: '影响待定' };
const formatLocator = locator => Object.entries(locator || {}).filter(([, value]) => value != null && value !== '').map(([key, value]) => `${key}: ${value}`).join(' · ');
const readTextFile = file => typeof file.text === 'function'
  ? file.text()
  : new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('文件读取失败'));
    reader.readAsText(file);
  });
const readBinaryFile = file => typeof file.arrayBuffer === 'function'
  ? file.arrayBuffer()
  : new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('文件读取失败'));
    reader.readAsArrayBuffer(file);
  });
const imageMime = name => name.toLowerCase().endsWith('.png') ? 'image/png' : name.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg';

export default function App() {
  const [showPrivacyNotice, setShowPrivacyNotice] = useState(true);
  const [user, setUser] = useState(undefined);
  const [authMode, setAuthMode] = useState('login');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [reports, setReports] = useState([]);
  const [report, setReport] = useState(null);
  const [openIssueId, setOpenIssueId] = useState(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileRef = useRef(null);
  const evidenceRef = useRef(null);

  const useReport = next => {
    const result = validateReport(next);
    if (!result.valid) { setError(`报告格式校验失败：${result.errors[0]?.path || '/'} ${result.errors[0]?.message || ''}`); return false; }
    setReport(next); setOpenIssueId(null); setError(''); return true;
  };

  const loadReport = async descriptor => {
    setLoadingReport(true); setNotice('');
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(descriptor.report_id)}/${descriptor.report_revision}`);
      if (response.status === 401) { setUser(null); setReport(null); return; }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      useReport(await response.json());
    } catch (loadError) { setError(`无法读取报告：${loadError.message}`); }
    finally { setLoadingReport(false); }
  };

  const refreshReports = async ({ openLatest = false } = {}) => {
    try {
      const response = await fetch('/api/reports');
      if (response.status === 401) { setUser(null); setReports([]); setReport(null); return; }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json(); setReports(data.reports || []);
      if (openLatest && data.reports?.[0]) await loadReport(data.reports[0]);
    } catch (loadError) { setError(`无法读取报告列表：${loadError.message}`); }
  };

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/session').then(response => response.json()).then(session => {
      if (cancelled) return;
      setUser(session.authenticated ? session.user : null);
    }).catch(() => { if (!cancelled) { setUser(null); setError('暂时无法连接服务器'); } });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { if (user) refreshReports(); }, [user?.user_id]);

  const submitAuth = async event => {
    event.preventDefault(); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/auth/${authMode}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, password }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setUser(body.user); setName(''); setPassword('');
    } catch (authError) { setError(authError.message); }
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null); setReports([]); setReport(null); setOpenIssueId(null); setNotice(''); setError('');
  };

  const uploadEvidenceFiles = async (files, targetReport) => {
    const expectedImages = new Set(targetReport.evidence.map(item => item.image_path).filter(Boolean));
    const matchingFiles = files.filter(file => expectedImages.has(file.name));
    let added = 0;
    let existing = 0;
    let failed = 0;
    for (const file of matchingFiles) {
      const imageResponse = await fetch(`/api/reports/${encodeURIComponent(targetReport.meta.report_id)}/${targetReport.meta.report_revision}/assets/${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'content-type': file.type || 'image/png' }, body: file });
      if (imageResponse.status === 401) { setUser(null); throw new Error('登录已过期，请重新登录'); }
      if (imageResponse.ok) added += 1;
      else if (imageResponse.status === 409) existing += 1;
      else failed += 1;
    }
    return { added, existing, available: added + existing, failed, unmatched: files.length - matchingFiles.length };
  };

  const importReport = async event => {
    const files = [...(event.target.files || [])]; event.target.value = '';
    const zipFile = files.find(file => file.name.toLowerCase().endsWith('.zip'));
    const jsonFile = files.find(file => file.name.toLowerCase().endsWith('.json'));
    if (!zipFile && !jsonFile) return setError('请选择 review-package.zip；也兼容 report.json 与证据图片多选。');
    setUploading(true); setError(''); setNotice('');
    try {
      let next;
      let evidenceFiles;
      if (zipFile) {
        if (zipFile.size > 100 * 1024 * 1024) throw new Error('报告包不能超过 100 MiB');
        const archive = await JSZip.loadAsync(await readBinaryFile(zipFile));
        const reportEntry = archive.file('report.json');
        if (!reportEntry) throw new Error('ZIP 根目录缺少 report.json');
        if (!archive.file('report.md')) throw new Error('ZIP 根目录缺少 report.md');
        const reportText = await reportEntry.async('text');
        if (reportText.length > 10 * 1024 * 1024) throw new Error('report.json 不能超过 10 MiB');
        next = JSON.parse(reportText);
        const expectedNames = [...new Set(next.evidence?.map(item => item.image_path).filter(Boolean) || [])];
        let expandedImageBytes = 0;
        evidenceFiles = (await Promise.all(expectedNames.map(async fileName => {
          const entry = archive.file(`evidence/${fileName}`) || archive.file(fileName);
          if (!entry) return null;
          const image = await entry.async('uint8array');
          expandedImageBytes += image.byteLength;
          if (expandedImageBytes > 100 * 1024 * 1024) throw new Error('解压后的证据图片不能超过 100 MiB');
          return new File([image], fileName, { type: imageMime(fileName) });
        }))).filter(Boolean);
      } else {
        next = JSON.parse(await readTextFile(jsonFile));
        evidenceFiles = files.filter(file => file !== jsonFile);
      }
      if (!useReport(next)) return;
      const validation = validateReport(next); if (!validation.valid) return;
      const expectedImageCount = new Set(next.evidence.map(item => item.image_path).filter(Boolean)).size;
      if (zipFile && evidenceFiles.length < expectedImageCount) throw new Error(`报告需要 ${expectedImageCount} 张证据图片，ZIP 中仅找到 ${evidenceFiles.length} 张`);
      const response = await fetch('/api/reports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 409) throw new Error(body.error || `HTTP ${response.status}`);
      const reportAlreadyExists = response.status === 409;

      const imageResult = await uploadEvidenceFiles(evidenceFiles, next);
      if (zipFile && imageResult.available < expectedImageCount) throw new Error(`${expectedImageCount - imageResult.available} 张证据图片上传失败`);
      await refreshReports();
      if (reportAlreadyExists) setNotice(`该报告版本已存在；已核对 ${imageResult.available}/${expectedImageCount} 张证据图片，无需重复保存。`);
      else setNotice(`报告已保存到 ${user.name} 的账号${imageResult.added ? `，新增 ${imageResult.added} 张证据图片` : ''}${imageResult.unmatched ? `；${imageResult.unmatched} 个文件因名称与报告不匹配而跳过` : ''}。`);
    } catch (importError) { setError(`导入失败：${importError.message}`); }
    finally { setUploading(false); }
  };

  const addEvidenceImages = async event => {
    const files = [...(event.target.files || [])]; event.target.value = '';
    if (!report || !files.length) return;
    setError(''); setNotice('');
    try {
      const result = await uploadEvidenceFiles(files, report);
      if (!result.available && result.unmatched) throw new Error('所选图片的文件名与当前报告 image_path 不一致');
      setNotice(`新增 ${result.added} 张证据图片${result.existing ? `；${result.existing} 张已存在` : ''}${result.unmatched ? `；跳过 ${result.unmatched} 个名称不匹配的文件` : ''}${result.failed ? `；${result.failed} 张上传失败` : ''}。`);
    } catch (uploadError) { setError(`证据图片上传失败：${uploadError.message}`); }
  };

  const issues = useMemo(() => report?.issues
    .map((issue, sourceIndex) => ({ issue, sourceIndex }))
    .filter(({ issue }) => !['ruled_out', 'resolved'].includes(issue.status))
    .sort((a, b) => (issueStatusOrder[a.issue.status] ?? 99) - (issueStatusOrder[b.issue.status] ?? 99) || a.sourceIndex - b.sourceIndex)
    .map(({ issue }) => issue) ?? [], [report]);
  const evidenceById = useMemo(() => new Map((report?.evidence ?? []).map(item => [item.evidence_id, item])), [report]);
  const materialById = useMemo(() => new Map((report?.materials ?? []).map(item => [item.material_id, item])), [report]);

  const privacyNotice = showPrivacyNotice ? <PrivacyNotice onConfirm={() => setShowPrivacyNotice(false)} /> : null;

  if (user === undefined) return <>{privacyNotice}<div className="auth-page"><div className="state-card"><span className="loading-dot" />正在连接…</div></div></>;

  if (!user) return <>{privacyNotice}<div className="auth-page">
    <section className="auth-intro"><div className="wordmark auth-wordmark"><span className="wordmark-mark">核</span><span>论文核查报告</span></div><div><div className="eyebrow">PRIVATE ARCHIVE</div><h1>保存并查看<br />你的核查报告</h1><p>报告按姓名账号独立保存。登录后只能访问自己此前上传的内容。</p></div></section>
    <section className="auth-card">
      <div className="auth-tabs"><button className={authMode === 'login' ? 'active' : ''} onClick={() => { setAuthMode('login'); setError(''); }}>登录</button><button className={authMode === 'register' ? 'active' : ''} onClick={() => { setAuthMode('register'); setError(''); }}>创建账号</button></div>
      <form onSubmit={submitAuth}>
        <label>姓名<input aria-label="姓名" value={name} onChange={event => setName(event.target.value)} autoComplete="username" maxLength="60" required /></label>
        <label>密码<input aria-label="密码" value={password} onChange={event => setPassword(event.target.value)} type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} minLength="8" maxLength="128" required /></label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="primary-action" type="submit">{authMode === 'login' ? '登录' : '创建并登录'}</button>
      </form>
      <p className="auth-footnote">密码至少 8 个字符。姓名相同的账号不能重复注册。</p>
    </section>
  </div></>;

  return <>{privacyNotice}<div className="site-shell">
    <header className="document-nav"><div className="nav-inner">
      <a className="wordmark" href="/" aria-label="返回审阅控制台" onClick={event => { event.preventDefault(); setReport(null); setOpenIssueId(null); setError(''); setNotice(''); }}><span className="wordmark-mark">核</span><span>论文核查报告</span></a>
      <div className="account-actions">
        {report && <button className="logout-action console-link" onClick={() => { setReport(null); setOpenIssueId(null); setError(''); setNotice(''); }}>全部报告</button>}
        <button className="quiet-action" onClick={() => fileRef.current?.click()} disabled={uploading} aria-busy={uploading}>{uploading ? '正在上传…' : '上传报告包'}</button>
        <input ref={fileRef} className="sr-only" aria-label="上传报告包" type="file" accept="application/zip,.zip,application/json,.json,image/png,image/jpeg,image/webp" multiple onChange={importReport} />
        {report && <><button className="quiet-action" onClick={() => evidenceRef.current?.click()} disabled={uploading}>补充证据图片</button><input ref={evidenceRef} className="sr-only" aria-label="补充证据图片" type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={addEvidenceImages} /></>}
        <span className="account-name">{user.name}</span><button className="logout-action" onClick={logout}>退出</button>
      </div>
    </div></header>

    <main className="page-wrap">
      {notice && <p className="save-notice" role="status">{notice}</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {loadingReport && <div className="state-card"><span className="loading-dot" />正在读取报告…</div>}
      {!loadingReport && !report && <ReportDashboard reports={reports} onOpen={loadReport} onUpload={() => fileRef.current?.click()} />}
      {!loadingReport && report && <ReportView report={report} issues={issues} evidenceById={evidenceById} materialById={materialById} openIssueId={openIssueId} setOpenIssueId={setOpenIssueId} />}
    </main>
  </div></>;
}

function PrivacyNotice({ onConfirm }) {
  return <div className="privacy-notice-backdrop">
    <section className="privacy-notice" role="dialog" aria-modal="true" aria-labelledby="privacy-notice-title" aria-describedby="privacy-notice-description">
      <div className="privacy-notice-mark" aria-hidden="true">!</div>
      <div>
        <div className="eyebrow">使用提示</div>
        <h2 id="privacy-notice-title">未发表文章请谨慎上传</h2>
        <p id="privacy-notice-description">未发表的文章审查结果不要放在网站上，直接让 GPT/Claude 解读这个报告，自己看即可。</p>
        <button className="primary-action" type="button" autoFocus onClick={onConfirm}>我知道了</button>
      </div>
    </section>
  </div>;
}

function ReportDashboard({ reports, onOpen, onUpload }) {
  if (!reports.length) return <div className="empty-library"><div className="eyebrow">REVIEW CONSOLE</div><h1>还没有保存的报告</h1><p>选择 review-package.zip，即可一次上传报告、可读版本和全部证据截图。</p><button className="primary-action" onClick={onUpload}>上传第一份报告</button></div>;
  return <section className="review-console" aria-labelledby="console-title">
    <header className="console-intro"><div><div className="eyebrow">REVIEW CONSOLE</div><h1 id="console-title">我的审阅结果</h1><p>所有已提交的文章都保存在这里。选择一篇查看问题、证据截图与核查细节。</p></div><div className="console-count"><strong>{reports.length}</strong><span>份报告</span></div></header>
    <div className="report-ledger">{reports.map((item, index) => <button className="report-entry" key={`${item.report_id}-${item.report_revision}`} onClick={() => onOpen(item)}>
      <span className="report-entry-index">{String(index + 1).padStart(2, '0')}</span>
      <span className="report-entry-main"><strong>{item.papers?.[0]?.title || item.title}</strong><span>{item.title}</span><span className="report-entry-meta"><i>{item.papers?.[0]?.version || '版本未注明'}</i><i>revision {item.report_revision}</i><i>{item.generated_at?.slice(0, 10)}</i></span></span>
      <span className="report-entry-findings"><strong>{item.current_issue_count ?? '—'}</strong><span>当前问题</span></span>
      <span className="report-entry-arrow" aria-hidden="true">→</span>
    </button>)}</div>
  </section>;
}

function ReportView({ report, issues, evidenceById, materialById, openIssueId, setOpenIssueId }) {
  return <>
    <section className="report-intro"><div className="eyebrow">REVIEW REPORT</div><h1>{report.papers[0]?.title || report.meta.title}</h1><p className="report-subtitle">{report.scope.objective}</p><div className="report-meta"><span>{report.papers[0]?.publication?.venue || '论文'}</span>{report.papers[0]?.doi && <span>DOI {report.papers[0].doi}</span>}<span>{issues.length} 条当前问题</span><span>{report.meta.generated_at.slice(0, 10)}</span></div></section>
    <section className="issues-section" aria-labelledby="issues-title"><div className="section-heading"><div><div className="eyebrow">FINDINGS</div><h2 id="issues-title">发现的问题</h2></div><p>点击任一问题查看对应证据与核查细节</p></div>
      <div className="issue-list">{issues.map((issue, index) => {
        const expanded = openIssueId === issue.issue_id; const evidence = issue.evidence_ids.map(id => evidenceById.get(id)).filter(Boolean);
        return <article className={`issue-row status-${issue.status}`} key={issue.issue_id}>
          <button className="issue-summary" aria-expanded={expanded} aria-controls={`issue-detail-${issue.issue_id}`} onClick={() => setOpenIssueId(expanded ? null : issue.issue_id)}><span className="issue-number">{String(index + 1).padStart(2, '0')}</span><span className="issue-copy"><span className="issue-labels"><span className="status-label"><i />{statusLabels[issue.status] || issue.status}</span><span>{impactLabels[issue.impact_scope] || issue.impact_scope}</span></span><strong>{issue.title}</strong><span className="issue-observation">{issue.observation}</span></span><span className="expand-icon" aria-hidden="true">{expanded ? '−' : '+'}</span></button>
          {expanded && <div className="issue-detail" id={`issue-detail-${issue.issue_id}`}><section className="detail-block evidence-block"><h3>对应证据</h3><div className="evidence-stack">{evidence.map((item, evidenceIndex) => { const material = materialById.get(item.material_id); const imageUrl = `/api/reports/${encodeURIComponent(report.meta.report_id)}/${report.meta.report_revision}/assets/${encodeURIComponent(item.image_path || '')}`; return <div className="evidence-row" key={item.evidence_id}><div className="evidence-index">证据 {evidenceIndex + 1}</div><div><p>{item.content}</p><div className="evidence-source"><span>{formatLocator(item.locator)}</span>{material?.file_name && <span>{material.file_name}</span>}</div>{item.image_path && <a className="evidence-image" href={imageUrl} target="_blank" rel="noreferrer"><img src={imageUrl} alt={`${item.content}的原文截图`} loading="lazy" /><span>查看原图</span></a>}</div></div>; })}</div></section><div className="detail-grid"><section className="detail-block"><h3>核查结论</h3><p>{issue.status_reason}</p></section><section className="detail-block"><h3>影响判断</h3><p>{issue.impact_reason}</p></section><section className="detail-block"><h3>核查方法</h3><p>{issue.verification_method}</p><ul>{issue.verification_steps.map(step => <li key={step}>{step}</li>)}</ul></section><section className="detail-block recommendation"><h3>建议处理</h3><p>{issue.recommended_action}</p></section></div>{issue.missing_materials.length > 0 && <section className="missing-note"><strong>仍需材料</strong><span>{issue.missing_materials.join('；')}</span></section>}</div>}
        </article>;
      })}</div>{!issues.length && <div className="state-card">当前报告没有待展示的问题。</div>}
    </section><footer className="report-footer"><span>{report.meta.report_id} · revision {report.meta.report_revision}</span><span>结论以当前已取得材料为限</span></footer>
  </>;
}
