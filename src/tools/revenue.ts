/**
 * revenue (FIQ-TOOLS-1 §2.6). Monthly, as of the units snapshot.
 * Effective-rent rule (stated, Q4 open): rent_roll − Σ concession_usd /
 * term_months over leases on occupied or notice units, term from
 * start_date..end_date in whole months (every kit lease is 12, so this
 * equals the truth check's /12).
 */
import type { PortfolioStore } from '../data/schema.ts';
import { roundHalfUp, unknownEnvelope, type ToolEnvelope } from './envelope.ts';

export const REVENUE_DESCRIPTION =
  "Monthly rent roll (in-place rent on occupied and notice units), effective rent after concessions, and loss to vacancy (market rent of vacant units). Use for 'rent roll', 'revenue', 'effective rent', 'what vacancy costs us'. Do NOT use for NOI, collections or delinquency: the kit has no such data, so decline (§4).";

export const EFFECTIVE_RENT_RULE = 'concession_usd / term_months (from start_date to end_date), leases on occupied or notice units';

export interface RevenueValue {
  readonly rent_roll_monthly: number;
  readonly effective_rent_monthly: number;
  readonly loss_to_vacancy_monthly: number;
  readonly label: string;
  readonly amortization_rule: string;
}

export function termMonths(start: string, end: string): number {
  const [ys, ms, ds] = start.split('-').map(Number);
  const [ye, me, de] = end.split('-').map(Number);
  // Whole months plus the day remainder; an end the day before the anniversary rounds to a whole term.
  return Math.max(1, Math.round((ye - ys) * 12 + (me - ms) + (de - ds + 1) / 30));
}

export function revenue(store: PortfolioStore, args: { property_id?: string } = {}): ToolEnvelope<RevenueValue> {
  const operating = new Set(store.operatingProperties.map((p) => p.propertyId));
  if (args.property_id && !operating.has(args.property_id)) return unknownEnvelope(`${args.property_id} is not an operating building (no units)`);
  const inScope = (pid: string) => operating.has(pid) && (!args.property_id || pid === args.property_id);
  const unit = new Map(store.units.map((u) => [u.unitId, u]));
  let rr = 0, amort = 0, ltv = 0;
  const cites = [];
  for (const l of store.leases) {
    const u = unit.get(l.unitId);
    if (!u || !inScope(u.propertyId) || (u.status !== 'occupied' && u.status !== 'notice')) continue;
    rr += l.monthlyRent;
    amort += l.concessionUsd / termMonths(l.startDate, l.endDate);
    if (cites.length < 6) cites.push(l.citationId);
  }
  for (const u of store.units) if (inScope(u.propertyId) && u.status === 'vacant') { ltv += u.marketRent; if (cites.length < 8) cites.push(u.citationId); }
  const asOf = store.policy.asOfDate;
  return {
    value: { rent_roll_monthly: roundHalfUp(rr, 2), effective_rent_monthly: roundHalfUp(rr - amort, 2), loss_to_vacancy_monthly: roundHalfUp(ltv, 2), label: `monthly, as of ${asOf}`, amortization_rule: EFFECTIVE_RENT_RULE },
    period: { label: `monthly, as of ${asOf}`, start: asOf, end: asOf, partial: false, basis: 'units.status snapshot; leases.monthly_rent' },
    fx: null, dedup: null, unknown: false, unknown_reason: null, citations: cites,
  };
}
