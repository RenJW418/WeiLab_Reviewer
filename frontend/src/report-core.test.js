import { describe, expect, it } from 'vitest';
import report from '../../reports/example/report.json';
import { deriveStats, isSafeRelativePath, renderMarkdown, validateRelations } from '../../shared/report-core.js';
import { validateReport } from './lib/validation.js';

const clone = value => structuredClone(value);

describe('report contract and cross references', () => {
  it('accepts the synthetic partial report and derives honest counts', () => {
    expect(validateReport(report)).toEqual({ valid: true, errors: [] });
    const stats = deriveStats(report);
    expect(stats.checkCounts).toMatchObject({ pass: 2, fail: 1, blocked: 1, not_applicable: 1 });
    expect(stats.issueCounts).toMatchObject({ confirmed: 1, conditional: 1, ruled_out: 1, resolved: 1 });
    expect(stats.currentIssueCount).toBe(2);
    expect(stats.coverage).toBeCloseTo(0.75);
  });

  it.each([
    ['missing required field', data => { delete data.meta.run_id; }, '/meta'],
    ['illegal enum', data => { data.issues[0].status = 'severe'; }, '/issues/0/status'],
    ['unsupported version', data => { data.meta.schema_version = '2.0.0'; }, '/meta/schema_version'],
    ['duplicate global id', data => { data.materials[0].material_id = data.papers[0].paper_id; }, '/materials/0/material_id'],
    ['dangling reference', data => { data.claims[0].supporting_evidence_ids = ['E-NOT-THERE']; }, '/claims/0/supporting_evidence_ids/0']
  ])('rejects %s with a locatable path', (_label, mutate, path) => {
    const data = clone(report); mutate(data); const result = validateReport(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some(error => error.path.includes(path))).toBe(true);
  });

  it('does not allow confirmed issues without direct evidence and an executed verification', () => {
    const data = clone(report); data.issues[1].status = 'confirmed'; data.issues[1].direct_source_read = false;
    const errors = validateRelations(data);
    expect(errors.some(error => error.message.includes('direct_source_read'))).toBe(true);
    expect(errors.some(error => error.message.includes('实际执行记录'))).toBe(true);
  });

  it('shows undefined coverage when the checklist is not defined or denominator is zero', () => {
    const data = clone(report); data.scope.checklist_defined = false;
    expect(deriveStats(data).coverage).toBeNull();
    data.scope.checklist_defined = true; data.checks = data.checks.filter(c => c.status === 'not_applicable');
    expect(deriveStats(data).coverage).toBeNull();
  });

  it('renders Markdown from the same data and keeps the demo warning', () => {
    const markdown = renderMarkdown(report);
    expect(markdown).toContain('演示数据');
    expect(markdown).toContain('I-ABSTRACT-1');
    expect(markdown).toContain('选定检查执行比例：75%');
  });

  it('blocks unsafe attachment paths', () => {
    expect(isSafeRelativePath('materials/source.xlsx')).toBe(true);
    expect(isSafeRelativePath('../secret.txt')).toBe(false);
    expect(isSafeRelativePath('/etc/passwd')).toBe(false);
    expect(isSafeRelativePath('C:\\secret.txt')).toBe(false);
  });
});
