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
test('a title that would repeat an unused figure gives a neutral clarify, not an error card (TENACITY f9a64d0 4)', async () => {
  for (const q of ['renewal rate is 68%. where is it lowest?', 'What is the renewal rate? → renewal rate is 68%. where is it lowest?']) {
    const a = await askPanel(q, store);
    assert.equal(a.spec.template, 'clarify_card', q);
    assert.equal(a.spec.state, 'ready', q);
    assert.deepEqual(a.errors, [], q);
    assert.deepEqual(specErrors(a.spec, a.evidence, store), [], q);
    assert.ok(!/68|not supported/.test(a.spec.title ?? ''), q);
  }
});
test('strict grammar fails closed (TENACITY 228b925 1-4)', async () => {
  const at = async (s: string) => (await askPanel(base(s), store)).spec;
  // 1-3: a unit placed elsewhere, an operator or qualifier, a spelled form: neutral, never a chart or a setting card
  for (const s of ['with prior beta0 = 3250 in CAD', 'with prior beta0 = $3250 (CAD)', 'with beta0 = 3250 + 1', 'with beta0 = 3250 or so', 'with beta0 of about 3250', 'with beta zero one']) {
    const sp = await at(s); assert.equal(sp.template, 'clarify_card', s); assert.equal(sp.title, 'Could you restate the question?', s);
  }
  // fully parsed with another value or unit: that setting's card
  for (const s of ['with beta0 = 3250 CAD', 'with beta0 = 1800 USD', 'with prior beta0 = 3250 Canadian dollars']) assert.equal((await at(s)).title, 'This prior is not supported', s);
  // fully parsed policy value and unit: charts
  for (const s of ['with prior beta0 = USD 3250', 'with prior beta0 = 3250 USD', 'with prior beta0 = 3,250 dollars']) assert.equal((await at(s)).template, 'sorted_bar', s);
  const q = (s: string) => `${s}, was decision X001 in decisions.csv accepted, who decided it, and what was the monthly delta?`;
  for (const s of ['Under 1 CAD = 0.73 USD', 'Under a CAD rate of 0.73 USD', 'Under CAD rate 0.73']) assert.equal((await askPanel(q(s), store)).spec.template, 'kpi', s);
  // 4: a bare rank word is not a setting value
  assert.equal((await askPanel('Which 1 channel has the highest spend after CAD rate conversion?', store)).spec.template, 'sorted_bar');
});
test('accounting: with a setting present every other number must be placed (TENACITY 717bfce)', async () => {
  const Q = 'At The Clarendon (P04), in decisions.csv outcome learning, which channel ranks #1 with the lowest posterior CPSL, and what is its posterior CPSL in USD?';
  const X = 'Then, was decision X001 in decisions.csv accepted, who decided it, and what was the monthly delta?';
  for (const q of ['beta0 = 3250 → no, 1800 → ' + Q, 'beta0 = 3250 → make it 1800 → ' + Q, 'beta0 = 3250 → 1800 → ' + Q, 'beta0 = 3250, sorry 1800 → ' + Q,
    'beta0 = 3250 and 1800 → ' + Q, 'beta0 = $3250 → change it to $1800 → ' + Q, 'alpha0 = 1 → actually 2 → ' + Q, 'Use 1800 instead → ' + Q,
    'CAD rate 0.73 → actually 0.8 → ' + X, 'beta0 = 3250 USD per CAD → ' + Q, 'Is beta0 3250?']) {
    const a = await askPanel(q, store);
    assert.equal(a.spec.template, 'clarify_card', q);
    assert.ok(!/not supported/.test(a.spec.title ?? ''), q);
  }
  for (const q of ['beta0 = 3250 → ' + Q, 'Is beta0 3250? → ' + Q, Q]) assert.equal((await askPanel(q, store)).spec.template, 'sorted_bar', q);
});
test('accounting by mention, scoped to setting and referring turns (TENACITY beded12)', async () => {
  const Q = 'At The Clarendon (P04), in decisions.csv outcome learning, which channel ranks #1 with the lowest posterior CPSL, and what is its posterior CPSL in USD?';
  // a correction equal to a used value (4 from P04, 1 from #1) is a different mention: neutral
  for (const q of ['alpha0 = 1 → actually 4 → ' + Q, 'alpha0 = 1, no wait, 4 → ' + Q, 'beta0 = 3250 → no, 4 → ' + Q, 'Use 4 instead → ' + Q,
    'At The Clarendon (P04) with alpha0 = 1, actually 4, in decisions.csv outcome learning, which channel ranks #1 with the lowest posterior CPSL, and what is its posterior CPSL in USD?',
    // a value change with no numeral in a referring turn: neutral
    'beta0 = 3250 → halve it → ' + Q, 'beta0 = 3250 → double it → ' + Q, 'beta0 = 3250 → 1e3 → ' + Q]) {
    const a = await askPanel(q, store);
    assert.equal(a.spec.template, 'clarify_card', q); assert.equal(a.spec.title, 'Could you restate the question?', q);
  }
  // earlier turns that do not refer back do not block (Q77 rule)
  assert.equal((await askPanel('beta0 = 3250 → How many units at P01 have 2 bedrooms? → ' + Q, store)).spec.template, 'sorted_bar');
  // earlier turns that do not refer back do not block (Q77 rule): a number counting a noun is not a prior
  for (const q of ['Show me 3 properties with highest vacancy → ' + Q, 'Thanks for the 12 numbers. → ' + Q])
    assert.equal((await askPanel(q, store)).spec.template, 'sorted_bar', q);
});
test('after a setting, only standalone questions may follow it; with no setting, earlier turns are not read (TENACITY cfd6ff3)', async () => {
  const Q = 'At The Clarendon (P04), in decisions.csv outcome learning, which channel ranks #1 with the lowest posterior CPSL, and what is its posterior CPSL in USD?';
  // any later turn that is not a standalone question, in any language, with or without a number
  for (const c of ['hmm, should be 1800 i think', 'should have said 1800 there', 'mejor que sea 1800 por favor', 'en fait mettons 1800 svp',
    "let's go with 4 please", 'go lower please', 'hmm, lower please', 'halve it']) {
    const a = await askPanel('beta0 = 3250 → ' + c + ' → ' + Q, store);
    assert.equal(a.spec.template, 'clarify_card', c); assert.equal(a.spec.title, 'Could you restate the question?', c);
  }
  // no setting stated: earlier turns are not read (Q77)
  for (const c of ['What is it like at P01?', 'Use the marketing data', 'Which channels double as referrals?', 'Thanks!', 'Hi'])
    assert.equal((await askPanel(c + ' → ' + Q, store)).spec.template, 'sorted_bar', c);
  // a standalone question after the setting, and a policy setting in parentheses, chart
  for (const q of ['beta0 = 3250 → How many units at P01 have 2 bedrooms? → ' + Q, 'beta0 = 3250 → ' + Q.replace('ranks #1', 'ranks #1 (beta0 = 3250)')])
    assert.equal((await askPanel(q, store)).spec.template, 'sorted_bar', q);
});
test('learner with no setting: a non-question earlier turn with a stray number fails closed (fail-closed decision on 7ce8377)', async () => {
  const Q = 'At The Clarendon (P04), in decisions.csv outcome learning, which channel ranks #1 with the lowest posterior CPSL, and what is its posterior CPSL in USD?';
  for (const c of ['Use 4 instead', 'Use 1800 instead', 'go with 4 please'])
    assert.equal((await askPanel(c + ' → ' + Q, store)).spec.title, 'Could you restate the question?', c);
  // non-learner Q77 rows still chart; learner earlier turns with no number still chart
  assert.equal((await askPanel('Thanks for the 12 numbers. → How many vacant units are at Halsted & Lake?', store)).spec.template, 'kpi');
  for (const c of ['Thanks!', 'Use the marketing data', 'What was spend in 2025?']) assert.equal((await askPanel(c + ' → ' + Q, store)).spec.template, 'sorted_bar', c);
});
test('turn-leading numbers, standalone turns with tails, counts and the pronoun one (TENACITY 6ca99c4)', async () => {
  const Q = 'At The Clarendon (P04), in decisions.csv outcome learning, which channel ranks #1 with the lowest posterior CPSL, and what is its posterior CPSL in USD?';
  const P = 'How many units at P01 have 2 bedrooms?';
  for (const q of ['Hi → 1800 → ' + Q, 'ok → 4 → ' + Q, 'thanks → 4 instead → ' + Q, 'Hi → 1800 please → ' + Q,
    'beta0 = 3250 → ' + P + ' use 1800 instead → ' + Q, 'beta0 = 3250 → What was spend in 2025? 4 instead → ' + Q,
    P + ' use 4 instead → ' + Q, 'What was spend in 2025? 4 instead → ' + Q, 'beta0 = 3250 → ' + P + ' also 1800 → ' + Q])
    assert.equal((await askPanel(q, store)).spec.title, 'Could you restate the question?', q);
  // small talk with no entity noun now clarifies (fail-closed, TENACITY 06921c8 ruling)
  assert.equal((await askPanel('Hello there, quick one → ' + Q, store)).spec.template, 'clarify_card');
  for (const q of ['Show me 3 properties with highest vacancy and use that list → ' + Q,
    'How many units at P01 have 2 bedrooms, actually? → ' + Q, P + ' → ' + Q, 'beta0 = 3250 → ' + P + ' → ' + Q])
    assert.equal((await askPanel(q, store)).spec.template, 'sorted_bar', q);
});
test('learner with no setting: numbers clarify unless the turn is clearly non-editing (TENACITY 6a56c25)', async () => {
  const Q = 'At The Clarendon (P04), in decisions.csv outcome learning, which channel ranks #1 with the lowest posterior CPSL, and what is its posterior CPSL in USD?';
  const noset = ['1800 dollars','4 leases','3250 units per month','use 4 months','1800 bucks instead','make it 4 percent','use 1800 euros','1800 pesos please','make it 1800 dollares','use 4 weeks','4 months instead','try 1800 credits','use 4 units instead','1800 units','go with 4 observations','prior of 4 leads','1800 dólares','mejor 4 meses','mettons 1800 euros','4 cents','1800 people','4 children','4 data','use 1800 USDs','1800 grand','use 4 pseudo-leases','4 pseudoleases','4 pseudo leases','4 leases instead','alpha0 4 leads','4 pseudo-observations','half a dozen months','1800 yen'];
  const oneNoset = ['make it one', 'use one instead', 'one more', 'go with one', 'make it a thousand'];
  for (const c of [...noset, ...oneNoset]) assert.equal((await askPanel(c + ' → ' + Q, store)).spec.template, 'clarify_card', c);
  for (const c of ['Hello there, quick one', 'We had 2 meetings today', 'one question', 'I have one more question']) assert.equal((await askPanel(c + ' → ' + Q, store)).spec.template, 'clarify_card', c);
  for (const c of ['Show me 3 properties with highest vacancy', 'Thanks for the 12 numbers.', 'I manage 4 buildings'])
    assert.equal((await askPanel(c + ' → ' + Q, store)).spec.template, 'sorted_bar', c);
});
test('no-setting numbers pass only as entity counts or request parses (TENACITY 06921c8)', async () => {
  const Q = 'At The Clarendon (P04), in decisions.csv outcome learning, which channel ranks #1 with the lowest posterior CPSL, and what is its posterior CPSL in USD?';
  // rows copied verbatim from genui-exempt-06921c8.ts
const C: [string,string][] = [
 // cue after the number
 ['cue-after','1800 euros would be better'],['cue-after','4 units, use that'],['cue-after','1800 please instead'],['cue-after','4 units would be better'],
 ['cue-after','I think 1800 dollars instead'],['cue-after','I think 1800 dollars would be better'],['cue-after','we want 4 units instead of that'],
 // padded filler, no listed cue
 ['pad','I think maybe 1800 dollars is right'],['pad','I think maybe 4 units is right'],['pad','I would prefer 1800 dollars here'],['pad','how about 1800 dollars for that'],
 ['pad','what if it were 4 units'],['pad','assume 4 leases for the prior'],['pad','please put 1800 dollars there'],['pad','I would go 1800 dollars here'],
 ['pad','the prior should really be 4 leases'],['pad','prefiero 4 meses para eso'],['pad','je préfère 1800 euros pour ça'],['pad','ich möchte 4 Monate bitte'],
 ['pad','assume one bedroom for it'],['pad','I would pick 4 months for it'],['pad','I would like 1800 dollars there'],
 // one before noun used as edit
 ['one-edit','one bedroom prior please'],['one-edit','try one unit'],['one-edit','one lease prior is fine'],['one-edit','one pseudo lease please'],['one-edit','assume one lease here'],['one-edit','I want one lease as prior'],
 // more/less mid-turn
 ['moreless','more like 1800 please'],['moreless','less like 4 leases please'],['moreless','something more like 1800 dollars'],['moreless','more like 4 units really'],
];
const B: [string,string][] = [
 ['ok','Show me 3 properties with highest vacancy'],['ok','Thanks for the 12 numbers.'],['ok','I manage 4 buildings'],['ok','We had 2 meetings today'],['ok','one question'],['ok','I have one more question'],['ok','Hello there, quick one'],
 ['ok','Thanks!'],['ok','Thanks for the 3 charts'],['ok','Great, I looked at 5 reports today'],['ok','We have 12 properties in Chicago'],['ok','I read 3 papers on this'],['ok','Show me 3 properties'],['ok','3 properties please'],['ok','Hi, I run 4 buildings'],['ok','I had 2 questions earlier'],['ok','Thanks, those 12 numbers help'],['ok','That was helpful for my 2 teams'],
];
  // accepted over-clarifies: small talk with no data-entity noun fails closed (no harmless-noun list)
  const SMALL_TALK = new Set(['We had 2 meetings today', 'one question', 'I have one more question', 'Hello there, quick one',
    'Great, I looked at 5 reports today', 'I read 3 papers on this', 'I had 2 questions earlier', 'That was helpful for my 2 teams']);
  for (const [, c] of C) assert.equal((await askPanel(c + ' → ' + Q, store)).spec.template, 'clarify_card', c);
  for (const [, c] of B) assert.equal((await askPanel(c + ' → ' + Q, store)).spec.template, SMALL_TALK.has(c) ? 'clarify_card' : 'sorted_bar', c);
});
