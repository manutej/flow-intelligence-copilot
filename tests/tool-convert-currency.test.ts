import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { convertCurrency, liveFx, fxLine, CONVERT_CURRENCY_DESCRIPTION } from '../src/tools/convert-currency.ts';
import { setRateSource, resetRateSource } from '../src/tools/fx-rate.ts';
import { convert, resetLiveRate, FIXED_RATE } from '../src/tools/currency.ts';
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
