import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

// TENACITY's s17 rows (VERDICT-S2-3b34409, s17-probes.ts, s17-supp.ts) and
// the set rows it named. The "own rewordings" rows were written after the
// fix code, to exercise each category beyond the spellings TENACITY tried.
const store = loadPortfolioStore();
const turn = (q: string) => askFlowIqCopilot(q, { store, parse: null });
const r = (e: { result: unknown }) => e.result as Record<string, unknown>;
const answered = (e: { result: unknown }) => !(r(e).unknown === true || r(e).clarification_needed === true || r(e).refused === true);

for (const q of [
  // Finding 1: a source-currency phrase is never a free pass.
  'Spend at Kedzie Works in Q3 2026 billed in CAD?', 'Spend at Kedzie Works in Q3 2026 in CAD rows?',
  // Finding 2: two measures, one figure.
  'vacancy and renewal rate at Kedzie Works?', 'Quick one: vacancy and renewal rate at Kedzie Works?',
  // Finding 4: leaks from fresh spellings.
  'Occupancy at Kedzie Works at end-of-year?', 'Spend at Kedzie Works up to now?',
  'Spend at Kedzie Works in Q3 2026 in ₹?', 'Spend at Kedzie Works in Q3 2026, CAD rate?',
  // Own rewordings, one per category.
  'Spend at Kedzie Works in Q3 2026 in SEK?', 'Spend at Kedzie Works in Q3 2026 in HK$?', 'Spend at Kedzie Works in Q3 2026 in Indian rupees?',
  'Spend at Kedzie Works in Q3 2026 in Canadian funds?', 'Occupancy at Kedzie Works at the end of the quarter?',
  'Occupancy at Kedzie Works at month‑end?', 'Spend at Kedzie Works until today?', 'Leases at Kedzie Works as of now?',
  'Occupancy and lease count at Kedzie Works?',
]) {
  test(`s17: not answered: ${q}`, async () => assert.equal(answered((await turn(q)).envelope), false));
}

// Finding 3: a building one edit away gets exactly one option, the question with the name corrected.
for (const [q, building] of [
  ['Vacancy rate at Armitage Cmomons?', 'Armitage Commons'],
  ['Vacancy rate at Kedzie Wroks?', 'Kedzie Works'],
  ['Vacancy rate at Marlowe Resdiences?', 'Marlowe Residences'],
  ['Residential vacancy at Marlowe Residenecs?', 'Marlowe Residences'],
  ['Average rent in Armitage Commns?', 'Armitage Commons'],
  ['vacancy at armitage common?', 'Armitage Commons'],
] as const) {
  test(`s17: did-you-mean ${building}: ${q}`, async () => {
    const t = await turn(q);
    assert.equal(r(t.envelope).clarification_needed, true);
    assert.equal(t.clarifyOptions?.length, 1);
    assert.match(t.clarifyOptions![0].question, new RegExp(building));
    assert.match(t.clarifyOptions![0].label, new RegExp(building));
  });
}

// No reading drops a measure noun, a locative, or one of two measures.
for (const q of [
  'Operating snapshot of Kedzie Works for LPs: units, vacancy, leads.',
  "What's the submarket vacancy around Marlowe Resiednces?",
  'Unit count and vacancy at Wabash Ponit?',
  'Vacancy at Copper Mlil?',
]) {
  test(`s17: no reading drops the measure or place: ${q}`, async () => {
    const t = await turn(q);
    assert.equal(answered(t.envelope), false);
    for (const o of t.clarifyOptions ?? []) assert.match(o.question, /lead|submarket|unit count/i);
  });
}

// Finding 5: "for the period" names no window, so each option names one.
for (const q of ["what's the renewal rate at the point for the period?", "What's the renewal rate at Fulton Yards for the period?"]) {
  test(`s17: unnamed period clarifies: ${q}`, async () => {
    const t = await turn(q);
    assert.equal(r(t.envelope).clarification_needed, true);
    assert.ok((t.clarifyOptions?.length ?? 0) >= 1);
    for (const o of t.clarifyOptions!) {
      assert.match(o.question, /renewal rate/i);
      assert.match(o.question, /20\d\d/);
      // The option is answered over the window it names, never over all end dates.
      const picked = (await turn(o.question)).envelope;
      assert.ok(answered(picked));
      assert.doesNotMatch(picked.answer, /all end dates/);
    }
  });
}

// Finding 6: the label names the window "this year" was read as.
for (const [q, pct] of [['What is the renewal rate at the Commons this year?', '55.9%'], ['What is the renewal rate at Halsted & Lake this year?', '44.8%']] as const) {
  test(`s17: this-year label: ${q}`, async () => {
    const e = (await turn(q)).envelope;
    assert.ok(answered(e));
    assert.match(e.answer, /ending in 2026/);
    assert.doesNotMatch(e.answer, /all end dates/);
    assert.ok(e.answer.includes(pct));
  });
}

// Controls: USD and plain questions still answer.
test('s17 control: USD spend answers', async () => assert.match((await turn('Spend at Kedzie Works in Q3 2026 in USD please')).envelope.answer, /\$13,384\.50/));
test('s17 control: vacancy answers', async () => assert.match((await turn('Vacancy at Kedzie Works?')).envelope.answer, /14 vacant units/));
test('s17 control: source names are not measures', async () => assert.ok(answered((await turn('Cost per lead from Zillow and Rent. at Marlowe Residences in Q2 2026?')).envelope)));
