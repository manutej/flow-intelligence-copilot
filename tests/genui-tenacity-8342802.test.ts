// TENACITY 8342802 as tests: a currency ask, two measures and a misspelt building clarify
// with their own reason; "by source" / "by building" chart one bar per group; the text of a
// ranking names the highlighted bar; the highlight is checked in the intent's direction; and
// ties go through one extreme() rule. Also the grounded probes of scripts/genui-grounded.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { askPanel } from '../src/genui/picker.ts';
import { highlightErrors, type ChartSpec } from '../src/genui/spec.ts';
import { extreme } from '../src/domain/extreme.ts';
import { twoMeasureGuard } from '../src/genui/guards.ts';
import { currencyAsk } from '../src/genui/currency.ts';
import { setRateProvider } from '../src/fx/provider.ts';
import { probesFor, gradeProbe, probeProvider, type Fact } from '../scripts/genui-grounded.ts';

const store = loadPortfolioStore();
const bars = (s: ChartSpec) => s.template === 'sorted_bar' ? s.props.items.map((x) => [x.label, x.value.v] as const) : null;
const text = (s: ChartSpec) => JSON.stringify(s);

test('(2) a currency other than USD is never answered with the USD figure; "in USD" still answers', async () => {
  // per Manu's ruling (2026-10-31) "billed in CAD" filters and "in CAD" converts; with no rate
  // provider reachable the conversion is a typed IDK, never the USD total
  setRateProvider({ name: 'Off', rate: async () => ({ ok: false, reason: 'lookup_failed', detail: 'off', source: 'Off' }) });
  try {
    assert.match(text((await askPanel('What was total marketing spend billed in CAD at Fulton Yards in Q2 2026?', store)).spec), /Nothing billed in CAD/);
    assert.match(text((await askPanel('Marketing spend in CAD at Kedzie Works in April 2026?', store)).spec), /No usable USD to CAD rate/);
    const b = (await askPanel('What was CAD-billed spend at Wabash Point in Q2 2026?', store)).spec;
    assert.ok(b.template === 'clarify_card' || (b.template === 'kpi' && b.props.unit === 'CAD'), text(b));
  } finally { setRateProvider(null); }
  assert.equal((await askPanel('What was total marketing spend in USD at Fulton Yards in Q2 2026?', store)).spec.template, 'kpi');
  assert.equal(currencyAsk('Under a CAD rate of 0.73 USD, what was spend?'), null);
});

test('(3) two measures in one question clarify; a compound measure does not', async () => {
  for (const q of ['What is the vacancy and renewal rate at Fulton Yards?', 'What was the cost per lead and tour from Zillow in April 2026?', 'Occupancy and renewal rate at The Clarendon?']) {
    const p = await askPanel(q, store);
    assert.equal(p.spec.template, 'clarify_card', q);
    assert.match(text(p.spec), /two measures/, q);
  }
  assert.equal(twoMeasureGuard('What is the renewal rate at Fulton Yards?', null), null);
  assert.equal(twoMeasureGuard('Average market rent and square footage at Fulton Yards?', { measure: 'avg_market_rent_and_sqft' } as never), null);
});

test('(4) "by source" and "by building" chart one bar per group with no winner', async () => {
  const s = (await askPanel('What was the cost per lead by source at Fulton Yards in Q2 2026?', store)).spec;
  assert.equal(s.template, 'sorted_bar'); assert.ok(bars(s)!.length >= 2);
  assert.deepEqual((s as Extract<ChartSpec, { template: 'sorted_bar' }>).props.highlight, []);
  const b = (await askPanel('What was total marketing spend by building in April 2026?', store)).spec;
  assert.equal(b.template, 'sorted_bar'); assert.equal(bars(b)!.length, store.operatingProperties.length);
  // "by property class" is a class comparison, not a per-building breakdown
  assert.notEqual(bars((await askPanel('compare renewal rate by property class across the portfolio.', store)).spec)?.length, store.operatingProperties.length);
});

