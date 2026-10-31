// The currency tool's rate providers, against fake fetch responses only (never the network):
// the Bank of Canada and Frankfurter shapes, 1/rate for CAD to USD, failing closed on an HTTP
// error, a missing or non-numeric rate, or a rate older than MAX_AGE_DAYS, and the fallback label.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BankOfCanadaProvider, FrankfurterProvider, ChainProvider, MAX_AGE_DAYS, type Fetch } from '../src/fx/provider.ts';
import { convert, rateLabel } from '../src/fx/convert.ts';

const now = new Date('2026-10-30T15:00:00Z');
const reply = (status: number, body: unknown): Fetch => async () => ({ ok: status === 200, status, json: async () => body });
const boc = (v: unknown, d = '2026-10-29') => reply(200, { observations: [{ d: '2026-10-28', FXUSDCAD: { v: '1.3900' } }, { d, FXUSDCAD: { v } }] });
const ff = (rate: unknown, date = '2026-10-29') => reply(200, { base: 'USD', date, rates: { CAD: rate } });

test('Bank of Canada: the latest observation, CAD per USD, labelled with its date', async () => {
  const r = await new BankOfCanadaProvider(boc('1.3962')).rate('USD', 'CAD', now);
  assert.ok(r.ok); assert.equal(r.quote.rate, 1.3962); assert.equal(r.quote.asOf, '2026-10-29');
  assert.equal(rateLabel(r.quote), 'Bank of Canada daily average, daily rate as of 2026-10-29');
  assert.equal(convert(1000, r.quote), 1396.2);
});
test('CAD to USD is 1/rate', async () => {
  const r = await new BankOfCanadaProvider(boc('1.25')).rate('CAD', 'USD', now);
  assert.ok(r.ok); assert.equal(r.quote.rate, 0.8); assert.equal(r.quote.base, 'CAD');
});
test('fails closed: HTTP error, missing, non-numeric, zero, stale', async () => {
  const cases: Array<[Fetch, string]> = [
    [reply(503, {}), 'lookup_failed'], [async () => { throw new TypeError('fetch failed'); }, 'lookup_failed'],
    [reply(200, { observations: [] }), 'bad_rate'], [boc('n/a'), 'bad_rate'], [boc(0), 'bad_rate'],
    [boc('1.39', '2026-10-20'), 'stale_rate'],
  ];
  for (const [f, reason] of cases) {
    const r = await new BankOfCanadaProvider(f).rate('USD', 'CAD', now);
    assert.equal(r.ok, false); assert.equal(!r.ok && r.reason, reason);
  }
  const edge = await new BankOfCanadaProvider(boc('1.39', '2026-10-26')).rate('USD', 'CAD', now);
  assert.ok(edge.ok, `a rate ${MAX_AGE_DAYS} days old (a long weekend) still answers`);
});
test('Bank of Canada publishes USD/CAD only', async () => {
  const r = await new BankOfCanadaProvider(boc('1.39')).rate('USD', 'EUR', now);
  assert.equal(!r.ok && r.reason, 'unsupported_pair');
});
test('Frankfurter shape, and its own failures', async () => {
  const r = await new FrankfurterProvider(ff(1.4011)).rate('USD', 'CAD', now);
  assert.ok(r.ok); assert.equal(r.quote.rate, 1.4011); assert.equal(r.quote.source, 'ECB reference rate via Frankfurter');
  assert.equal((await new FrankfurterProvider(ff(null)).rate('USD', 'CAD', now)).ok, false);
  assert.equal((await new FrankfurterProvider(ff(1.4, '2026-10-01')).rate('USD', 'CAD', now)).ok, false);
});
test('chain: the fallback answers only when the primary fails, and says so; never blended', async () => {
  const ok = await new ChainProvider(new BankOfCanadaProvider(boc('1.3962')), new FrankfurterProvider(ff(1.5))).rate('USD', 'CAD', now);
  assert.ok(ok.ok); assert.equal(ok.quote.rate, 1.3962); assert.equal(ok.quote.fallbackFrom, undefined);
  const fb = await new ChainProvider(new BankOfCanadaProvider(reply(500, {})), new FrankfurterProvider(ff(1.4011))).rate('USD', 'CAD', now);
  assert.ok(fb.ok); assert.equal(fb.quote.rate, 1.4011);
  assert.equal(rateLabel(fb.quote), 'ECB reference rate via Frankfurter, daily rate as of 2026-10-29 (Bank of Canada daily average unavailable)');
  const both = await new ChainProvider(new BankOfCanadaProvider(reply(500, {})), new FrankfurterProvider(reply(500, {}))).rate('USD', 'CAD', now);
  assert.equal(both.ok, false);
  // a pair the primary does not publish is the fallback's own answer, not a fallback
  const eur = await new ChainProvider(new BankOfCanadaProvider(boc('1.39')), new FrankfurterProvider(reply(200, { date: '2026-10-29', rates: { EUR: 0.92 } }))).rate('USD', 'EUR', now);
  assert.ok(eur.ok); assert.equal(eur.quote.fallbackFrom, undefined);
});
test('chain caches a quote so a panel and its re-check see one rate', async () => {
  let n = 0;
  const f: Fetch = async () => { n++; return { ok: true, status: 200, json: async () => ({ observations: [{ d: '2026-10-29', FXUSDCAD: { v: String(1.39 + n / 100) } }] }) }; };
  const c = new ChainProvider(new BankOfCanadaProvider(f), null);
  const a = await c.rate('USD', 'CAD', now), b = await c.rate('USD', 'CAD', new Date(now.getTime() + 60_000));
  assert.ok(a.ok && b.ok); assert.equal(a.quote.rate, b.quote.rate); assert.equal(n, 1);
});
