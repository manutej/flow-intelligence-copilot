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
test('settings bind per parameter with value and unit (TENACITY f9a64d0 1-3, 5)', async () => {
  const title = async (s: string) => (await askPanel(base(s), store)).spec;
  // 1: beta0 is compared with 3250 alone, never with alpha0's 1
  for (const s of ['with prior beta0=1', 'with prior beta0=$1', 'with a $1 prior', 'with beta0 = 1 dollar']) assert.equal((await title(s)).title, 'This prior is not supported', s);
  // 2: the currency is part of the value
  for (const s of ['with prior beta0 = 3250 CAD', 'with prior beta0 = $3250 CAD']) assert.equal((await title(s)).title, 'This prior is not supported', s);
  for (const s of ['with prior beta0=$3250', 'with a prior of 3250 dollars', 'with prior beta0 = 3.25k']) assert.equal((await title(s)).template, 'sorted_bar', s);
  // 5: a number that is not plainly the setting's value: neutral clarify, never a chart, never a setting name
  for (const q of ['I want prior\n1800 → ' + base(''), 'prior → 1800 → ' + base(''), 'Set prior to 1800 → ' + base(''), base('with a prior (1800)'), base('with a prior, namely 1800'), base('with a prior of 1')]) {
    const a = await askPanel(q, store);
    assert.equal(a.spec.template, 'clarify_card', q);
    assert.ok(!/not supported/.test(a.spec.title ?? ''), q);
  }
  // 3: ranks and durations are not setting values
  assert.equal((await askPanel('How much CAD spend converted at the CAD rate went to the top 1 channel?', store)).spec.template, 'kpi');
  for (const q of ['Compare vacancy to the prior 3 months at P04', 'What was vacancy at P04 in the prior 30 days?', 'How did the prior 2 quarters compare at P04?', 'What is the CAD rate used for 1 property?', 'What prior is used for 2 bedroom leasing?'])
    assert.ok(!/not supported/.test((await askPanel(q, store)).spec.title ?? ''), q);
});
