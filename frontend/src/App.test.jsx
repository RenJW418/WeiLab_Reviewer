import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import JSZip from 'jszip';
import report from '../../reports/example/report.json';
import App from './App.jsx';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const reportDescriptor = value => ({ report_id: value.meta.report_id, report_revision: value.meta.report_revision, title: value.meta.title, generated_at: value.meta.generated_at, current_issue_count: value.issues.filter(issue => !['ruled_out', 'resolved'].includes(issue.status)).length, papers: value.papers.map(paper => ({ title: paper.title, version: paper.version })) });
const mockServerReport = value => vi.stubGlobal('fetch', vi.fn()
  .mockResolvedValueOnce({ ok: true, json: async () => ({ authenticated: true, user: { user_id: 'U-1', name: '测试用户' } }) })
  .mockResolvedValueOnce({ ok: true, json: async () => ({ reports: [reportDescriptor(value)] }) })
  .mockResolvedValueOnce({ ok: true, json: async () => structuredClone(value) }));
const openReport = async value => userEvent.click(await screen.findByRole('button', { name: new RegExp(value.papers[0].title) }));

describe('reader-facing issue list', () => {
  it('shows the unpublished-work warning on every fresh page load', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ authenticated: false }) }));
    render(<App />);
    const dialog = screen.getByRole('dialog', { name: '未发表文章请谨慎上传' });
    expect(dialog).toHaveTextContent('未发表的文章审查结果不要放在网站上');
    expect(dialog).toHaveTextContent('直接让 GPT/Claude 解读这个报告');
    await userEvent.click(screen.getByRole('button', { name: '我知道了' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('requires login before any report is visible', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ authenticated: false }) }));
    render(<App />);
    expect(await screen.findByLabelText('姓名')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '登录' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: '创建账号' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '发现的问题' })).not.toBeInTheDocument();
  });

  it('shows the report console first and opens details only after selection', async () => {
    mockServerReport(report);
    render(<App />);
    expect(await screen.findByRole('heading', { name: '我的审阅结果' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '发现的问题' })).not.toBeInTheDocument();
    await openReport(report);
    expect(await screen.findByRole('heading', { level: 1, name: report.papers[0].title })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '发现的问题' })).toBeInTheDocument();
    expect(screen.queryByText('总览')).not.toBeInTheDocument();
    expect(screen.queryByText('主张—证据')).not.toBeInTheDocument();
    expect(screen.queryByText(/演示数据/)).not.toBeInTheDocument();
  });

  it('lists current issues and expands evidence and details inline', async () => {
    mockServerReport(report);
    render(<App />);
    await openReport(report);
    const issueButton = await screen.findByRole('button', { name: /摘要效应量与 Table 2 不一致/ });
    expect(issueButton).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(issueButton);
    expect(issueButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('对应证据')).toBeInTheDocument();
    expect(screen.getByText('摘要报告第 8 周组间差为 18 个单位。')).toBeInTheDocument();
    expect(screen.getByText('核查结论')).toBeInTheDocument();
    expect(screen.getByText('建议处理')).toBeInTheDocument();
  });

  it('places confirmed findings before conditional and clarification findings', async () => {
    const outOfOrder = structuredClone(report);
    const confirmed = outOfOrder.issues.find(issue => issue.status === 'confirmed');
    const conditional = outOfOrder.issues.find(issue => issue.status === 'conditional');
    outOfOrder.issues = [conditional, confirmed, ...outOfOrder.issues.filter(issue => ![conditional.issue_id, confirmed.issue_id].includes(issue.issue_id))];
    mockServerReport(outOfOrder);
    render(<App />);
    await openReport(outOfOrder);
    const issueButtons = await screen.findAllByRole('button', { name: /已确认|条件性问题|待澄清/ });
    expect(issueButtons[0]).toHaveAccessibleName(/已确认/);
    expect(issueButtons[1]).toHaveAccessibleName(/条件性问题/);
  });

  it('shows source screenshots when an evidence record provides one', async () => {
    const reportWithImage = structuredClone(report);
    reportWithImage.evidence.find(item => item.evidence_id === 'E-ABSTRACT-1').image_path = 'abstract-page.png';
    mockServerReport(reportWithImage);
    render(<App />);
    await openReport(reportWithImage);
    await userEvent.click(await screen.findByRole('button', { name: /摘要效应量与 Table 2 不一致/ }));
    const image = screen.getByRole('img', { name: /摘要报告第 8 周组间差为 18 个单位/ });
    expect(image).toHaveAttribute('src', expect.stringContaining('/assets/abstract-page.png'));
  });

  it('does not present ruled-out or resolved records as current issues', async () => {
    mockServerReport(report);
    render(<App />);
    await openReport(report);
    await screen.findByRole('heading', { level: 1, name: report.papers[0].title });
    expect(screen.queryByRole('button', { name: /安全性分母差异可由缺失值规则解释/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /旧稿组别颜色问题已在 v1.0 解决/ })).not.toBeInTheDocument();
  });

  it('saves an imported report to the signed-in account', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ authenticated: true, user: { user_id: 'U-1', name: '测试用户' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ reports: [] }) })
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ reports: [reportDescriptor(report)] }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    const input = await screen.findByLabelText('上传报告包');
    await userEvent.upload(input, new File([JSON.stringify(report)], 'report.json', { type: 'application/json' }));
    expect(await screen.findByText(/报告已保存到 测试用户 的账号/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/reports', expect.objectContaining({ method: 'POST' }));
  });

  it('imports report JSON and its evidence image from one ZIP package', async () => {
    const reportWithImage = structuredClone(report);
    reportWithImage.evidence[0].image_path = 'evidence-page.png';
    const archive = new JSZip();
    archive.file('report.json', JSON.stringify(reportWithImage));
    archive.file('report.md', '# 可读报告');
    archive.file('evidence/evidence-page.png', new Uint8Array([137, 80, 78, 71]));
    const packageBytes = await archive.generateAsync({ type: 'uint8array' });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ authenticated: true, user: { user_id: 'U-1', name: '测试用户' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ reports: [] }) })
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ reports: [reportDescriptor(report)] }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    const input = await screen.findByLabelText('上传报告包');
    await userEvent.upload(input, new File([packageBytes], 'review-package.zip', { type: 'application/zip' }));
    expect(await screen.findByText(/新增 1 张证据图片/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/assets/evidence-page.png'), expect.objectContaining({ method: 'POST' }));
  });

  it('uploads evidence images separately after a report is already saved', async () => {
    const reportWithImage = structuredClone(report);
    reportWithImage.evidence[0].image_path = 'evidence-page.png';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ authenticated: true, user: { user_id: 'U-1', name: '测试用户' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ reports: [reportDescriptor(reportWithImage)] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => reportWithImage })
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await openReport(reportWithImage);
    const input = await screen.findByLabelText('补充证据图片');
    await userEvent.upload(input, new File(['image'], 'evidence-page.png', { type: 'image/png' }));
    expect(await screen.findByText('新增 1 张证据图片。')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining('/assets/evidence-page.png'), expect.objectContaining({ method: 'POST' }));
  });
});
