// FLOWIQ-SITE-002: building vs source superlatives on cost per lead.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

const store = loadPortfolioStore();
const ask = async (q: string) => (await askFlowIqCopilot(q, { store, parse: null })).envelope;
const propIds = new Set(store.properties.map((p) => p.propertyId));
const sources = new Set([...store.paidSources, ...store.organicSources]);

for (const [q, agg] of [
  ['Which building has the highest cost per lead?', 'highest'],
  ['what property has the highest CPL', 'highest'],
  ['Which building has the lowest cost per lead?', 'lowest'],
  ['lowest cost per lead by building - which one?', 'lowest'],
] as const) {
  test(`building superlative returns a property: ${q}`, async () => {
    const e = await ask(q);
    const r = e.result as { property_id?: string; usd?: number; source?: string };
    assert.ok(r.property_id && propIds.has(r.property_id), JSON.stringify(r));
    assert.equal(r.source, undefined);
    assert.equal(typeof r.usd, 'number');
    assert.match(e.answer, new RegExp(`${agg} cost per lead among buildings`));
  });
}

test('the building ranking is spend / leads per property', async () => {
  const hi = (await ask('Which building has the highest cost per lead?')).result as { usd: number };
  const lo = (await ask('Which building has the lowest cost per lead?')).result as { usd: number };
  assert.ok(hi.usd > lo.usd);
});

for (const q of ['Which ad source has the highest cost per lead?', 'Which ad source has the highest CPL?', 'Which ad source has the lowest CPL?', 'lowest CPL listing source?']) {
  test(`source superlative returns a source: ${q}`, async () => {
    const r = (await ask(q)).result as { source?: string; property_id?: string };
    assert.ok(r.source && sources.has(r.source), JSON.stringify(r));
    assert.equal(r.property_id, undefined);
  });
}

for (const q of ['highest cost per lead?', 'lowest cost per lead?']) {
  test(`neither named: both, labelled: ${q}`, async () => {
    const e = await ask(q);
    const r = e.result as { building: { property_id: string }; source: { source: string } };
    assert.ok(propIds.has(r.building.property_id));
    assert.ok(sources.has(r.source.source));
    assert.match(e.answer, /by building, .*; by source, /);
  });
}

test("'fewest vacant' sorts ascending and matches the per-building counts", async () => {
  const r = await askFlowIqCopilot('which building has the fewest vacant units?', { store, parse: null });
  const op = new Set(store.operatingProperties.map((p) => p.propertyId));
  const vac = new Map<string, number>();
  for (const u of store.units) if (op.has(u.propertyId) && u.status === 'vacant') vac.set(u.propertyId, (vac.get(u.propertyId) ?? 0) + 1);
  for (const p of store.operatingProperties) if (!vac.has(p.propertyId)) vac.set(p.propertyId, 0);
  const min = Math.min(...vac.values());
  const winner = store.operatingProperties.find((p) => vac.get(p.propertyId) === min)!;
  assert.match(r.envelope.answer, new RegExp(`${winner.name.replace(/[&]/g, '\\$&')} \\(${winner.propertyId}\\) has the fewest vacant units at ${min}\\b`));
});
