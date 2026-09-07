#!/usr/bin/env node
import Ajv2020 from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';
import addFormats from 'ajv-formats';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const schemaPath = fileURLToPath(new URL('../schemas/report.schema.json', import.meta.url));
const outputPath = fileURLToPath(new URL('../frontend/src/lib/generated-validator.js', import.meta.url));
const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true, code: { source: true, esm: true } });
addFormats(ajv);
ajv.addSchema(schema, 'report');
const moduleCode = standaloneCode(ajv, { validateReportSchema: 'report' })
  .replaceAll('require("ajv/dist/runtime/ucs2length").default', 'ucs2LengthRuntime')
  .replaceAll('require("ajv/dist/runtime/equal").default', 'equalRuntime')
  .replaceAll('require("ajv-formats/dist/formats").fullFormats', 'formatsRuntime.fullFormats');
const imports = `import formatsModule from 'ajv-formats/dist/formats.js';\nimport equalModule from 'ajv/dist/runtime/equal.js';\nimport ucs2LengthModule from 'ajv/dist/runtime/ucs2length.js';\nconst formatsRuntime = formatsModule.fullFormats ? formatsModule : formatsModule.default;\nconst equalRuntime = typeof equalModule === 'function' ? equalModule : equalModule.default;\nconst ucs2LengthRuntime = typeof ucs2LengthModule === 'function' ? ucs2LengthModule : ucs2LengthModule.default;\n`;
await writeFile(outputPath, `// Generated from schemas/report.schema.json. Do not edit by hand.\n${imports}${moduleCode}`, 'utf8');
console.log(`已生成浏览器静态校验器：${outputPath}`);
