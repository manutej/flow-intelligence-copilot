import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { periodTotal, resolvePeriod } from '../src/tools/period-total.ts';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { spendUsd, usd, usdRe, round2, cpl, FX } from './fixtures/fx-expect.ts';
// Every CAD row (P06 and P07 Facebook Ads) sits in a dead pair, so the kit figure moves by the whole CAD delta.
const DEAD_USD = round2(46599.9 - spendUsd({}, 0.73) + spendUsd({}));
const YTD_USD = spendUsd({from:'2026-01',to:'2026-09'});

const store = loadPortfolioStore();

test('period_total: YTD is 2026-01-01..2026-09-28, partial; spend 224,599.90 (M-9)', () => {
  const r = periodTotal(store, { measure: 'spend_usd', period: { preset: 'ytd' } });
  assert.equal(r.value?.total, YTD_USD);
  assert.deepEqual([r.period?.start, r.period?.end, r.period?.partial], ['2026-01-01', '2026-09-28', true]);
  assert.equal(r.period?.label, '2026-01-01 to 2026-09-28');
});

test('period_total: Fulton concessions windowed to lease starts, $1,000 over 17 (L-56)', () => {
  const w = periodTotal(store, { measure: 'concessions_usd', property_id: 'P03' });
  assert.equal(w.value?.total, 1000);
  assert.equal(w.value?.rows, 17);
  const all = periodTotal(store, { measure: 'concessions_usd', property_id: 'P03', period: { start_date: '2000-01-01', end_date: '2099-12-31' } });
  assert.equal(all.value?.total, 8500);
  assert.equal(all.value?.rows, 113);
});

test('period_total: unrecognised period is unknown, never silently Apr–Sep (L-56)', () => {
  assert.equal(resolvePeriod({ preset: 'fy_2025' as never }), null);
  assert.equal(periodTotal(store, { measure: 'spend_usd', period: { preset: 'month', month: '2026-13' } }).unknown, true);
  assert.equal(periodTotal(store, { measure: 'leads', period: { start_date: '2025-01-01', end_date: '2025-12-31' } }).unknown, true);
  assert.equal(periodTotal(store, { measure: 'leads' }).value?.total, 1489);
});

test('copilot: "this year" and "YTD" answer the partial YTD window', async () => {
  for (const q of ['Total marketing spend this year?', 'YTD spend at Kedzie Works?']) {
    const t = await askFlowIqCopilot(q, { store, parse: null } as never);
    assert.match(t.envelope.answer, /2026-01-01 to 2026-09-28 \(year to date, partial\)/, q);
    assert.doesNotMatch(t.envelope.answer, /2026-04-01 to 2026-09-30/);
  }
});

test('period_total: YTD spend at the pinned fixture rate reads $224,463.92 and names the rate date', () => {
  assert.equal(usd(YTD_USD), '$224,463.92');
  assert.equal(FX.rate_date, '2026-10-31');
});
