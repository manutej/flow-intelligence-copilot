import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { convertCurrency, liveFx, fxLine, CONVERT_CURRENCY_DESCRIPTION } from '../src/tools/convert-currency.ts';
import { setRateSource, resetRateSource } from '../src/tools/fx-rate.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { costPerLead } from '../src/tools/cost-per-lead.ts';
import { spendByChannel } from '../src/tools/spend-by-channel.ts';

const STUB = { rate: 0.71588, rate_date: '2026-10-30', source: 'frankfurter (ECB)' };
afterEach(() => resetRateSource());

test('convert_currency: stubbed live rate, rate and date stated', async () => {
  setRateSource(async () => STUB);
  const r = await convertCurrency({ amount: 9630, from: 'CAD', to: 'USD' });
  assert.equal(r.value?.amount_out, 6893.92);
  assert.deepEqual(r.fx, { applied: true, ...STUB });
  assert.equal(fxLine(r.fx!), '1 CAD = 0.71588 USD (frankfurter (ECB), 2026-10-30)');
  assert.equal((await convertCurrency({ amount: 7158.8, from: 'USD', to: 'CAD' })).value?.amount_out, 10000);
});

test('convert_currency: fetch failure is unknown, never a silent 0.73', async () => {
  setRateSource(async () => null);
  const r = await convertCurrency({ amount: 100, from: 'CAD', to: 'USD' });
  assert.equal(r.unknown, true);
  assert.equal(r.unknown_reason, 'live rate unavailable');
  assert.doesNotMatch(CONVERT_CURRENCY_DESCRIPTION, /use 0\.73/);
});

test('live fx feeds the other tools: truth at 0.71588', async () => {
  setRateSource(async () => STUB);
  const fx = (await liveFx())!;
  const store = loadPortfolioStore();
  assert.equal(costPerLead(store, {}, fx).value?.cpl_usd, 150.75);
  assert.equal(costPerLead(store, { property_id: 'P06' }, fx).value?.cpl_usd, 168.68);
  assert.equal(costPerLead(store, { property_id: 'P07' }, fx).value?.cpl_usd, 147.06);
  assert.equal(costPerLead(store, { source: 'Facebook Ads' }, fx).value?.cpl_usd, 124.4);
  assert.equal(spendByChannel(store, {}, fx).value?.total_usd, 224463.92);
  assert.equal(costPerLead(store, {}, fx).fx?.rate_date, '2026-10-30');
});
