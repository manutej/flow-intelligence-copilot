/**
 * spend_by_channel (FIQ-TOOLS-1 §2.2). Total USD spend grouped by source.
 * Ruling M-10 is open: group "ILS" returns unknown until a site list exists.
 */
import type { CitationId, PortfolioStore } from '../data/schema.ts';
import { DATA_END, DATA_START, periodLabel, roundHalfUp, unknownEnvelope, type FxOut, type ToolEnvelope } from './envelope.ts';
import { convert, fxBlock, toolRate } from './currency.ts';

export const SPEND_BY_CHANNEL_DESCRIPTION =
  "Total USD spend grouped by source, optionally by building and period. Use for 'how much did we spend on Zillow / by channel'. Do NOT use for 'listing sites' or 'ILS' as a group: that returns unknown until the user gives a list of sites (M-10). Do NOT compute CPL here.";

/** M-10: no list of listing sites is defined yet. */
export const ILS_SITES: readonly string[] | null = null;
export const ILS_UNKNOWN_REASON = 'No list of listing sites is defined; name the sites to include';

export interface SpendByChannelArgs {
  readonly sources?: readonly string[];
  readonly group?: 'ILS';
  readonly property_id?: string;
  readonly start_date?: string;
  readonly end_date?: string;
}

export interface SpendByChannelValue {
  readonly by_source: Readonly<Record<string, number>>;
  readonly total_usd: number;
}

export function spendByChannel(store: PortfolioStore, args: SpendByChannelArgs = {}, fx?: FxOut): ToolEnvelope<SpendByChannelValue> {
  if (args.group === 'ILS' && !ILS_SITES) return unknownEnvelope(ILS_UNKNOWN_REASON);
  const known = new Set(store.spend.map((s) => s.source));
  const bad = (args.sources ?? []).filter((s) => !known.has(s));
  if (bad.length > 0) return unknownEnvelope(`No spend source named ${bad.map((b) => `"${b}"`).join(', ')}; known sources: ${[...known].sort().join(', ')}`);
  const wanted = args.group === 'ILS' ? new Set(ILS_SITES!) : args.sources ? new Set(args.sources) : null;
  const start = args.start_date ?? DATA_START;
  const end = args.end_date ?? DATA_END;
  const rate = toolRate(store.policy, fx);
  const operating = new Set(store.operatingProperties.map((p) => p.propertyId));
  const rows = store.spend.filter((s) => !s.isVoid && operating.has(s.propertyId)
    && (!args.property_id || s.propertyId === args.property_id) && (!wanted || wanted.has(s.source))
    && s.month >= start.slice(0, 7) && s.month <= end.slice(0, 7));
  const raw = new Map<string, number>();
  let cad = false;
  for (const s of rows) {
    if (s.currency === 'CAD') cad = true;
    raw.set(s.source, (raw.get(s.source) ?? 0) + convert(s.rawAmount, s.currency, 'USD', undefined, rate).amount);
  }
  const by_source: Record<string, number> = {};
  for (const k of [...raw.keys()].sort()) by_source[k] = roundHalfUp(raw.get(k)!, 2);
  const total = [...raw.values()].reduce((a, b) => a + b, 0);
  return {
    value: { by_source, total_usd: roundHalfUp(total, 2) },
    period: { label: periodLabel(start, end), start, end, partial: end > DATA_END, basis: 'spend.month' },
    fx: cad ? fxBlock(rate) : null,
    dedup: null, unknown: false, unknown_reason: null,
    citations: rows.slice(0, 8).map((s) => s.citationId as CitationId),
  };
}
