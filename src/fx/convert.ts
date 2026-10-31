/** The conversion tool: the only place a converted amount is computed. Cents, half away from zero. */
import type { RateQuote } from './provider.ts';
export const round2 = (x: number) => Math.sign(x) * Math.round(Math.abs(x) * 100 + 1e-9) / 100;
export function convert(amount: number, q: RateQuote): number { return round2(amount * q.rate); }
/** Panel label: "<source>, daily rate as of <date>" plus the fallback note when one applies. */
export function rateLabel(q: RateQuote): string {
  return `${q.source}, daily rate as of ${q.asOf}${q.fallbackFrom ? ` (${q.fallbackFrom} unavailable)` : ''}`;
}

const money = (v: number, code: string) => v.toLocaleString('en-US', { style: 'currency', currency: code, currencyDisplay: 'code' });
/** The fields of a converted answer (the fx evidence item's result). */
export interface FxResult { readonly usd: number; readonly rate: number; readonly converted: number; readonly quote: string; readonly label: string; readonly kit_rate?: number }
/**
 * The converted panel's sentence, in the asked currency, written only from the fx result. When
 * the US-dollar figure itself holds CAD-billed rows, it says they were posted at the data kit's
 * fixed rate (KIT_README), which this conversion does not change.
 */
export function fxAnswer(r: FxResult): string {
  const kit = r.kit_rate === undefined ? '' : ` CAD-billed rows inside the US-dollar figure were posted at the data kit's fixed 1 CAD = ${r.kit_rate} USD (KIT_README), not at this rate.`;
  return `${money(r.converted, r.quote)}, converted by the currency tool from ${money(r.usd, 'USD')} at ${r.rate} ${r.quote} per USD (${r.label}).${kit}`;
}
