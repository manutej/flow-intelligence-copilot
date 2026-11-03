/**
 * Live CAD→USD rate source (M-3). Fetched from a pinned provider (frankfurter,
 * ECB), cached per date for 24h. A failed fetch yields null; currency.ts then
 * uses the fixed rate labelled "live rate unavailable". Tests inject a stub via setRateSource.
 */
export interface LiveRate { readonly rate: number; readonly rate_date: string; readonly source: string }
export type RateSource = (date?: string) => Promise<LiveRate | null>;

export const FRANKFURTER_URL = 'https://api.frankfurter.app/latest?from=CAD&to=USD';
const frankfurterUrl = (date?: string) => (date ? FRANKFURTER_URL.replace('latest', date) : FRANKFURTER_URL);

export const frankfurterSource: RateSource = async (date) => {
  try {
    const res = await fetch(frankfurterUrl(date), { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { date?: string; rates?: { USD?: number } };
    const rate = j.rates?.USD;
    if (typeof rate !== 'number' || !(rate > 0) || typeof j.date !== 'string') return null;
    return { rate, rate_date: j.date, source: 'frankfurter (ECB)' };
  } catch { return null; }
};

/** FIQ-CURRENCY-1 Q4: cache keyed by requested date ('latest' when none), 24-hour expiry. */
export const LIVE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let source: RateSource = frankfurterSource;
let now: () => number = Date.now;
const cache = new Map<string, { at: number; p: Promise<LiveRate | null> }>();

export function setRateSource(s: RateSource): void { source = s; cache.clear(); }
export function resetRateSource(): void { setRateSource(frankfurterSource); now = Date.now; }
/** Test hook: the clock used for cache expiry. */
export function setClock(c: () => number): void { now = c; }

/** Live rate as of `date` (latest when omitted), cached per date for 24h; a failure is not cached. */
export async function getLiveCadRate(date?: string): Promise<LiveRate | null> {
  const key = date ?? 'latest';
  const hit = cache.get(key);
  if (!hit || now() - hit.at >= LIVE_CACHE_TTL_MS) cache.set(key, { at: now(), p: source(date) });
  const r = await cache.get(key)!.p;
  if (!r) cache.delete(key);
  return r;
}
