#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import JSZip from 'jszip';
import { validateReport } from './validation.mjs';
import { renderMarkdown } from '../shared/report-core.js';

const [inputArg, evidenceArg, outputArg] = process.argv.slice(2);
if (!inputArg) {
  console.error('用法: node scripts/package-report.mjs <report.json> [evidence-dir] [output.zip]');
  process.exit(2);
}

const input = resolve(inputArg);
const reportDir = dirname(input);
const evidenceDir = resolve(evidenceArg || join(reportDir, 'evidence-images'));
const output = resolve(outputArg || join(reportDir, 'review-package.zip'));

try {
  const report = JSON.parse(await readFile(input, 'utf8'));
  const validation = validateReport(report);
  if (!validation.valid) throw new Error(`报告未通过校验：${validation.errors.map(error => `${error.path} ${error.message}`).join('；')}`);

  const zip = new JSZip();
  const fileDate = new Date(report.meta.generated_at);
  const zipOptions = { date: Number.isNaN(fileDate.getTime()) ? new Date(0) : fileDate };
  zip.file('report.json', `${JSON.stringify(report, null, 2)}\n`, zipOptions);
  zip.file('report.md', renderMarkdown(report), zipOptions);

  const imageNames = [...new Set(report.evidence.map(item => item.image_path).filter(Boolean))];
  for (const imageName of imageNames) {
    let image;
    const candidates = [join(evidenceDir, imageName), join(reportDir, 'evidence', imageName), join(reportDir, imageName)];
    for (const candidate of candidates) {
      try { image = await readFile(candidate); break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (!image) throw new Error(`缺少报告引用的证据图片：${imageName}`);
    zip.file(`evidence/${imageName}`, image, { ...zipOptions, createFolders: false });
  }

  const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, archive);

  const verification = await JSZip.loadAsync(archive);
  if (!verification.file('report.json') || !verification.file('report.md')) throw new Error('生成后的报告包校验失败');
  for (const imageName of imageNames) if (!verification.file(`evidence/${imageName}`)) throw new Error(`生成后的报告包缺少：evidence/${imageName}`);
  console.log(`已生成 ${output}：report.json、report.md、${imageNames.length} 张证据图片`);
} catch (error) {
  console.error(`无法生成报告包：${error.message}`);
  process.exit(1);
}
