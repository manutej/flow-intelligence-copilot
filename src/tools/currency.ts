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
}

export const FIXED_RATE: Rate = PINNED_CAD_RATE;
let live: Rate | null = null;
let liveTried = false;

export const liveEnabled = () => process.env.FLOWIQ_LIVE_FX === '1';

/** Flag on: fetch and cache the live rate (null when unavailable). Flag off: null, no fetch. */
export async function loadLiveRate(): Promise<Rate | null> {
  if (!liveEnabled()) return null;
  liveTried = true;
  live = await getLiveCadRate();
  return live;
}
export function resetLiveRate(): void { live = null; liveTried = false; }

/** The rate convert uses when none is given: live if enabled and loaded, else fixed (saying so when live failed). */
export function currentRate(): Rate {
  if (liveEnabled() && live) return live;
  if (liveEnabled() && liveTried) return { ...FIXED_RATE, source: `${FIXED_RATE.source}; live rate unavailable` };
  return FIXED_RATE;
}

/** Convert an amount; unrounded. `rate` is an explicit CAD→USD rate (a what-if); otherwise currentRate(). */
export function convert(amount: number, from: Currency, to: Currency, date?: string, rate: Rate = currentRate()): Converted {
  const r = from === to ? 1 : rate.rate;
  const out = from === to ? amount : from === 'CAD' ? amount * r : amount / r;
  return { amount: out, from, to, rate: rate.rate, rate_source: rate.source, rate_date: rate.rate_date, ...(date ? { date } : {}) };
}

/** The rate a store-backed tool converts at: an injected fx block, else the store's policy rate (fixed unless a what-if). */
export function toolRate(policy: { cadToUsdRate: number; cadRateDate: string; cadRateSource: string }, fx?: { rate: number; rate_date: string | null; source: string }): Rate {
  return fx ? { rate: fx.rate, rate_date: fx.rate_date, source: fx.source } : { rate: policy.cadToUsdRate, rate_date: policy.cadRateDate, source: policy.cadRateSource };
}

/** A tool envelope's fx block, from the rate convert used. */
export function fxBlock(r: Rate): { applied: true; rate: number; rate_date: string | null; source: string } {
  return { applied: true, rate: r.rate, rate_date: r.rate_date, source: r.source };
}
