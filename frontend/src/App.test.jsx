import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import report from '../../reports/example/report.json';
import App from './App.jsx';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const mockServerReport = value => vi.stubGlobal('fetch', vi.fn()
  .mockResolvedValueOnce({ ok: true, json: async () => ({ reports: [{ report_id: value.meta.report_id, report_revision: value.meta.report_revision }] }) })
  .mockResolvedValueOnce({ ok: true, json: async () => structuredClone(value) }));

describe('reader-facing issue list', () => {
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
});
