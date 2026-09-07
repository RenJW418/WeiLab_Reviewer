#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { validateReport } from './validation.mjs';

const input = process.argv[2];
if (!input) { console.error('用法: node scripts/validate-report.mjs <report.json>'); process.exit(2); }
try {
  const report = JSON.parse(await readFile(input, 'utf8'));
  const result = validateReport(report);
  if (!result.valid) {
    console.error(`校验失败，共 ${result.errors.length} 项：`);
    for (const error of result.errors) console.error(`- ${error.path}: ${error.message}`);
    process.exit(1);
  }
  console.log(`格式与引用校验通过：${report.meta.report_id} revision ${report.meta.report_revision}。这不代表科研结论已验证。`);
} catch (error) {
  console.error(`无法读取报告：${error.message}`);
  process.exit(1);
}
