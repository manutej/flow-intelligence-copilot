/**
 * Fixed, dated CAD→USD rate (D-24: fixed rate everywhere; supersedes M-3 for now). The store's default CAD rate is this
 * dated snapshot of the live provider, never an undated constant; tests use
 * the same fixture so expectations follow the rate, not a literal.
 * Refresh: run src/tools/fx-rate.ts (frankfurter, ECB) and update all three.
 */
export const PINNED_CAD_RATE = {
  rate: 0.71588,
  rate_date: '2026-10-31',
  source: 'fixed rate',
} as const;

/** "1 CAD = r USD (source, date)": every CAD answer states this. */
export function cadRateLine(p: { cadToUsdRate: number; cadRateDate: string; cadRateSource: string }): string {
  return `1 CAD = ${p.cadToUsdRate} USD (${p.cadRateSource}, ${p.cadRateDate})`;
}
