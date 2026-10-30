import type { ParsedQueryIntent } from './intent.ts';

/**
 * The closed TypedQuery schema (S1R-L1-4), mirrored from the GBNF in
 * orion-lab/inputs/flowiq-typedquery.gbnf. Whatever produced an intent (the
 * deterministic parser or a grammar-constrained model), it is executed only
 * if it validates here: every enum is closed, every bound is a finite
 * number in range, and no lower bound exceeds its upper bound.
 */
const DOMAINS = new Set(['data_quality', 'decisions', 'marketing', 'leases', 'units']);
const AGGREGATIONS = new Set(['value', 'argmax', 'argmin', 'list', 'compare']);
const STATUSES = new Set(['occupied', 'notice', 'vacant']);
const LEASE_TYPES = new Set(['new', 'renewal']);
const RENEWAL = new Set(['renewed', 'pending', 'notice_given', 'not_due']);
const ACCEPTED = new Set(['yes', 'no', 'all']);
const DIRECTIONS = new Set(['increase', 'decrease']);

const BOUNDS: ReadonlyArray<readonly [keyof ParsedQueryIntent, keyof ParsedQueryIntent, number, number]> = [
  ['bedroomsMin', 'bedroomsMax', 0, 9],
  ['bathroomsMin', 'bathroomsMax', 0, 9.5],
  ['sqftMin', 'sqftMax', 0, 999_999],
  ['floorMin', 'floorMax', 0, 999],
  ['rentMin', 'rentMax', 0, 999_999],
  ['yearBuiltMin', 'yearBuiltMax', 1800, 2099],
];

/** Why an intent is not a valid TypedQuery; empty when it is. */
export function typedQueryErrors(i: ParsedQueryIntent): string[] {
  const errs: string[] = [];
  const inSet = (k: string, v: unknown, s: Set<string>) => {
    if (v !== undefined && !s.has(String(v))) errs.push(`${k}=${JSON.stringify(v)} is not in the closed set`);
  };
  inSet('domain', i.domain, DOMAINS);
  inSet('aggregation', i.aggregation, AGGREGATIONS);
  inSet('unitStatus', i.unitStatus, STATUSES);
  inSet('leaseType', i.leaseType, LEASE_TYPES);
  inSet('renewalStatus', i.renewalStatus, RENEWAL);
  inSet('decisionAccepted', i.decisionAccepted, ACCEPTED);
  inSet('decisionDirection', i.decisionDirection, DIRECTIONS);
  if (i.topK !== undefined && !(Number.isInteger(i.topK) && i.topK >= 2 && i.topK <= 10)) errs.push(`topK=${i.topK} is outside 2..10`);
  for (const k of ['bedrooms', 'bathrooms'] as const) {
    const v = i[k];
    if (v !== undefined && !(Number.isFinite(v) && v >= 0 && v <= 9.5)) errs.push(`${k}=${v} is out of range`);
  }
  for (const [lo, hi, min, max] of BOUNDS) {
    const a = i[lo] as number | undefined, b = i[hi] as number | undefined;
    for (const [k, v] of [[lo, a], [hi, b]] as const) {
      if (v !== undefined && !(Number.isFinite(v) && v >= min && v <= max)) errs.push(`${String(k)}=${v} is outside ${min}..${max}`);
    }
    if (a !== undefined && b !== undefined && a > b) errs.push(`${String(lo)}=${a} exceeds ${String(hi)}=${b}`);
  }
  return errs;
}
