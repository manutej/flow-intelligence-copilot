import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { spendByChannel, SPEND_BY_CHANNEL_DESCRIPTION } from '../src/tools/spend-by-channel.ts';

const store = loadPortfolioStore();

test('spend_by_channel: kit-rate totals match truth', () => {
  const r = spendByChannel(store);
  assert.deepEqual(r.value?.by_source, { 'Apartment List': 8900, 'Apartments.com': 84560, 'Facebook Ads': 14939.9, 'Google Ads': 36550, 'Rent.': 22460, Zillow: 57190 });
  assert.equal(r.value?.total_usd, 224599.9);
  assert.equal(r.fx?.applied, true);
});

test('spend_by_channel: live-rate fx is honoured', () => {
  const r = spendByChannel(store, {}, { applied: true, rate: 0.71588, rate_date: '2026-10-30', source: 'stub' });
  assert.equal(r.value?.by_source['Facebook Ads'], 14803.92);
  assert.equal(r.value?.total_usd, 224463.92);
});

test('spend_by_channel: ILS group is unknown (M-10); unknown source is unknown, not 0', () => {
  const ils = spendByChannel(store, { group: 'ILS' });
  assert.equal(ils.unknown, true);
  assert.match(ils.unknown_reason!, /listing sites/);
  assert.equal(spendByChannel(store, { sources: ['Craigslist'] }).unknown, true);
  assert.equal(spendByChannel(store, { sources: ['Rent.'] }).value?.total_usd, 22460);
  assert.match(SPEND_BY_CHANNEL_DESCRIPTION, /ILS/);
});

test('copilot: spend on ILS / listing sites declines with the M-10 reason', async () => {
  const { askFlowIqCopilot } = await import('../src/agent/copilot.ts');
  for (const q of ['How much did we spend on ILS?', 'Spend on listing sites in Q3 2026?']) {
    const t = await askFlowIqCopilot(q, { store, parse: null } as never);
    assert.equal((t.envelope.result as { unknown?: boolean }).unknown, true, q);
    assert.match(t.envelope.answer, /listing sites/);
  }
});