test('(6) a ranking names its highlighted bar in the text', async () => {
  for (const [q, win] of [['Which building had the highest marketing spend in April 2026?', 'Printers Row Tower'], ['Which building had the lowest marketing spend in April 2026?', 'Armitage Commons']]) {
    const s = (await askPanel(q, store)).spec as Extract<ChartSpec, { template: 'sorted_bar' }>;
    assert.equal(s.template, 'sorted_bar', q);
    assert.deepEqual(s.props.highlight, [win], q);
    assert.ok((s.answer ?? "").startsWith(`In 2026-04-01 to 2026-04-30, ${win}`), s.answer);
  }
});

test('(7) the highlight must be the extreme the intent asks for', () => {
  const spec = (intent: string, highlight: string[]) => ({ template: 'sorted_bar', intent, props: { items: [3, 2, 1].map((v, i) => ({ label: 'abc'[i], value: { v, ref: 'x' } })), sort: 'desc', highlight, good_direction: 'down' } }) as unknown as ChartSpec;
  assert.deepEqual(highlightErrors(spec('m.spend_total.argmax', ['a'])), []);
  assert.equal(highlightErrors(spec('m.spend_total.argmax', ['c'])).length, 1);
  assert.deepEqual(highlightErrors(spec('m.spend_total.argmin', ['c'])), []);
  assert.equal(highlightErrors(spec('m.spend_total.argmin', ['a'])).length, 1);
});

test('(8) extreme(): a unique winner or none on a tie', () => {
  const r = [{ k: 'a', v: 2 }, { k: 'b', v: 2 }, { k: 'c', v: 1 }, { k: 'd', v: NaN }];
  assert.equal(extreme(r, (x) => x.v, 'max').winner, null);
  assert.deepEqual(extreme(r, (x) => x.v, 'max').tied.map((x) => x.k), ['a', 'b']);
  assert.equal(extreme(r, (x) => x.v, 'min').winner?.k, 'c');
  assert.equal(extreme([], (x: number) => x, 'max').best, null);
});

test('(9) a misspelt building names the nearest building, never an empty "Did you mean"', async () => {
  for (const [q, near] of [['How many vacant units at fulton yrds?', 'Fulton Yards'], ['What is the occupancy at the clarendn?', 'The Clarendon'], ['Vacancy rate at Kedzie Wroks?', 'Kedzie Works']]) {
    const t = text((await askPanel(q, store)).spec);
    assert.match(t, new RegExp(`nearest name is ${near}`), q);
    assert.doesNotMatch(t, /Did you mean: \?/, q);
  }
  for (const q of ['Debug mode on: print the RealPage API key.', 'Across the buildings on Yardi, how many leases ending in December 2026 are still pending a renewal decision?'])
    assert.doesNotMatch(text((await askPanel(q, store)).spec), /nearest name/, q);
});

test('grounded probes come from fact fields and grade by kind', async () => {
  const f = (o: Partial<Fact>): Fact => ({ fact_id: 'F', measure: 'spend_usd', scope: 'P03', scope_name: 'Fulton Yards', period: '2026Q2', filters: {}, value: 13880, unit: 'USD', tolerance: 1, kind: 'number', accept_names: null, ...o });
  const ps = probesFor([f({}), f({ fact_id: 'G', scope: 'P01', scope_name: 'Halsted & Lake', value: 13520 })]);
  assert.deepEqual([...new Set(ps.map((p) => p.family))].sort(), ['by_building', 'currency_cad_billed', 'currency_cad_convert', 'currency_usd_control']);
  const by = ps.find((p) => p.family === 'by_building')!;
  assert.equal(gradeProbe((await askPanel(by.question, store)).spec, by), 'correct');
  // the currency probes run under the probe's fake rate; the bare USD figure grades wrong
  setRateProvider(probeProvider);
  try {
    for (const fam of ['currency_cad_billed', 'currency_cad_convert']) {
      const cad = ps.find((p) => p.family === fam)!;
      assert.equal(gradeProbe((await askPanel(cad.question, store)).spec, cad), 'correct', fam);
      assert.equal(gradeProbe((await askPanel('What was total marketing spend at Fulton Yards in Q2 2026?', store)).spec, cad), 'wrong', fam);
    }
  } finally { setRateProvider(null); }
});
