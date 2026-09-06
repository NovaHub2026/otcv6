import type { FieldType, Shape } from './contract.js';

/** Whether a JSON value is of a contracted type (PH-29.2). */
export function conforms(value: unknown, type: FieldType): boolean {
  const [base, nullable] = type.split('|');
  if (value === null) return nullable === 'null';
  switch (base) {
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && !Array.isArray(value);
    default:
      return false;
  }
}

/**
 * Every way a JSON object departs from a shape: a key the contract does not
 * name, a named key missing, a value of the wrong type. Empty when it conforms.
 */
export function shapeProblems(where: string, value: unknown, shape: Shape): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [`${where}: not an object`];
  }
  const record = value as Record<string, unknown>;
  const problems: string[] = [];
  const keys = Object.keys(record).sort();
  const wanted = Object.keys(shape).sort();
  if (JSON.stringify(keys) !== JSON.stringify(wanted)) {
    problems.push(`${where}: keys ${keys.join(',')} — the contract names ${wanted.join(',')}`);
  }
  for (const [key, type] of Object.entries(shape)) {
    if (key in record && !conforms(record[key], type)) {
      problems.push(`${where}.${key}: ${JSON.stringify(record[key])} is not ${type}`);
    }
  }
  return problems;
}
