// TENACITY VERDICT-GENUI-601bdfa HIGH (repros/genui-prior-leak-601bdfa.ts) as tests: any number stated
// near a prior word, in any turn and any match, that the computation did not use gives a clarify.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { askPanel } from '../src/genui/picker.ts';
import { specErrors } from '../src/genui/spec.ts';

process.env.GENUI_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'genui-prior-'));
const store = loadPortfolioStore();
const base = (pr: string) => `At The Clarendon (P04) ${pr}, in decisions.csv outcome learning, which channel ranks #1 with the lowest posterior CPSL, and what is its posterior CPSL in USD?`;
const LEAKS = ['with a prior of 1800', 'with 1800 dollars as the prior', 'with a $1800 prior', 'with a 1800-dollar prior', 'with prior=1800',
  'with beta zero of 1800', 'with beta-0=1800', 'with b0=1800', 'with beta0≈1800', 'with prior beta0 ~ $1800', 'with prior beta0 set to $1800',
  'with prior mean 1800', 'with prior beta0=$3250 and later beta0=$1800', 'with a prior of eighteen hundred dollars', 'with prior β₀=1800',
  'with prior beta0 = １８００', 'with prior $1.8k', 'with prior beta0=$1800'];
const POLICY = ['', 'with prior beta0=$3250', 'with prior beta0=3250.00', 'with prior beta0=$3,250', 'with a prior of 3250 dollars', 'with a prior of $3.25k'];

test('HIGH: every stated prior the learner does not use clarifies', async () => {
  for (const c of LEAKS) assert.equal((await askPanel(base(c), store)).spec.template, 'clarify_card', c);
});
test('HIGH: an unused prior in an earlier turn, or a second match, clarifies', async () => {
  for (const q of ['Use prior beta0=$1800 → ' + base(''), 'I want b0 of 1800. → ' + base('with the usual prior'), base('with prior beta0=$3250') + ' → ' + base('with prior beta0=$1800')])
    assert.equal((await askPanel(q, store)).spec.template, 'clarify_card', q);
});
test('HIGH: the policy prior in any spelling still charts', async () => {
  for (const c of POLICY) { const a = await askPanel(base(c), store); assert.equal(a.spec.template, 'sorted_bar', c); assert.deepEqual(a.errors, [], c); }
});
test('HIGH: a title echoes a question number only if the computation used it (normalized)', async () => {
  // the policy CAD rate is 0.73: a stated 0.7 is not the input used, so it is never charted under that title
  assert.equal((await askPanel('Under CAD rate 0.7, was decision X001 in decisions.csv accepted, who decided it, and what was the monthly delta?', store)).spec.template, 'clarify_card');
  // used inputs echo: decision X001 (an id in the intent), "fewer than 2" (bound max 1), "#1" (argmin), the policy prior
  assert.equal((await askPanel('Was decision X001 accepted, who decided it, and what was the monthly delta?', store)).spec.template, 'kpi');
  assert.equal((await askPanel('How many units at Kedzie Works have fewer than 2 bedrooms?', store)).spec.template, 'kpi');
  const a = await askPanel(base('with prior beta0=$3250'), store);
  const t = (title: string) => { const s = structuredClone(a.spec) as any; s.title = title; return specErrors(s, a.evidence, store); };
  assert.deepEqual(t('Prior $3250, ranked #1'), []);
  for (const bad of ['Prior $1800', 'ranked #2', 'a1800 prior']) assert.ok(t(bad).length > 0, bad);
});
test('LOW residuals: clarify ids, guard source, glued echoes', async () => {
  const a = await askPanel(base('with prior beta0=$3250'), store);
  const t = (title: string) => { const s = structuredClone(a.spec) as any; s.title = title; return specErrors(s, a.evidence, store); };
  for (const bad of ['Prior $3250-k', 'Prior $3250_k', 'Prior a$3250']) assert.ok(t(bad).length > 0, bad);
  const g = structuredClone(a.spec) as any; g.source = 'guard';
  assert.ok(specErrors(g, a.evidence, store).some((e) => e.includes('spec.source')));
  const c = await askPanel(base('with prior beta0=$1800'), store);
  assert.equal(c.spec.template, 'clarify_card');
  assert.deepEqual(specErrors(c.spec, c.evidence, store), []);
  const w = structuredClone(c.spec) as any; w.intent = 'leasing.vacancy.count';
  assert.ok(specErrors(w, c.evidence, store).some((e) => e.includes('spec.intent')));
});
test('one mechanism: any stated model parameter the computation did not use gives a clean clarify naming the policy value', async () => {
  const q = (s: string) => `${s}, was decision X001 in decisions.csv accepted, who decided it, and what was the monthly delta?`;
  for (const [stated, policy] of [['Under CAD rate 0.7', '1 CAD = 0.73 USD'], ['Under CAD rate 1', '1 CAD = 0.73 USD'], ['Using fx rate 0.8', '1 CAD = 0.73 USD']] as const) {
    const a = await askPanel(q(stated), store);
    assert.equal(a.spec.template, 'clarify_card', stated);
    assert.equal(a.spec.state, 'ready', stated); // not error_data
    assert.equal(a.spec.title, 'This CAD rate is not supported');
    assert.ok((a.spec as any).props.restatement.includes(policy), stated);
    assert.deepEqual(specErrors(a.spec, a.evidence, store), []);
  }
  assert.equal((await askPanel(q('Under CAD rate 0.73'), store)).spec.template, 'kpi');
  const p = await askPanel(base('with prior beta0=$1800'), store); // the prior card is the same mechanism
  assert.equal(p.spec.title, 'This prior is not supported');
  assert.ok((p.spec as any).props.restatement.includes('policy prior beta0 = $3250'));
});
