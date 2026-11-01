/**
 * period_total (FIQ-TOOLS-1 §2.4, M-9, L-56). Sum, count or mean of a
 * measure over a resolved window. The label comes only from the window
 * summed; YTD is Jan 1 to the latest data date and partial.
 */
import type { CitationId, PortfolioStore } from '../data/schema.ts';
import { DATA_END, DATA_START, periodLabel, roundHalfUp, unknownEnvelope, type FxOut, type PeriodInput, type PeriodOut, type ToolEnvelope } from './envelope.ts';
import { uniqueLeads } from './cost-per-lead.ts';

export const PERIOD_TOTAL_DESCRIPTION =
  "Sum or count a measure over a date window: spend, leads, signed leases, concessions. Use for 'total X in Q3', 'this year', 'year to date'. YTD is Jan 1 to the latest data date and labelled partial. Do NOT use for averages unless aggregate='mean' is given.";

export { LATEST_DATA_DATE } from '../config/rules.ts';
import { LATEST_DATA_DATE } from '../config/rules.ts';
export type Measure = 'spend_usd' | 'leads' | 'signed_leases' | 'concessions_usd';

/** Resolve a period; an unrecognised one is null (the caller asks), never Apr–Sep. */
export function resolvePeriod(p: PeriodInput | undefined): { start: string; end: string; partial: boolean } | null {
  if (!p) return { start: DATA_START, end: DATA_END, partial: false };
  if ('start_date' in p) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(p.end_date) || p.start_date > p.end_date) return null;
    return { start: p.start_date, end: p.end_date, partial: p.end_date > DATA_END };
  }
  switch (p.preset) {
    case 'apr_sep_2026': return { start: DATA_START, end: DATA_END, partial: false };
    case 'q2_2026': return { start: '2026-04-01', end: '2026-06-30', partial: false };
    case 'q3_2026': return { start: '2026-07-01', end: '2026-09-30', partial: false };
    case 'ytd': return { start: '2026-01-01', end: LATEST_DATA_DATE, partial: true };
    case 'month': {
      if (!p.month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(p.month)) return null;
      const [y, m] = p.month.split('-').map(Number);
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return { start: `${p.month}-01`, end: `${p.month}-${String(last).padStart(2, '0')}`, partial: false };
    }
    default: return null;
  }
}

export interface PeriodTotalArgs {
  readonly measure: Measure;
  readonly aggregate?: 'sum' | 'count' | 'mean';
  readonly property_id?: string;
  readonly source?: string;
  readonly period?: PeriodInput;
}

const BASIS: Record<Measure, string> = { spend_usd: 'spend.month', leads: 'leads.created_date', signed_leases: 'leases.start_date', concessions_usd: 'leases.start_date' };

export function periodTotal(store: PortfolioStore, args: PeriodTotalArgs, fx?: FxOut): ToolEnvelope<{ total: number; aggregate: string; rows: number }> {
  const win = resolvePeriod(args.period);
  if (!win) return unknownEnvelope('Unrecognised period; name a month, quarter, Apr–Sep 2026, a date range or year to date');
  const { start, end } = win;
  const period: PeriodOut = { label: periodLabel(start, end), start, end, partial: win.partial, basis: BASIS[args.measure] };
  const operating = new Set(store.operatingProperties.map((p) => p.propertyId));
  const inProp = (pid: string) => operating.has(pid) && (!args.property_id || pid === args.property_id);
  const agg = args.aggregate ?? (args.measure === 'leads' || args.measure === 'signed_leases' ? 'count' : 'sum');
  let values: number[] = [];
  let cites: CitationId[] = [];
  let fxOut: FxOut | null = null;
  if (args.measure === 'spend_usd' || args.measure === 'leads') {
    if (end < DATA_START || start > DATA_END) return unknownEnvelope('No CRM or spend data outside 2026-04 to 2026-09', period);
  }
  if (args.measure === 'spend_usd') {
    const rate = fx?.rate ?? store.policy.cadToUsdRate;
    const rows = store.spend.filter((s) => !s.isVoid && inProp(s.propertyId) && (!args.source || s.source === args.source) && s.month >= start.slice(0, 7) && s.month <= end.slice(0, 7));
    values = rows.map((s) => (s.currency === 'CAD' ? s.rawAmount * rate : s.rawAmount));
    if (rows.some((s) => s.currency === 'CAD')) fxOut = fx ?? { applied: true, rate, rate_date: store.policy.cadRateDate, source: store.policy.cadRateSource };
    cites = rows.slice(0, 8).map((s) => s.citationId);
  } else if (args.measure === 'leads') {
    const rows = uniqueLeads(store).filter((l) => inProp(l.propertyId) && (!args.source || l.source === args.source) && l.createdDate >= start && l.createdDate <= end);
    values = rows.map(() => 1);
    cites = rows.slice(0, 8).map((l) => l.citationId);
  } else {
    const rows = store.leases.filter((l) => inProp(l.propertyId) && l.startDate >= start && l.startDate <= end);
    values = rows.map((l) => (args.measure === 'concessions_usd' ? l.concessionUsd : 1));
    cites = rows.slice(0, 8).map((l) => l.citationId);
  }
  if (values.length === 0) return unknownEnvelope(`No rows in ${period.label}`, period);
  const sum = values.reduce((a, b) => a + b, 0);
  const total = agg === 'count' ? values.length : agg === 'mean' ? roundHalfUp(sum / values.length, 2) : roundHalfUp(sum, 2);
  return { value: { total, aggregate: agg, rows: values.length }, period, fx: fxOut, dedup: args.measure === 'leads' ? { key: 'lease_id', kept: 'earliest' } : null, unknown: false, unknown_reason: null, citations: cites };
}
