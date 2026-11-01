// FLOWIQ-SITE-004: per-building breakdowns for occupancy, vacancies and unit counts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

const store = loadPortfolioStore();
const ask = async (q: string) => (await askFlowIqCopilot(q, { store, parse: null }));
const operating = store.properties.filter((p) => store.units.some((u) => u.propertyId === p.propertyId));

test('occupancy at each building lists every building with its rate and a labelled total', async () => {
  const t = await ask('What is occupancy at each building?');
  const a = t.envelope.answer;
  for (const p of operating) assert.match(a, new RegExp(`${p.propertyId}\\]: \\d+\\.\\d%`), p.propertyId);
  assert.match(a, /Portfolio total: 93\.9% \(1033\/1100 units; \d+ on notice\)/);
  assert.ok(a.trim().split('\n').at(-1)!.includes('Portfolio total'), 'total is the last row');
  const r = t.envelope.result as { by_property: Array<{ property_id: string; percent: number; notice: number }>; total: { percent: number } };
  assert.equal(r.by_property.length, operating.length);
  assert.equal(r.total.percent, 93.9);
  assert.ok(t.verification.valid, JSON.stringify(t.verification.errors));
});

test('on-notice units count as occupied and are shown as their own figure', async () => {
  const r = (await ask('What is occupancy at each building?')).envelope.result as { by_property: Array<{ occupied: number; notice: number; units: number; percent: number }> };
  for (const row of r.by_property) assert.equal(row.percent, Number(((row.occupied / row.units) * 100).toFixed(1)));
  assert.ok(r.by_property.some((row) => row.notice > 0));
});

for (const q of ['vacancies by property', 'how many vacant units does each building have?', 'list vacant unit counts per building']) {
  test(`vacant breakdown: ${q}`, async () => {
    const t = await ask(q);
    const r = t.envelope.result as { by_property: Array<{ property_id: string; count: number }>; total: { count: number } };
    assert.equal(r.by_property.length, operating.length);
    assert.equal(r.total.count, r.by_property.reduce((s, x) => s + x.count, 0));
    assert.equal(r.total.count, store.units.filter((u) => u.status === 'vacant').length);
    assert.match(t.envelope.answer, /Portfolio total: \d+/);
  });
}

test('units in each building lists unit counts', async () => {
  const r = (await ask('units in each building')).envelope.result as { by_property: Array<{ count: number }>; total: { count: number } };
  assert.equal(r.by_property.length, operating.length);
  assert.equal(r.total.count, 1100);
});

test('a single total still returns a single number', async () => {
  for (const q of ['What is the portfolio occupancy?', 'what is occupancy?', 'how many vacant units are there?']) {
    const r = (await ask(q)).envelope.result as Record<string, unknown>;
    assert.ok(!('by_property' in r), q);
    assert.ok(typeof r.percent === 'number' || typeof r.count === 'number', `${q}: ${JSON.stringify(r)}`);
  }
});
