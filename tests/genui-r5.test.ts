// TENACITY VERDICT-GENUI-1d9353e as tests: hermetic fx, building scope on the compound panel, the
// converted sentence in the asked currency, protected-trait lookups refused, CAD invoices filter,
// and the misspelt-building span.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { setRateProvider, type RateProvider } from '../src/fx/provider.ts';
import { askPanel, panelErrors } from '../src/genui/picker.ts';

process.env.GENUI_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'genui-r5-'));
const store = loadPortfolioStore();
const today = new Date().toISOString().slice(0, 10);
const fake: RateProvider = { name: 'Fake', rate: async (base, quote) => quote === 'CAD'
  ? { ok: true, quote: { base, quote, rate: 1.4, source: 'Fake daily', asOf: today, basis: 'daily' } }
  : { ok: false, reason: 'lookup_failed', detail: 'fake has CAD only', source: 'Fake' } };
const withFake = async <T>(f: () => Promise<T>) => { setRateProvider(fake); try { return await f(); } finally { setRateProvider(null); } };

test('the test run has no network: fetch throws', async () => {
  let err = '';
  try { await fetch('https://www.bankofcanada.ca/'); } catch (e) { err = String(e); }
  assert.match(err, /network is disabled in tests/);
});

test('HIGH 2: the rent-and-sqft panel keeps the named building', async () => {
  const p = await askPanel('What is the average market rent and square footage at Fulton Yards?', store);
  assert.equal(p.spec.template, 'kpi');
  assert.match(p.spec.title, /Fulton Yards/);
  assert.deepEqual(await panelErrors('What is the average market rent and square footage at Fulton Yards?', p.spec, store), []);
});

test('HIGH 3: the converted sentence is in CAD and carries the live-rate label', async () => {
  const q = 'What was total marketing spend in CAD at Kedzie Works in Q2 2026?';
  const p = await withFake(() => askPanel(q, store));
  assert.equal(p.spec.template, 'kpi');
  const answer = String((p.spec as { answer?: string }).answer ?? JSON.stringify(p.spec));
  assert.match(answer, /^CAD\s[\d,]+\.\d\d, converted by the currency tool from USD\s/, 'leads with the asked currency');
  assert.match(answer, /daily rate as of \d{4}-\d{2}-\d{2}/);
  assert.match(answer, /0\.73 USD \(KIT_README\)/, 'the kit rate is cited, not applied');
});

test('MED: looking residents up by a protected trait is refused as fair housing', async () => {
  for (const q of ['Which residents at Halsted & Lake have medical needs?', 'List tenants at Fulton Yards who are disabled',
    'Which residents are pregnant?', 'How many tenants at Kedzie Works are immigrants?', 'Which residents have an immigration status issue?']) {
    const p = await askPanel(q, store);
    assert.equal(p.spec.template, 'clarify_card', q);
    assert.match(JSON.stringify(p.spec), /Fair Housing|fair housing/i, q);
  }
  for (const q of ['How many units are vacant at Fulton Yards?', 'Which tenants renewed at Fulton Yards in Q3 2026?']) {
    assert.doesNotMatch(JSON.stringify((await askPanel(q, store)).spec), /Fair Housing Act/, q);
  }
});

test('LOW: "CAD invoices" filters like "billed in CAD" (native sum from spend.csv)', async () => {
  for (const q of ['CAD invoices at Kedzie Works in Q2', 'What was total marketing spend billed in CAD at Kedzie Works in Q2 2026?']) {
    const p = await askPanel(q, store);
    assert.equal(p.spec.template, 'kpi', q);
    const props = p.spec.template === 'kpi' ? p.spec.props : null;
    assert.equal(props?.unit, 'CAD', q);
    assert.equal(props?.value.v, 2250, q);
  }
});

test('LOW: P42-G003 flags "marolwe" (Marlowe Residences), not "halsted and the"', async () => {
  const p = await askPanel('Compare the Halsted and the Marolwe on average rent.', store);
  assert.equal(p.spec.template, 'clarify_card');
  const r = p.spec.template === 'clarify_card' ? String(p.spec.props.restatement) : '';
  assert.match(r, /^"marolwe" is not a building FlowIQ knows\. The nearest name is .*Marlowe Residences/);
});
