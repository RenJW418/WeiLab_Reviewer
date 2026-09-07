import { validateRelations } from '../../../shared/report-core.js';
import { validateReportSchema as validateSchema } from './generated-validator.js';

export function validateReport(report) {
  const shapeValid = validateSchema(report);
  const schemaErrors = shapeValid ? [] : validateSchema.errors.map(error => ({ path: error.instancePath || '/', message: error.message, keyword: error.keyword }));
  const relationErrors = shapeValid ? validateRelations(report) : [];
  return { valid: schemaErrors.length === 0 && relationErrors.length === 0, errors: [...schemaErrors, ...relationErrors] };
}
