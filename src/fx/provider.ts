/**
 * Exchange rates for the currency tool. A provider returns one daily rate with its source and
 * as-of date, or a typed failure; it never invents a rate. Conversion arithmetic lives in
 * convert.ts, never in model output or panel text.
 * - Bank of Canada Valet (primary, USD/CAD only): FXUSDCAD, CAD per USD, daily average.
 * - Frankfurter (ECB reference rates): any ECB currency; used for CAD only when the Bank of
 *   Canada lookup fails, and then labelled as such. Sources are never blended.
 * Both are keyless. No key is ever read from argv or written to logs or files.
 * A rate older than MAX_AGE_DAYS calendar days, a non-200, or a missing or non-numeric rate
 * fails closed. There is no fixed-rate fallback.
 */
export const MAX_AGE_DAYS = 4;
export interface RateQuote {
  readonly base: string; readonly quote: string;
  /** units of `quote` per one `base` */
  readonly rate: number;
  readonly source: string;
  /** the provider's observation date, YYYY-MM-DD */
  readonly asOf: string;
  /** how the rate was obtained, for the panel label */
  readonly basis: 'daily';
  /** set when a fallback provider answered because the primary failed */
  readonly fallbackFrom?: string;
}
export type RateFailure = { readonly ok: false; readonly reason: 'unsupported_pair' | 'lookup_failed' | 'bad_rate' | 'stale_rate'; readonly detail: string; readonly source: string };
export type RateResult = { readonly ok: true; readonly quote: RateQuote } | RateFailure;
export interface RateProvider { readonly name: string; rate(base: string, quote: string, now: Date): Promise<RateResult> }
export type Fetch = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const fail = (source: string, reason: RateFailure['reason'], detail: string): RateFailure => ({ ok: false, reason, detail, source });
/** A rate must be a positive finite number observed within MAX_AGE_DAYS of now. */
export function checkRate(source: string, base: string, quote: string, rate: unknown, asOf: unknown, now: Date): RateResult {
  const r = typeof rate === 'string' ? Number(rate) : rate;
  if (typeof r !== 'number' || !Number.isFinite(r) || r <= 0) return fail(source, 'bad_rate', `rate is not a positive number: ${JSON.stringify(rate)}`);
  if (typeof asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return fail(source, 'bad_rate', `no observation date: ${JSON.stringify(asOf)}`);
  const ageDays = (now.getTime() - Date.parse(`${asOf}T00:00:00Z`)) / 86_400_000;
  if (!(ageDays <= MAX_AGE_DAYS + 1)) return fail(source, 'stale_rate', `rate as of ${asOf} is older than ${MAX_AGE_DAYS} days`);
  return { ok: true, quote: { base, quote, rate: r, source, asOf, basis: 'daily' } };
}
const invert = (q: RateQuote): RateQuote => ({ ...q, base: q.quote, quote: q.base, rate: 1 / q.rate });

async function getJson(f: Fetch, url: string, timeoutMs: number): Promise<{ ok: true; body: unknown } | { ok: false; detail: string }> {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await f(url, { signal: ac.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    return { ok: true, body: await res.json() };
  } catch (e) { return { ok: false, detail: e instanceof Error ? e.name : 'request failed' }; } finally { clearTimeout(t); }
}

/** Bank of Canada Valet: USD/CAD only (FXUSDCAD); CAD→USD is 1/rate. */
export class BankOfCanadaProvider implements RateProvider {
  readonly name = 'Bank of Canada daily average';
  private readonly f: Fetch; private readonly timeoutMs: number;
  constructor(f: Fetch = fetch as unknown as Fetch, timeoutMs = 4000) { this.f = f; this.timeoutMs = timeoutMs; }
  async rate(base: string, quote: string, now: Date): Promise<RateResult> {
    const pair = `${base}/${quote}`;
    if (pair !== 'USD/CAD' && pair !== 'CAD/USD') return fail(this.name, 'unsupported_pair', `${pair} is not published by the Bank of Canada Valet FXUSDCAD series`);
    const got = await getJson(this.f, 'https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1', this.timeoutMs);
    if (!got.ok) return fail(this.name, 'lookup_failed', got.detail);
    const obs = (got.body as { observations?: Array<{ d?: string; FXUSDCAD?: { v?: unknown } }> })?.observations?.at(-1);
    const r = checkRate(this.name, 'USD', 'CAD', obs?.FXUSDCAD?.v, obs?.d, now);
    return r.ok && pair === 'CAD/USD' ? { ok: true, quote: invert(r.quote) } : r;
  }
}

/** Frankfurter (ECB reference rates), base USD. */
export class FrankfurterProvider implements RateProvider {
  readonly name = 'ECB reference rate via Frankfurter';
  private readonly f: Fetch; private readonly timeoutMs: number;
  constructor(f: Fetch = fetch as unknown as Fetch, timeoutMs = 4000) { this.f = f; this.timeoutMs = timeoutMs; }
  async rate(base: string, quote: string, now: Date): Promise<RateResult> {
    if (!/^[A-Z]{3}$/.test(base) || !/^[A-Z]{3}$/.test(quote)) return fail(this.name, 'unsupported_pair', `${base}/${quote}`);
    const got = await getJson(this.f, `https://api.frankfurter.dev/v1/latest?base=${base}&symbols=${quote}`, this.timeoutMs);
    if (!got.ok) return fail(this.name, 'lookup_failed', got.detail);
    const b = got.body as { date?: unknown; rates?: Record<string, unknown> };
    return checkRate(this.name, base, quote, b?.rates?.[quote], b?.date, now);
  }
}

/**
 * Primary then fallback, one source per answer: the fallback's quote is labelled with the
 * primary it replaced. A pair the primary does not publish goes to the fallback unlabelled
 * as a fallback (it is that pair's only source). Quotes are cached per pair for the process
 * so a panel and its re-check see the same rate.
 */
export class ChainProvider implements RateProvider {
  readonly name: string;
  private readonly cache = new Map<string, { at: number; r: RateResult }>();
  private readonly primary: RateProvider; private readonly fallback: RateProvider | null; private readonly ttlMs: number;
  constructor(primary: RateProvider, fallback: RateProvider | null, ttlMs = 10 * 60_000) {
    this.primary = primary; this.fallback = fallback; this.ttlMs = ttlMs;
    this.name = fallback ? `${primary.name}, else ${fallback.name}` : primary.name;
  }
  async rate(base: string, quote: string, now: Date): Promise<RateResult> {
    const k = `${base}/${quote}`; const hit = this.cache.get(k);
    if (hit && now.getTime() - hit.at < this.ttlMs) return hit.r;
    const p = await this.primary.rate(base, quote, now);
    let r: RateResult = p;
    if (!p.ok && this.fallback) {
      const f = await this.fallback.rate(base, quote, now);
      r = f.ok && p.reason !== 'unsupported_pair' ? { ok: true, quote: { ...f.quote, fallbackFrom: p.source } } : f.ok ? f : p.reason === 'unsupported_pair' ? f : p;
    }
    if (r.ok) this.cache.set(k, { at: now.getTime(), r });
    return r;
  }
}

let current: RateProvider | null = null;
/** The process provider: GENUI_FX=off disables lookups (every conversion is IDK). */
export function rateProvider(): RateProvider {
  if (current) return current;
  if (process.env.GENUI_FX === 'off') return (current = { name: 'disabled', rate: async () => fail('disabled', 'lookup_failed', 'currency lookups are disabled (GENUI_FX=off)') });
  return (current = new ChainProvider(new BankOfCanadaProvider(), new FrankfurterProvider()));
}
/** Tests and embedders inject a provider (a fake, never the network, in tests). */
export function setRateProvider(p: RateProvider | null): void { current = p; }
