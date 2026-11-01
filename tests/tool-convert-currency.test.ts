import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { convertCurrency, liveFx, fxLine, CONVERT_CURRENCY_DESCRIPTION } from '../src/tools/convert-currency.ts';
import { setRateSource, resetRateSource, setClock, getLiveCadRate, LIVE_CACHE_TTL_MS } from '../src/tools/fx-rate.ts';
import { convert, resetLiveRate, FIXED_RATE, whatIfRate, loadLiveRate } from '../src/tools/currency.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { costPerLead } from '../src/tools/cost-per-lead.ts';
import { spendByChannel } from '../src/tools/spend-by-channel.ts';

const STUB = { rate: 0.7, rate_date: '2026-11-02', source: 'frankfurter (ECB)' };
afterEach(() => { resetRateSource(); resetLiveRate(); delete process.env.FLOWIQ_LIVE_FX; });

test('currency.convert: fixed dated rate by default; carries rate, source and date', () => {
  const c = convert(9630, 'CAD', 'USD', '2026-09-30');
  assert.equal(Math.round(c.amount * 100) / 100, 6893.92);
  assert.deepEqual({ rate: c.rate, src: c.rate_source, d: c.rate_date, at: c.date }, { rate: 0.71588, src: 'fixed rate', d: '2026-10-31', at: '2026-09-30' });
  assert.equal(convert(7158.8, 'USD', 'CAD').amount, 10000);
  assert.equal(convert(5, 'USD', 'USD').amount, 5);
});

test('convert_currency: fixed by default, even when a live rate exists (D-24)', async () => {
  setRateSource(async () => STUB);
  const r = await convertCurrency({ amount: 9630, from: 'CAD', to: 'USD' });
  assert.equal(r.value?.amount_out, 6893.92);
  assert.equal(fxLine(r.fx!), '1 CAD = 0.71588 USD (fixed rate, 2026-10-31)');
});

test('convert_currency: FLOWIQ_LIVE_FX=1 uses the live rate, dated', async () => {
  process.env.FLOWIQ_LIVE_FX = '1';
  setRateSource(async () => STUB);
  const r = await convertCurrency({ amount: 1000, from: 'CAD', to: 'USD' });
  assert.equal(r.value?.amount_out, 700);
  assert.equal(fxLine(r.fx!), '1 CAD = 0.7 USD (frankfurter (ECB), 2026-11-02)');
});

test('convert_currency: flag on but no live rate uses the fixed rate and says so', async () => {
  process.env.FLOWIQ_LIVE_FX = '1';
  setRateSource(async () => null);
  const r = await convertCurrency({ amount: 100, from: 'CAD', to: 'USD' });
  assert.equal(r.fx?.rate, FIXED_RATE.rate);
  assert.match(r.fx!.source, /live rate unavailable/);
  assert.doesNotMatch(CONVERT_CURRENCY_DESCRIPTION, /use 0\.73/);
});

test('an injected fx block feeds the other tools', async () => {
  setRateSource(async () => ({ rate: 0.71588, rate_date: '2026-10-30', source: 'stub' }));
  const fx = (await liveFx())!;
  const store = loadPortfolioStore();
  assert.equal(costPerLead(store, {}, fx).value?.cpl_usd, 150.75);
  assert.equal(costPerLead(store, { property_id: 'P07' }, fx).value?.cpl_usd, 147.06);
  assert.equal(spendByChannel(store, {}, fx).value?.total_usd, 224463.92);
  assert.equal(costPerLead(store, {}, fx).fx?.rate_date, '2026-10-30');
});

test('Q1: fixed source ignores the requested date but states it; live uses the rate as of that date', async () => {
  assert.equal(convert(100, 'CAD', 'USD', '2026-06-30').note, 'fixed rate 0.71588 (2026-10-31); requested date 2026-06-30');
  assert.equal(convert(100, 'CAD', 'USD').note, undefined);
  process.env.FLOWIQ_LIVE_FX = '1';
  const asked: (string | undefined)[] = [];
  setRateSource(async (d) => { asked.push(d); return { rate: d === '2026-06-30' ? 0.73 : 0.7, rate_date: d ?? '2026-11-02', source: 'frankfurter (ECB)' }; });
  await loadLiveRate('2026-06-30');
  const c = convert(100, 'CAD', 'USD', '2026-06-30');
  assert.deepEqual([c.rate, c.rate_date, c.note], [0.73, '2026-06-30', undefined]);
  assert.deepEqual(asked, ['2026-06-30']);
});

test('Q3: what-if rate is explicit, labelled, never cached or stored', async () => {
  const c = convert(1000, 'CAD', 'USD', undefined, whatIfRate(0.8));
  assert.deepEqual([c.amount, c.rate_source], [800, 'what-if rate 0.8']);
  assert.equal(convert(1000, 'CAD', 'USD').rate, 0.71588);
  const store = loadPortfolioStore(undefined, { cadToUsdRate: 0.8 });
  assert.equal(store.policy.cadRateSource, 'what-if rate 0.8');
  assert.equal(loadPortfolioStore().policy.cadToUsdRate, 0.71588);
});

test('Q4: live cache keyed by date, 24-hour expiry', async () => {
  let t = 0; let calls = 0;
  setClock(() => t);
  setRateSource(async (d) => { calls++; return { rate: 0.7, rate_date: d ?? 'latest', source: 's' }; });
  await getLiveCadRate(); await getLiveCadRate();
  assert.equal(calls, 1);
  await getLiveCadRate('2026-06-30');
  assert.equal(calls, 2);
  t = LIVE_CACHE_TTL_MS - 1; await getLiveCadRate();
  assert.equal(calls, 2);
  t = LIVE_CACHE_TTL_MS; await getLiveCadRate();
  assert.equal(calls, 3);
});
