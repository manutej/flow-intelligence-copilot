// Grounded dev wrongs (2026-10-31 round 2) as tests: each panel headlines the figure the
// question names, from the row the question picks, and gives IDK rather than row 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { askPanel } from '../src/genui/picker.ts';
import type { ChartSpec } from '../src/genui/spec.ts';

process.env.GENUI_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'genui-wrongs-'));
const store = loadPortfolioStore();
const props = (s: ChartSpec) => s.props as Record<string, any>;
const kpi = async (q: string) => { const p = await askPanel(q, store); assert.equal(p.spec.template, 'kpi', q); return props(p.spec).value.v as number; };

test('avg_sqft headlines square feet, not the unit count it also carries', async () => {
  assert.equal(await kpi('What is the average square footage of units at Halsted & Lake?'), 840.7);
});

test('total concessions is the sum; zero matching leases is IDK, not $0', async () => {
  assert.equal(await kpi('What were total concessions on leases starting at Halsted & Lake in Q1 2026?'), 500);
  assert.equal((await askPanel('Concessions at Harbor View?', store)).spec.template, 'clarify_card');
});

test('a renewal-status count counts that status only', async () => {
  assert.equal(await kpi('How many leases at Halsted & Lake have renewal status renewed?'), 26);
});

test('leads that leased counts converted leads, not all leads', async () => {
  assert.equal(await kpi('How many leads at Halsted & Lake leased in August 2026?'), 5);
});

test('leads honour a bedrooms filter over the whole window', async () => {
  assert.equal(await kpi('How many leads for 1-bedroom units did Halsted & Lake get?'), 73);
});

test('unranked cost per lead is pooled over paid sources, not the first source row', async () => {
  const p = await askPanel('What was the cost per lead at Marlowe Residences in April 2026?', store);
  assert.equal(props(p.spec).value.v, 157.35);
  assert.match(p.spec.answer ?? '', /pooled cost per lead across paid sources was \$157\.35 \(\$5,350\.00 spend \/ 34/);
});

test('a prior-period delta moves the lease-start window too', async () => {
  const p = await askPanel('How many leases started at Halsted & Lake in August 2026 compared to the prior period?', store);
  assert.equal(p.spec.template, 'kpi_delta');
  assert.deepEqual([props(p.spec).value.v, props(p.spec).prior.v, props(p.spec).vs], [4, 6, 'Jul 2026']);
});

test('which building ranks buildings, with the plotted extreme as the winner', async () => {
  for (const [q, want] of [['Which building had the highest cost per lead in August 2026?', 'Marlowe Residences'], ['Which building had the lowest cost per lead in August 2026?', 'The Clarendon']] as const) {
    const p = await askPanel(q, store);
    assert.equal(p.spec.template, 'sorted_bar', q);
    assert.deepEqual(props(p.spec).highlight, [want], q);
    assert.ok(props(p.spec).items.every((x: { label: string }) => store.operatingProperties.some((b) => b.name === x.label)), q);
    assert.match(p.spec.answer ?? '', new RegExp(`^In .*, ${want}`), q);
  }
});

test('learner bars are each channel\'s own posterior, and the winner is the plotted minimum', async () => {
  const p = await askPanel('At Halsted & Lake (P01), in decisions.csv outcome learning, which channel ranks #1 with the lowest posterior CPSL, and what is its posterior CPSL in USD?', store);
  const vs = props(p.spec).items.map((x: { value: { v: number } }) => x.value.v);
  assert.ok(new Set(vs).size > 1, 'bars differ');
  assert.deepEqual(props(p.spec).highlight, ['Apartments.com']);
  assert.equal(Math.min(...vs), 2706);
});

test('an unranked source measure with several sources is IDK, a "which ... best" ranks', async () => {
  const p = await askPanel('What is the tour-to-lease rate at Halsted & Lake?', store);
  assert.equal(p.spec.template, 'clarify_card');
  const best = await askPanel('Which source has the best tour-to-lease rate at Halsted & Lake?', store);
  assert.match(best.spec.answer ?? '', /Website .* 50\.0%/);
});
