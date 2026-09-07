import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateRelations } from '../shared/report-core.js';

const schemaPath = fileURLToPath(new URL('../schemas/report.schema.json', import.meta.url));
const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

export function validateReport(report) {
  const validShape = validateSchema(report);
  const schemaErrors = validShape ? [] : validateSchema.errors.map(e => ({ path: e.instancePath || '/', message: e.message, keyword: e.keyword }));
  const relationErrors = validShape ? validateRelations(report) : [];
  return { valid: schemaErrors.length === 0 && relationErrors.length === 0, schemaErrors, relationErrors, errors: [...schemaErrors, ...relationErrors] };
}
