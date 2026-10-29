import type { PortfolioStore } from '../data/schema.ts';
import { didYouMean } from '../util/suggest.ts';

interface PropertySchema {
  readonly type?: string;
  readonly enum?: readonly unknown[];
  readonly items?: { readonly type?: string };
  readonly minimum?: number;
  readonly maximum?: number;
  /** Nested object arguments are checked with the same rules. */
  readonly properties?: Readonly<Record<string, PropertySchema>>;
}

interface ObjectSchema {
  readonly properties?: Readonly<Record<string, PropertySchema>>;
  readonly required?: readonly string[];
}

function typeMatches(value: unknown, type: string | undefined): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    default:
      return true;
  }
}

/**
 * Checks tool arguments against the tool's inputSchema and the loaded ids.
 * Returns a list of problems; an empty list means the call may run.
 * Wrong types used to be ignored, so propertyIds:"P01" quietly meant
 * "every building" and an unknown id quietly meant "$0".
 */
export function validateToolArguments(
  args: unknown,
  schema: ObjectSchema,
  store: PortfolioStore,
): string[] {
  if (!typeMatches(args, 'object')) {
    return ['arguments must be an object'];
  }
  const record = args as Record<string, unknown>;
  const props = schema.properties ?? {};
  const problems: string[] = [];

  for (const key of schema.required ?? []) {
    if (record[key] === undefined || record[key] === null || record[key] === '') {
      problems.push(`missing required argument "${key}"`);
    }
  }
  for (const [key, value] of Object.entries(record)) {
    const spec = props[key];
    if (!spec) {
      problems.push(
        `unknown argument "${key}"${didYouMean(key, Object.keys(props))} (allowed: ${Object.keys(props).join(', ') || 'none'})`,
      );
      continue;
    }
    if (value === undefined || value === null) continue;
    if (!typeMatches(value, spec.type)) {
      problems.push(`"${key}" must be ${spec.type}, got ${JSON.stringify(value)}`);
      continue;
    }
    if (spec.enum && !spec.enum.includes(value)) {
      problems.push(`"${key}" must be one of ${spec.enum.join(', ')}, got ${JSON.stringify(value)}`);
    }
    if (typeof value === 'number' && spec.minimum !== undefined && value < spec.minimum) {
      problems.push(`"${key}" must be at least ${spec.minimum}, got ${value}`);
    }
    if (typeof value === 'number' && spec.maximum !== undefined && value > spec.maximum) {
      problems.push(`"${key}" must be at most ${spec.maximum}, got ${value}`);
    }
    if (spec.type === 'object' && spec.properties) {
      for (const p of validateToolArguments(value, { properties: spec.properties }, store)) {
        problems.push(`${key}: ${p}`);
      }
    }
    if (spec.type === 'array' && spec.items?.type) {
      const bad = (value as unknown[]).filter((v) => !typeMatches(v, spec.items?.type));
      if (bad.length > 0) {
        problems.push(`"${key}" must contain only ${spec.items.type} values`);
      }
    }
  }

  const ids = record.propertyIds ?? (record.propertyId !== undefined ? [record.propertyId] : []);
  if (Array.isArray(ids)) {
    const known = new Set(store.properties.map((p) => p.propertyId));
    const unknown = ids.filter((id) => typeof id === 'string' && !known.has(id));
    if (unknown.length > 0) {
      problems.push(
        `unknown property id ${unknown.join(', ')} (known: ${[...known].join(', ')})`,
      );
    }
  }
  return problems;
}
