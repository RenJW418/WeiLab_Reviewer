#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const input = process.argv[2];
if (!input) {
  console.error('用法: node scripts/extract-method-parameters.mjs <methods.txt>');
  process.exit(2);
}

const text = await readFile(input, 'utf8');
const lines = text.split(/\r?\n/);
const unitPattern = /(?:~|∼|≈|<|>|≤|≥)?\s*\d+(?:\.\d+)?(?:\s*[–-]\s*\d+(?:\.\d+)?)?\s*(?:%|°\s*C|℃|μm|µm|nm|mm|cm|mL|μL|µL|nL|L|mg\/kg|mg|μg|µg|ng|pg|mM|μM|µM|nM|M|rpm|×\s*g|x\s*g|h|hr|hours?|min|minutes?|s|seconds?|days?|weeks?|months?|bp|nt|reads?)\b/giu;
const candidates = [];

for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index];
  const matches = [...line.matchAll(unitPattern)];
  if (!matches.length) continue;
  candidates.push({ line: index + 1, values: matches.map(match => match[0].trim()), context: line.trim() });
}

process.stdout.write(`${JSON.stringify({ input, candidate_count: candidates.length, candidates }, null, 2)}\n`);
