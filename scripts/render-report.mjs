#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { validateReport } from './validation.mjs';
import { renderMarkdown } from '../shared/report-core.js';

const [input, output] = process.argv.slice(2);
if (!input) { console.error('用法: node scripts/render-report.mjs <report.json> [report.md]'); process.exit(2); }
try {
  const report = JSON.parse(await readFile(input, 'utf8'));
  const result = validateReport(report);
  if (!result.valid) throw new Error(`报告未通过校验：${result.errors.map(e => `${e.path} ${e.message}`).join('；')}`);
  const markdown = renderMarkdown(report);
  if (output) { await writeFile(output, markdown, 'utf8'); console.log(`已从 ${input} 生成 ${output}`); }
  else process.stdout.write(markdown);
} catch (error) { console.error(error.message); process.exit(1); }
