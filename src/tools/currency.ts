/**
 * FIQ-CURRENCY-1 (D-24): the one CAD↔USD conversion. The fixed, dated rate by
 * default; the live ECB rate only with FLOWIQ_LIVE_FX=1 (prefetched with
 * loadLiveRate, so convert stays synchronous). Every result names its rate,
 * source and date. Spec: drafts/flowiq/FIQ-CURRENCY-1-SPEC.md.
 */
import { PINNED_CAD_RATE } from '../config/fx-pinned.ts';
import { getLiveCadRate } from './fx-rate.ts';

export type Currency = 'CAD' | 'USD';
export interface Rate { readonly rate: number; readonly rate_date: string | null; readonly source: string }
export interface Converted {
  readonly amount: number;
  readonly from: Currency;
  readonly to: Currency;
  readonly rate: number;
  readonly rate_source: string;
  readonly rate_date: string | null;
  readonly date?: string;
  readonly note?: string;
}

export const FIXED_RATE: Rate = PINNED_CAD_RATE;
const live = new Map<string, Rate | null>(); // key: requested date or 'latest'

export const liveEnabled = () => process.env.FLOWIQ_LIVE_FX === '1';

/** Flag on: fetch the live rate as of `date` (Q1) via the 24h per-date cache (Q4); null when unavailable. Flag off: null, no fetch. */
export async function loadLiveRate(date?: string): Promise<Rate | null> {
  if (!liveEnabled()) return null;
  const r = await getLiveCadRate(date);
  live.set(date ?? 'latest', r);
  return r;
}
export function resetLiveRate(): void { live.clear(); }

/** The rate convert uses when none is given: live (for that date) if enabled and loaded, else fixed (labelled when live failed). */
export function currentRate(date?: string): Rate {
  const key = date ?? 'latest';
  if (liveEnabled() && live.get(key)) return live.get(key)!;
  if (liveEnabled() && live.has(key)) return { ...FIXED_RATE, source: `${FIXED_RATE.source}; live rate unavailable` };
  return FIXED_RATE;
}

/** Q3: a what-if rate, labelled; passed explicitly to convert, never cached or stored. */
export function whatIfRate(rate: number): Rate {
  return { rate, rate_date: null, source: `what-if rate ${rate}` };
}

/**
 * Convert an amount; unrounded. `date` asks for the rate as of that date (Q1); the fixed
 * source ignores it but states it in `note`. `rate` is an explicit rate (a what-if, Q3).
 */
export function convert(amount: number, from: Currency, to: Currency, date?: string, rate: Rate = currentRate(date)): Converted {
  const r = from === to ? 1 : rate.rate;
  const out = from === to ? amount : from === 'CAD' ? amount * r : amount / r;
  const fixed = rate.source.startsWith(FIXED_RATE.source);
  const note = date && fixed ? `${FIXED_RATE.source} ${rate.rate} (${rate.rate_date}); requested date ${date}` : undefined;
  return { amount: out, from, to, rate: rate.rate, rate_source: rate.source, rate_date: rate.rate_date, ...(date ? { date } : {}), ...(note ? { note } : {}) };
}

/** The rate a store-backed tool converts at: an injected fx block, else the store's policy rate (fixed unless a what-if). */
export function toolRate(policy: { cadToUsdRate: number; cadRateDate: string; cadRateSource: string }, fx?: { rate: number; rate_date: string | null; source: string }): Rate {
  return fx ? { rate: fx.rate, rate_date: fx.rate_date, source: fx.source } : { rate: policy.cadToUsdRate, rate_date: policy.cadRateDate, source: policy.cadRateSource };
}

/** A tool envelope's fx block, from the rate convert used. */
export function fxBlock(r: Rate): { applied: true; rate: number; rate_date: string | null; source: string } {
  return { applied: true, rate: r.rate, rate_date: r.rate_date, source: r.source };
}
