/**
 * cost_per_lead (FIQ-TOOLS-1 §2.1): the one definition of cost per lead.
 *
 * Spend in USD divided by unique leads (same person counted once) for a
 * building, source or portfolio over a period. Use for "cost per lead",
 * "CPL", "what does a lead cost". Do NOT use for cost per signed lease or
 * tour, or for raw spend (use spend_by_channel).
 *
 * Ruling M-2: "same person" means the same lease. Two or more leads that
 * point at one lease_id are one person, credited to the earliest
 * (created_date, then lead_id); this drops 9 of 1,498 leads. Dedup is
 * unconditional: no policy switch turns it off.
 */
import type { CitationId, PortfolioStore } from '../data/schema.ts';
import { DATA_END, DATA_START, periodLabel, roundHalfUp, type FxOut, type ToolEnvelope } from './envelope.ts';

export const COST_PER_LEAD_DESCRIPTION =
  "Spend in USD divided by unique leads (same person counted once) for a building, source or portfolio over a period. Use for 'cost per lead', 'CPL', 'what does a lead cost'. Do NOT use for cost per signed lease or tour (use cost_per_signed_lease), or for raw spend (use spend_by_channel).";

export interface CostPerLeadArgs {
  readonly property_id?: string;
  readonly source?: string;
  /** Inclusive ISO dates; the default is the whole data window. */
  readonly start_date?: string;
  readonly end_date?: string;
  readonly paid_leads_only?: boolean;
}

export interface CostPerLeadValue {
  readonly cpl_usd: number | null;
  readonly spend_usd: number;
  readonly unique_leads: number;
  readonly duplicates_removed: number;
  readonly free_source?: boolean;
}

/** One person per lease: drop every lead that is not the earliest for its lease. */
export function uniqueLeads(store: PortfolioStore) {
  return store.leads.filter((l) => !l.isDuplicateForLease);
}

export function costPerLead(store: PortfolioStore, args: CostPerLeadArgs = {}, fx?: FxOut): ToolEnvelope<CostPerLeadValue> {
  const start = args.start_date ?? DATA_START;
  const end = args.end_date ?? DATA_END;
  const rate = fx?.rate ?? store.policy.cadToUsdRate;
  const fxOut: FxOut = fx ?? { applied: true, rate, rate_date: null, source: 'policy rate (FLOW_CAD_RATE)' };
  const operating = new Set(store.operatingProperties.map((p) => p.propertyId));
  const inScope = (pid: string, src: string) =>
    operating.has(pid) && (!args.property_id || pid === args.property_id) && (!args.source || src === args.source);

  const spendRows = store.spend.filter((s) => !s.isVoid && inScope(s.propertyId, s.source) && s.month >= start.slice(0, 7) && s.month <= end.slice(0, 7));
  let cadUsed = false;
  const spend = spendRows.reduce((t, s) => {
    if (s.currency === 'CAD') { cadUsed = true; return t + s.rawAmount * rate; }
    return t + s.rawAmount;
  }, 0);

  const paid = new Set(store.paidSources);
  const inWindow = (l: { createdDate: string; propertyId: string; source: string }) =>
    l.createdDate >= start && l.createdDate <= end && inScope(l.propertyId, l.source) && (args.source || !args.paid_leads_only || paid.has(l.source));
  const all = store.leads.filter(inWindow);
  const uniq = uniqueLeads(store).filter(inWindow);
  const freeSource = args.source !== undefined && !paid.has(args.source);

  const citations: CitationId[] = [...spendRows.slice(0, 6).map((s) => s.citationId), ...uniq.slice(0, 2).map((l) => l.citationId)];
  return {
    value: {
      cpl_usd: freeSource || uniq.length === 0 ? null : roundHalfUp(spend / uniq.length, 2),
      spend_usd: roundHalfUp(spend, 2),
      unique_leads: uniq.length,
      duplicates_removed: all.length - uniq.length,
      ...(freeSource ? { free_source: true } : {}),
    },
    period: {
      label: periodLabel(start, end),
      start,
      end,
      partial: end > DATA_END,
      basis: 'leads.created_date; spend by whole spend.month',
    },
    fx: cadUsed ? fxOut : null,
    dedup: { key: 'lease_id', kept: 'earliest' },
    unknown: false,
    unknown_reason: null,
    citations,
  };
}
