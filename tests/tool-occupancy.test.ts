import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { occupancy } from '../src/tools/occupancy.ts';

const store = loadPortfolioStore();

test('occupancy: portfolio 1,033/1,100 = 93.9%, vacancy 6.1%', () => {
  const v = occupancy(store).value!;
  assert.deepEqual([v.units, v.occupied, v.notice, v.vacant, v.occupied_share_pct, v.vacancy_pct], [1100, 994, 39, 67, 93.9, 6.1]);
  for (const [m, c] of Object.entries({ '2026-10': 137, '2026-11': 149, '2026-12': 157, '2027-01': 146, '2027-02': 140, '2027-03': 140 })) assert.equal(v.expirations[m], c, m);
});

test('occupancy: P06 is lowest at 87.3%; P09 is not operating', () => {
  const rates = store.operatingProperties.map((p) => [p.propertyId, occupancy(store, { property_id: p.propertyId }).value!.occupied_share_pct] as const);
  const low = rates.reduce((a, b) => (b[1] < a[1] ? b : a));
  assert.deepEqual(low, ['P06', 87.3]);
  assert.equal(occupancy(store, { property_id: 'P09' }).unknown, true);
});

test('occupancy: expirations window labelled from end_date', () => {
  const r = occupancy(store, { expirations_window: { preset: 'month', month: '2026-11' } });
  assert.deepEqual(r.value?.expirations, { '2026-11': 149 });
  assert.equal(r.period?.label, '2026-11-01 to 2026-11-30');
});

test('copilot: bare "occupancy" answers from the tool (93.9%, P06 87.3%)', async () => {
  const { askFlowIqCopilot } = await import('../src/agent/copilot.ts');
  const a = await askFlowIqCopilot('What is our occupancy?', { store, parse: null } as never);
  assert.equal((a.envelope.result as { percent?: number }).percent, 93.9);
  const b = await askFlowIqCopilot('Occupancy at Kedzie Works?', { store, parse: null } as never);
  assert.equal((b.envelope.result as { percent?: number }).percent, 87.3);
});
