// Demo review 2026-10-31 (Q4, Q6, renewal text) as tests: a breakdown chart's highlight and its
// named winner come from the plotted series, a named comparison plots only the named buildings
// with the text's window and definition, and the renewal text counts the rate's own denominator.
// Also the grading rules of scripts/genui-grounded.ts (defA or defB accepted, clarify is IDK).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { askPanel, panelErrors, seriesWinner } from '../src/genui/picker.ts';
import { highlightErrors, type ChartSpec } from '../src/genui/spec.ts';
import { grade, headline, type Fact } from '../scripts/genui-grounded.ts';

process.env.GENUI_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'genui-grounded-'));
const store = loadPortfolioStore();
const bars = (s: ChartSpec) => (s.template === 'sorted_bar' ? s.props.items.map((x) => [x.label, x.value.v] as const) : []);

test('Q4: the lowest-CPL winner is the smallest plotted (CAD-converted) bar, in the highlight and the text', async () => {
  const q = 'Which listing source had the lowest cost per lead in Q2 2026?';
  const p = await askPanel(q, store);
  assert.equal(p.spec.template, 'sorted_bar');
  assert.deepEqual(p.errors, []);
  const b = bars(p.spec); const min = b.reduce((a, x) => (x[1] < a[1] ? x : a));
  assert.deepEqual(min, ['Facebook Ads', 134.33]); // $7,656.60 / 57 with CAD at 0.73
  assert.deepEqual((p.spec as Extract<ChartSpec, { template: 'sorted_bar' }>).props.highlight, ['Facebook Ads']);
  assert.match(p.spec.answer ?? '', /^In .*, Facebook Ads had the lowest cost per lead at \$134\.33/);
  assert.deepEqual(await panelErrors(q, p.spec, store), []);
});

test('Q6: a named two-building comparison plots only those buildings, with the text\'s values', async () => {
  const p = await askPanel('Of Halsted & Lake and Marlowe Residences, which has the highest vacancy rate?', store);
  assert.deepEqual(bars(p.spec), [['Halsted & Lake', 5], ['Marlowe Residences', 3.9]]);
  assert.match(p.spec.answer ?? '', /Halsted & Lake \[P01\]: 5\.0% \(7\/140\) vs\. Marlowe Residences \[P02\]: 3\.9%/);
  assert.deepEqual((p.spec as Extract<ChartSpec, { template: 'sorted_bar' }>).props.highlight, ['Halsted & Lake']);
  const lo = await askPanel('Of Halsted & Lake and Marlowe Residences, which has the lowest vacancy rate?', store);
  assert.deepEqual((lo.spec as Extract<ChartSpec, { template: 'sorted_bar' }>).props.highlight, ['Marlowe Residences']);
});

test('a tie on the plotted values highlights nothing', async () => {
  const p = await askPanel('Of Halsted & Lake and Fulton Yards, which has the most vacant units?', store);
  assert.deepEqual(bars(p.spec), [['Halsted & Lake', 7], ['Fulton Yards', 7]]);
  assert.deepEqual((p.spec as Extract<ChartSpec, { template: 'sorted_bar' }>).props.highlight, []);
  assert.equal(seriesWinner([{ label: 'a', v: 2 }, { label: 'b', v: 2 }, { label: 'c', v: 1 }], 'max'), null);
  assert.equal(seriesWinner([{ label: 'a', v: 2 }, { label: 'b', v: 2 }, { label: 'c', v: 1 }], 'min'), 'c');
});

test('the validator rejects a highlight that is not the unique extreme of the plotted series', () => {
  const spec = (highlight: string[], vs = [3, 2, 1]) => ({ template: 'sorted_bar', props: { items: vs.map((v, i) => ({ label: 'abc'[i], value: { v, ref: 'x' } })), sort: 'desc', highlight, good_direction: 'down' } }) as unknown as ChartSpec;
  assert.deepEqual(highlightErrors(spec(['a'])), []);
  assert.deepEqual(highlightErrors(spec(['c'])), []);
  assert.equal(highlightErrors(spec(['b'])).length, 1); // the middle bar
  assert.equal(highlightErrors(spec(['z'])).length, 1); // not plotted
  assert.equal(highlightErrors(spec(['a'], [3, 3, 1])).length, 1); // tied
  assert.equal(highlightErrors(spec(['a', 'c'])).length, 1);
});

test('renewal text counts the rate\'s denominator (renewed + pending + notice), not every lease row', async () => {
  const all = await askPanel('What is the renewal rate at The Clarendon?', store);
  assert.match(all.spec.answer ?? '', /^For the 63 matching leases with any end date that are renewed, pending or on notice \(86 not yet due excluded\), 39 have renewed, giving a renewal rate of 61\.9%\.$/);
  const q4 = await askPanel('What is the renewal rate for leases ending in Q4 2026 at The Clarendon? Percent, one decimal.', store);
  assert.match(q4.spec.answer ?? '', /^For the 62 matching leases ending in Q4 2026 that are renewed, pending or on notice, 38 have renewed, giving a renewal rate of 61\.3%\.$/);
  for (const p of [all, q4]) assert.deepEqual(p.errors, []);
});

test('grounded grading: defA or defB within tolerance and rounding is correct; clarify is IDK', () => {
  const f = { fact_id: 'T', measure: 'occupancy_rate', kind: 'number', unit: 'percent', value: 92.1429, tolerance: 0, value_variants: { defA: 92.1429, defB: 95 } } as unknown as Fact;
  assert.equal(grade({ kind: 'number', v: 95 }, f), 'correct');
  assert.equal(grade({ kind: 'number', v: 92.1 }, f), 'correct');
  assert.equal(grade({ kind: 'number', v: 93 }, f), 'wrong');
  assert.equal(grade({ kind: 'idk' }, f), 'idk');
  const e = { ...f, kind: 'entity', value: 'Marlowe Residences', accept_names: ['Marlowe Residences', 'P02'], value_variants: null } as unknown as Fact;
  assert.equal(grade({ kind: 'entity', name: 'Marlowe Residences' }, e), 'correct');
  assert.equal(grade({ kind: 'entity', name: null }, e), 'wrong');
  assert.deepEqual(headline({ template: 'clarify_card' } as ChartSpec, f), { kind: 'idk' });
});
