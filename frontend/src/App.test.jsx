import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import report from '../../reports/example/report.json';
import App from './App.jsx';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const mockServerReport = value => vi.stubGlobal('fetch', vi.fn()
  .mockResolvedValueOnce({ ok: true, json: async () => ({ authenticated: true, user: { user_id: 'U-1', name: '测试用户' } }) })
  .mockResolvedValueOnce({ ok: true, json: async () => ({ reports: [{ report_id: value.meta.report_id, report_revision: value.meta.report_revision }] }) })
  .mockResolvedValueOnce({ ok: true, json: async () => structuredClone(value) }));

describe('reader-facing issue list', () => {
  it('requires login before any report is visible', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ authenticated: false }) }));
    render(<App />);
    expect(await screen.findByLabelText('姓名')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '登录' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: '创建账号' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '发现的问题' })).not.toBeInTheDocument();
  });

  it('loads the newest server report without workbench navigation or demo labels', async () => {
    mockServerReport(report);
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: report.papers[0].title })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '发现的问题' })).toBeInTheDocument();
    expect(screen.queryByText('总览')).not.toBeInTheDocument();
    expect(screen.queryByText('主张—证据')).not.toBeInTheDocument();
    expect(screen.queryByText(/演示数据/)).not.toBeInTheDocument();
  });

  it('lists current issues and expands evidence and details inline', async () => {
    mockServerReport(report);
    render(<App />);
    const issueButton = await screen.findByRole('button', { name: /摘要效应量与 Table 2 不一致/ });
    expect(issueButton).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(issueButton);
    expect(issueButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('对应证据')).toBeInTheDocument();
    expect(screen.getByText('摘要报告第 8 周组间差为 18 个单位。')).toBeInTheDocument();
    expect(screen.getByText('核查结论')).toBeInTheDocument();
    expect(screen.getByText('建议处理')).toBeInTheDocument();
  });

  it('shows source screenshots when an evidence record provides one', async () => {
    const reportWithImage = structuredClone(report);
    reportWithImage.evidence.find(item => item.evidence_id === 'E-ABSTRACT-1').image_path = 'abstract-page.png';
    mockServerReport(reportWithImage);
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /摘要效应量与 Table 2 不一致/ }));
    const image = screen.getByRole('img', { name: /摘要报告第 8 周组间差为 18 个单位/ });
    expect(image).toHaveAttribute('src', expect.stringContaining('/assets/abstract-page.png'));
  });

  it('does not present ruled-out or resolved records as current issues', async () => {
    mockServerReport(report);
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: report.papers[0].title });
    expect(screen.queryByRole('button', { name: /安全性分母差异可由缺失值规则解释/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /旧稿组别颜色问题已在 v1.0 解决/ })).not.toBeInTheDocument();
  });

  it('saves an imported report to the signed-in account', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ authenticated: true, user: { user_id: 'U-1', name: '测试用户' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ reports: [] }) })
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ reports: [{ report_id: report.meta.report_id, report_revision: report.meta.report_revision }] }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    const input = await screen.findByLabelText('导入报告和证据图片');
    await userEvent.upload(input, new File([JSON.stringify(report)], 'report.json', { type: 'application/json' }));
    expect(await screen.findByText(/报告已保存到 测试用户 的账号/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/reports', expect.objectContaining({ method: 'POST' }));
  });

  it('uploads evidence images separately after a report is already saved', async () => {
    const reportWithImage = structuredClone(report);
    reportWithImage.evidence[0].image_path = 'evidence-page.png';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ authenticated: true, user: { user_id: 'U-1', name: '测试用户' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ reports: [{ report_id: report.meta.report_id, report_revision: report.meta.report_revision }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => reportWithImage })
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    const input = await screen.findByLabelText('补充证据图片');
    await userEvent.upload(input, new File(['image'], 'evidence-page.png', { type: 'image/png' }));
    expect(await screen.findByText('已关联 1 张证据图片。')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining('/assets/evidence-page.png'), expect.objectContaining({ method: 'POST' }));
  });
});
