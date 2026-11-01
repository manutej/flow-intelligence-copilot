/**
 * Live CAD→USD rate source (M-3). Fetched once per session from a pinned
 * provider (frankfurter, ECB) and cached with its date. A failed fetch
 * yields null: callers return unknown ("live rate unavailable") and never
 * fall back to 0.73 silently. Tests inject a stub via setRateSource.
 */
export interface LiveRate { readonly rate: number; readonly rate_date: string; readonly source: string }
export type RateSource = () => Promise<LiveRate | null>;

export const FRANKFURTER_URL = 'https://api.frankfurter.app/latest?from=CAD&to=USD';

export const frankfurterSource: RateSource = async () => {
  try {
    const res = await fetch(FRANKFURTER_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { date?: string; rates?: { USD?: number } };
    const rate = j.rates?.USD;
    if (typeof rate !== 'number' || !(rate > 0) || typeof j.date !== 'string') return null;
    return { rate, rate_date: j.date, source: 'frankfurter (ECB)' };
  } catch { return null; }
};

let source: RateSource = frankfurterSource;
let cached: Promise<LiveRate | null> | null = null;

export function setRateSource(s: RateSource): void { source = s; cached = null; }
export function resetRateSource(): void { setRateSource(frankfurterSource); }

/** Session-cached live rate; a failure is not cached so the next call retries. */
export async function getLiveCadRate(): Promise<LiveRate | null> {
  if (!cached) cached = source();
  const r = await cached;
  if (!r) cached = null;
  return r;
}
