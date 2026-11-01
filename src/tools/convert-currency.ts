/** convert_currency (FIQ-TOOLS-1 §2.3, M-3). */
import { roundHalfUp, unknownEnvelope, type FxOut, type ToolEnvelope } from './envelope.ts';
import { getLiveCadRate } from './fx-rate.ts';

export const CONVERT_CURRENCY_DESCRIPTION =
  'Convert CAD to USD (or back) at the live rate, and always state the rate and its date. Use whenever an amount is in CAD. Do NOT hard-code 0.73.';

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
  if (args.from === args.to) {
    return { value: { amount_out: roundHalfUp(args.amount, 2) }, period: null, fx: null, dedup: null, unknown: false, unknown_reason: null, citations: [] };
  }
  const fx = await liveFx();
  if (!fx) return unknownEnvelope('live rate unavailable');
  const out = args.from === 'CAD' ? args.amount * fx.rate : args.amount / fx.rate;
  return { value: { amount_out: roundHalfUp(out, 2) }, period: null, fx, dedup: null, unknown: false, unknown_reason: null, citations: [] };
}
