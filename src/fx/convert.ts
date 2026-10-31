/** The conversion tool: the only place a converted amount is computed. Cents, half away from zero. */
import type { RateQuote } from './provider.ts';
export const round2 = (x: number) => Math.sign(x) * Math.round(Math.abs(x) * 100 + 1e-9) / 100;
export function convert(amount: number, q: RateQuote): number { return round2(amount * q.rate); }
/** Panel label: "<source>, daily rate as of <date>" plus the fallback note when one applies. */
export function rateLabel(q: RateQuote): string {
  return `${q.source}, daily rate as of ${q.asOf}${q.fallbackFrom ? ` (${q.fallbackFrom} unavailable)` : ''}`;
}
