import type { ParsedQueryIntent } from './intent.ts';

/**
 * The closed TypedQuery schema (S1R-L1-4), the one source the GBNF is
 * generated from (typed-query-grammar.ts). Whatever produced an intent (the
 * deterministic parser or a grammar-constrained model), it is executed only
 * if it validates here: every enum is closed, every bound is a finite
 * number in range, and no lower bound exceeds its upper bound.
 */
const DOMAINS = new Set(['data_quality', 'decisions', 'marketing', 'leases', 'units']);
const AGGREGATIONS = new Set(['value', 'argmax', 'argmin', 'list', 'compare']);
/** IntentMeasure minus 'unsupported', as the GBNF lists it. */
export const MEASURES = new Set(['void_and_duplicate_counts', 'decision_lookup', 'decision_cohort_rejected',
  'decision_post_spend_comparison', 'decision_outcome_learning', 'reallocation_leases', 'dead_spend_pairs',
  'dead_spend_building', 'tour_to_lease_rate', 'apply_rate', 'applied_without_tour', 'applied_and_leased',
  'cost_per_lead_and_tour', 'cost_per_lead', 'cost_per_tour', 'lead_count', 'spend_h1_vs_q3', 'spend_total',
  'signed_leases_ranking', 'cost_per_signed_lease', 'ending_and_renewed', 'renewal_rate',
  'renewal_rate_class_comparison', 'new_vs_renewal_and_concession', 'average_concession', 'total_concession', 'rent_at_risk',
  'lease_count', 'vacancy_rate', 'occupied_share', 'avg_market_rent_and_sqft', 'avg_market_rent', 'avg_sqft',
  'rent_per_sqft', 'unit_count']);
export const DOMAIN_SET = DOMAINS, AGGREGATION_SET = AGGREGATIONS;
export const STATUSES = new Set(['occupied', 'notice', 'vacant']);
export const LEASE_TYPES = new Set(['new', 'renewal']);
export const RENEWAL = new Set(['renewed', 'pending', 'notice_given', 'not_due']);
export const ACCEPTED = new Set(['yes', 'no', 'all']);
export const DIRECTIONS = new Set(['increase', 'decrease']);
export const TOPK = [2, 10] as const;
export const COUNT_MAX = 9.5;

export const BOUNDS: ReadonlyArray<readonly [keyof ParsedQueryIntent, keyof ParsedQueryIntent, number, number]> = [
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
  if (i.unitStatusIn !== undefined) {
    const s = i.unitStatusIn;
    if (!Array.isArray(s) || s.length !== 2 || new Set(s).size !== 2 || s.some((v) => !STATUSES.has(String(v))) || i.unitStatus !== undefined) errs.push('unitStatusIn must be two distinct statuses and exclude unitStatus');
  }
  inSet('leaseType', i.leaseType, LEASE_TYPES);
  inSet('renewalStatus', i.renewalStatus, RENEWAL);
  inSet('decisionAccepted', i.decisionAccepted, ACCEPTED);
  inSet('decisionDirection', i.decisionDirection, DIRECTIONS);
  if (i.topK !== undefined && !(Number.isInteger(i.topK) && i.topK >= TOPK[0] && i.topK <= TOPK[1])) errs.push(`topK=${i.topK} is outside ${TOPK[0]}..${TOPK[1]}`);
  for (const k of ['bedrooms', 'bathrooms'] as const) {
    const v = i[k];
    if (v !== undefined && !(Number.isFinite(v) && v >= 0 && v <= COUNT_MAX)) errs.push(`${k}=${v} is out of range`);
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
