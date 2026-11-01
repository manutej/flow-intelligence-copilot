/** convert_currency (FIQ-TOOLS-1 §2.3, M-3). */
import { roundHalfUp, unknownEnvelope, type FxOut, type ToolEnvelope } from './envelope.ts';
import { getLiveCadRate } from './fx-rate.ts';
import { convert, fxBlock, liveEnabled, loadLiveRate } from './currency.ts';

export const CONVERT_CURRENCY_DESCRIPTION =
  'Convert CAD to USD (or back) at the fixed dated rate (live only when enabled), and always state the rate, its source and its date. Use whenever an amount is in CAD. Do NOT hard-code 0.73.';

export interface ConvertArgs { readonly amount: number; readonly from: 'CAD' | 'USD'; readonly to: 'CAD' | 'USD' }

/** The live fx block for other tools (cost_per_lead, spend_by_channel), or null. */
export async function liveFx(): Promise<FxOut | null> {
  const r = await getLiveCadRate();
  return r ? { applied: true, rate: r.rate, rate_date: r.rate_date, source: r.source } : null;
}

export function fxLine(fx: FxOut): string {
  return `1 CAD = ${fx.rate} USD (${fx.source}${fx.rate_date ? `, ${fx.rate_date}` : ''})`;
}

export async function convertCurrency(args: ConvertArgs): Promise<ToolEnvelope<{ amount_out: number }>> {
  if (!Number.isFinite(args.amount)) return unknownEnvelope('amount is not a number');
  // D-24 / FIQ-CURRENCY-1: the currency tool decides the rate (fixed unless FLOWIQ_LIVE_FX=1).
  if (liveEnabled()) await loadLiveRate();
  const c = convert(args.amount, args.from, args.to);
  const fx = args.from === args.to ? null : fxBlock({ rate: c.rate, rate_date: c.rate_date, source: c.rate_source });
  return { value: { amount_out: roundHalfUp(c.amount, 2) }, period: null, fx, dedup: null, unknown: false, unknown_reason: null, citations: [] };
}
