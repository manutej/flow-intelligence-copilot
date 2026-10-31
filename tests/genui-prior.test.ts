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
  for (const q of ['Hello there, quick one → ' + Q, 'Show me 3 properties with highest vacancy and use that list → ' + Q,
    'How many units at P01 have 2 bedrooms, actually? → ' + Q, P + ' → ' + Q, 'beta0 = 3250 → ' + P + ' → ' + Q])
    assert.equal((await askPanel(q, store)).spec.template, 'sorted_bar', q);
});
test('learner with no setting: numbers clarify unless the turn is clearly non-editing (TENACITY 6a56c25)', async () => {
  const Q = 'At The Clarendon (P04), in decisions.csv outcome learning, which channel ranks #1 with the lowest posterior CPSL, and what is its posterior CPSL in USD?';
  const noset = ['1800 dollars','4 leases','3250 units per month','use 4 months','1800 bucks instead','make it 4 percent','use 1800 euros','1800 pesos please','make it 1800 dollares','use 4 weeks','4 months instead','try 1800 credits','use 4 units instead','1800 units','go with 4 observations','prior of 4 leads','1800 dólares','mejor 4 meses','mettons 1800 euros','4 cents','1800 people','4 children','4 data','use 1800 USDs','1800 grand','use 4 pseudo-leases','4 pseudoleases','4 pseudo leases','4 leases instead','alpha0 4 leads','4 pseudo-observations','half a dozen months','1800 yen'];
  const oneNoset = ['one question', 'make it one', 'use one instead', 'one more', 'go with one', 'make it a thousand'];
  for (const c of [...noset, ...oneNoset]) assert.equal((await askPanel(c + ' → ' + Q, store)).spec.template, 'clarify_card', c);
  for (const c of ['Show me 3 properties with highest vacancy', 'Thanks for the 12 numbers.', 'I manage 4 buildings',
    'Hello there, quick one', 'We had 2 meetings today', 'I have one more question'])
    assert.equal((await askPanel(c + ' → ' + Q, store)).spec.template, 'sorted_bar', c);
});
test('no-setting numbers: corrections clarify, small talk charts (TENACITY 06921c8)', async () => {
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
  // the settings' declared units decide: a bedroom is no setting's unit, so this row charts
  const BY_UNIT = new Set(['assume one bedroom for it']);
  for (const [, c] of C) assert.equal((await askPanel(c + ' → ' + Q, store)).spec.template, BY_UNIT.has(c) ? 'sorted_bar' : 'clarify_card', c);
  // no noun evidence: clarifies (fail closed, needs TENACITY approval)
  for (const [, c] of B) assert.equal((await askPanel(c + ' → ' + Q, store)).spec.template, c === 'one question' ? 'clarify_card' : 'sorted_bar', c);
});
test('no-setting numbers are read by the learner settings\' declared units (TENACITY ebd7e8c)', async () => {
  const Q = 'At The Clarendon (P04), in decisions.csv outcome learning, which channel ranks #1 with the lowest posterior CPSL, and what is its posterior CPSL in USD?';
  // rows copied verbatim from genui-entity-ebd7e8c.ts
const C: [string,string][] = [
 ['entity-set','4 units instead'],['entity-set','assume 3 properties'],['entity-set','use 2 buildings as the prior'],['entity-set','assume 4 buildings for the prior'],
 ['entity-set','the prior is 4 properties'],['entity-set','prior of 3 properties'],['entity-set','assume 12 rows'],['entity-set','assume 4 charts'],
 ['entity-set','I think 4 properties is right'],['entity-set','what if it were 4 properties'],['entity-set','what if it were 4 buildings'],['entity-set','suppose 4 buildings'],
 ['entity-set','treat it as 4 properties'],['entity-set','pretend there are 4 buildings'],['entity-set','4 properties would be better'],['entity-set','I would prefer 4 buildings'],
 ['what-if','what if it were 4 units'],['what-if','what if it were 1800'],['what-if','what if it were 4'],
 ['req+edit','show me 3 properties and use 1800'],['req+edit','show me 3 properties and use 4'],['req+edit','show me 3 properties, prior 1800'],
 ['req+edit','show me 3 properties with highest vacancy, assume 1800'],['req+edit','show me 3 properties with highest vacancy and 4 instead'],
 ['req+edit','show me 3 properties with highest vacancy, I think 4 properties'],['req+edit','show me 4 properties as the prior'],['req+edit','show me 4 buildings, use that as prior'],
 ['req+edit','How many units at P01 have 2 bedrooms? assume 4'],['req+edit','How many units at P01 have 4 bedrooms, assume that'],['req+edit','How many vacant units at Kedzie Works? I think 4 is right'],
 ['req+edit','Show me 3 properties, I would prefer 1800 dollars'],['req+edit','How many units at P01 have 1800 bedrooms?'],
 ['slipped-06921c8','I think 1800 dollars instead'],['slipped-06921c8','I think 1800 dollars would be better'],['slipped-06921c8','I think maybe 1800 dollars is right'],
 ['slipped-06921c8','I would prefer 1800 dollars here'],['slipped-06921c8','how about 1800 dollars for that'],['slipped-06921c8','please put 1800 dollars there'],
 ['slipped-06921c8','I would like 1800 dollars there'],['slipped-06921c8','I would pick 4 months for it'],['slipped-06921c8','we want 4 units instead of that'],
 ['slipped-06921c8','I think maybe 4 units is right'],['slipped-06921c8','assume one bedroom for it'],['slipped-06921c8','assume one lease here'],['slipped-06921c8','one pseudo lease please'],
 ['i18n','prefiero 4 meses para eso'],['i18n','je préfère 1800 euros pour ça'],['i18n','ich möchte 4 Monate bitte'],['i18n','supongamos 4 propiedades'],['i18n','prefiero 4 edificios'],
 ['i18n','disons 4 immeubles'],['i18n','nehmen wir 4 Gebäude an'],['i18n','mejor 3 properties'],['i18n','je préfère 4 properties'],['i18n','ich nehme 4 buildings'],
 ['i18n','muéstrame 3 properties y usa 1800'],['i18n','prefiero 1800'],['i18n','je préfère 1800'],['i18n','lieber 1800'],
];
const B: [string,string][] = [
 ['ok','Show me 3 properties with highest vacancy'],['ok','I manage 4 buildings'],['ok','We have 12 properties in Chicago'],['ok','Thanks for the 3 charts'],['ok','Thanks!'],
 ['ok','Hi'],['ok','Hello there'],['ok','Thanks for the help'],
];
  // a count of a noun no setting is stated in (properties, buildings, rows, charts, bedrooms) is not a
  // prior value and charts; a request parse reads its own count (ebd7e8c finding 4, LOW)
  // rows, charts, propiedades, edificios, immeubles are no noun the parser or schema knows: they clarify (fail closed)
  const BY_UNIT = new Set(['assume 3 properties', 'I think 4 properties is right',
    'what if it were 4 properties', 'what if it were 4 buildings', 'suppose 4 buildings', 'treat it as 4 properties',
    'pretend there are 4 buildings', '4 properties would be better', 'I would prefer 4 buildings',
    'show me 3 properties with highest vacancy, I think 4 properties', 'How many units at P01 have 4 bedrooms, assume that',
    'How many units at P01 have 1800 bedrooms?', 'assume one bedroom for it', 'mejor 3 properties', 'je préfère 4 properties', 'ich nehme 4 buildings']);
  for (const [, c] of C) assert.equal((await askPanel(c + ' → ' + Q, store)).spec.template, BY_UNIT.has(c) ? 'sorted_bar' : 'clarify_card', c);
  for (const [, c] of B) assert.equal((await askPanel(c + ' → ' + Q, store)).spec.template, 'sorted_bar', c);
  // held-out rewordings: bare values, setting units, and counts with no noun evidence clarify
  for (const c of ['make it four', 'maybe 1800 then', 'go 4 months', 'how about 3 percent', 'say 1800 USD', '4 pseudo-observations would be better',
    'honestly 1800', '1,800 dollars feels right', '3k', 'two leases please', 'what about 1800?', 'prefiero 1800 dólares', 'disons 4 mois',
    'nehmen wir 4 Monate', '1800 works', 'I think 1800 works', '4 seems right', '1800 sounds good', 'one works', '4 tho', '1800 imo', 'one tho',
    '1800 people', 'just one', '1800 passt', '4 funciona', 'one small question', 'hola, tengo 2 preguntas'])
    assert.equal((await askPanel(c + ' → ' + Q, store)).spec.template, 'clarify_card', c);
  // held-out small talk: counts of nouns that no setting takes
  for (const c of ['We met 3 clients today', 'I read 2 articles', 'Thanks for the 4 slides', 'My 2 colleagues say hi', 'We visited 5 sites',
    "j'ai 3 questions", 'Just a quick one'])
    assert.equal((await askPanel(c + ' → ' + Q, store)).spec.template, 'sorted_bar', c);
});
test('a no-setting number is let off only on noun evidence (TENACITY 724ce96)', async () => {
  const Q = 'At The Clarendon (P04), in decisions.csv outcome learning, which channel ranks #1 with the lowest posterior CPSL, and what is its posterior CPSL in USD?';
  // rows copied verbatim from genui-units-724ce96.ts
const R: [string,string,string][] = [
 // unknown verbs after a number (bare value + verb) -> C
 ['verb','C','1800 rocks'],['verb','C','1800 sounds right'],['verb','C','1800 nails it'],['verb','C','1800 tops'],['verb','C','1800 rules'],['verb','C','1800 beats that'],
 ['verb','C','4 checks out'],['verb','C','4 holds up'],['verb','C','1800 matches better'],['verb','C','1800 helps'],['verb','C','4 suffices'],['verb','C','1800 feels better'],
 ['verb','C','1800 vaut mieux'],['verb','C','1800 basta'],['verb','C','1800 stimmt'],['verb','C','4 gewinnt'],['verb','C','1800 seems fine'],['verb','C','1800 fine'],
 // setting-unit numbers -> C
 ['unit','C','2 weeks'],['unit','C','3 months'],['unit','C','5k'],['unit','C','$2k'],['unit','C','20%'],['unit','C','30 days'],['unit','C','make it 1800'],['unit','C','go with 12'],
 ['abbr','C','4 mo'],['abbr','C','4 mos'],['abbr','C','2 yrs'],['abbr','C','20 pct'],['abbr','C','1800 USD'],['abbr','C','1800 pesos'],['abbr','C','1800 euros'],['abbr','C','4 Monate'],
 ['abbr','C','4 mois'],['abbr','C','30 Tage'],['abbr','C','2 wks'],['abbr','C','3 mths'],['abbr','C','2 hrs'],['abbr','C','20 percent'],['abbr','C','1800 bucks'],['abbr','C','1800 dollars'],
 ['abbr','C','1800 CAD'],['abbr','C','1800 GBP'],['abbr','C','1800 MXN'],['abbr','C','1800 dlls'],['abbr','C','1.8k'],['abbr','C','4 leases'],['abbr','C','4 pseudo-leases'],['abbr','C','4 pseudo-observations'],
 ['abbr','C','4 pseudoobs'],['abbr','C','4 obs'],['abbr','C','4 observaciones'],['abbr','C','4 Beobachtungen'],['abbr','C','4 contrats'],['abbr','C','20 Prozent'],['abbr','C','4 quarters'],['abbr','C','6 weeks'],
 ['abbr','C','4 meses'],['abbr','C','4 semanas'],['abbr','C','4 Wochen'],['abbr','C','4 semaines'],['abbr','C','4 años'],['abbr','C','4 Jahre'],['abbr','C','4 libras'],['abbr','C','1800 francos'],
 // mixed and number words -> C
 ['mixed','C','3 properties but 1800 dollars'],['mixed','C','2 meetings, then use 4 months'],['mixed','C','4 buildings at 1800'],['mixed','C','3 properties and 20%'],['mixed','C','4 charts and 4 instead'],
 ['words','C','eighteen hundred'],['words','C','eighteen hundred dollars'],['words','C','four months'],['words','C','twenty percent'],['words','C','make it four'],['words','C','four instead'],['words','C','cuatro meses'],['words','C','vier Monate'],['words','C','quatre mois'],['words','C','a thousand bucks'],
 // pronoun / one cases
 ['one','B','Hello there, quick one'],['one','B','just a quick one'],['one','B','one more thing'],['one','B','a small one'],['one','C','use one'],['one','C','make it one'],['one','C','one instead'],
 ['one','C','one lease'],['one','C','one month'],['one','C','the prior is one'],['one','C','assume one'],['one','?','that one'],['one','?','this one is great'],['one','C','try one, quick one'],
 // entity counts -> B by rule
 ['entity','B','We had 2 meetings today'],['entity','B','I read 3 papers'],['entity','B','I manage 4 buildings'],['entity','B','nehmen wir 4 Gebäude an'],['entity','B','wir haben 4 Gebäude'],
 ['entity','B','tenemos 4 edificios'],['entity','B','I have 2 kids'],['entity','B','we have 4 people'],['entity','B','I have 3 children'],['entity','B','2 mice ran by'],['entity','B','4 Häuser'],
 // units as entity? ('units' is a setting unit)
 ['units','C','4 units instead'],['units','?','we have 200 units'],['units','?','I manage 2000 units'],
];
  // no noun the parser or schema knows and no counting frame: these clarify (fail closed, needs TENACITY approval)
  const NO_EVIDENCE = new Set(['one more thing', 'nehmen wir 4 Gebäude an', 'tenemos 4 edificios', '2 mice ran by', '4 Häuser']);
  for (const [, e, c] of R) if (e !== '?') assert.equal((await askPanel(c + ' → ' + Q, store)).spec.template, e === 'C' || NO_EVIDENCE.has(c) ? 'clarify_card' : 'sorted_bar', c);
  // held-out rewordings, not run against the code before they were written
  for (const c of ['1800 wins', '4 does the trick', '1800 slaps', 'they said 4 works', 'I said 1800 tops', 'cinco meses', 'drei Monate', 'deux semaines',
    '4 contratos', '1800 libras', '3 mnths', '2 wk', '4 Verträge', '1800 dls', 'what about 4', 'honestly 4 is plenty', 'one tops', 'quatre contrats'])
    assert.equal((await askPanel(c + ' → ' + Q, store)).spec.template, 'clarify_card', c);
  for (const c of ['We toured 3 apartments', 'I saw 2 studios', 'Thanks for the 5 answers', 'our 3 leads called', 'they own 6 homes', 'ich habe 2 Fragen'])
    assert.equal((await askPanel(c + ' → ' + Q, store)).spec.template, 'sorted_bar', c);
});
