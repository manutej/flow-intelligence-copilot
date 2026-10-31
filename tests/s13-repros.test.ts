import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

// TENACITY's s13 rows (VERDICT-S2-e8c291c) plus rewordings written at
// 2026-10-31 04:47 CST against e8c291c, before any s13 fix ran
// (/tmp/s13/own-rewordings.txt). Truths from repros/s13-truth.ts and
// repros/s13-truth2.ts.
const store = loadPortfolioStore();
const ask = async (q: string) => (await askFlowIqCopilot(q, { store, parse: null })).envelope;
const r = (e: { result: unknown }) => e.result as Record<string, unknown>;
const refused = (e: { result: unknown }) => r(e).unknown === true || r(e).clarification_needed === true;

for (const q of [
  // Finding 1: date spellings the parse does not consume.
  'Marketing spend in 2026/07?', 'Marketing spend in 2026.07?', 'Marketing spend in 2026-7?', 'Marketing spend in 2026 07?',
  'Marketing spend in 07-2026?', 'Marketing spend on 07/15/2026?', 'Marketing spend in 2H 2026?',
  // Finding 2: a source named outside from/via.
  'Spend on Facebook at Kedzie Works in Q3 2026?', 'Facebook cost per lead at Kedzie Works in Q3 2026?',
  'Cost per lead for Facebook at Kedzie Works in Q3 2026?', 'Cost per lead with Facebook at Kedzie Works in Q3 2026?',
  'Cost per lead through Facebook at Kedzie Works in Q3 2026?', 'Cost per lead on Google at Kedzie Works in Q3 2026?',
  // Finding 3: a second period that narrows the first.
  'Marketing spend in Q3 2026 for July?', 'Marketing spend in Q3 2026 (July only)?',
  // Finding 5: FY split by any punctuation or symbol.
  'Spend at F_Y in Q3 2026?', 'Spend at F/Y in Q3 2026?', 'Spend at F–Y in Q3 2026?', 'Spend at Ｆ Ｙ in Q3 2026?',
  // Own rewordings (04:47 file).
  'Marketing spend in 2026_07?', 'Marketing spend in 9-2026?', 'Marketing spend during 2026 08?',
  'Marketing spend in Q2 2026 for May?', 'Marketing spend in Q3 2026 just August?',
  'Cost per tour for Apartments at Kedzie Works in Q3 2026?',
  'Spend at F~Y in Q3 2026?', 'Spend at F|Y in Q3 2026?', 'Spend at F·Y in Q3 2026?',
]) {
  test(`s13: refuses rather than answering a wider question: ${q}`, async () => {
    const e = await ask(q);
    assert.ok(refused(e), `answered: ${e.answer}`);
  });
}

test('s13 finding 4: a three-way tie at 0.0% names every tied source', async () => {
  const e = await ask('Which source had the lowest tour to lease rate at Kedzie Works in Q3 2026?');
  assert.match(e.answer, /Apartment List, Facebook Ads and Google Ads tied for the lowest tour-to-lease rate at 0\.0%/);
  assert.deepEqual(r(e).tied_sources, ['Apartment List', 'Facebook Ads', 'Google Ads']);
});

for (const [q, re] of [
  ['Marketing spend in July 2026?', /\$35,592\.80/],
  ['Marketing spend for Sep. 2026 only?', /\$38,591\.70/],
  ['Cost per lead from Facebook Ads at Kedzie Works in Q3 2026?', /\$120\.45/],
  ['Spend at Kedzie Works in Q3 2026?', /\$13,384\.50/],
  ['Spend with Zillow at Kedzie Works in Q3 2026?', /\$3,500\.00/],
  ['Zillow spend at Kedzie Works in Q3 2026?', /\$3,500\.00/],
  ['Which source had the highest tour to lease rate at Kedzie Works in Q3 2026?', /Referral had the highest tour-to-lease rate at 62\.5%/],
  ['Marketing spend in H2 2026?', /months after the data ends have no rows\), .*\$111,893\.30/],
] as const) {
  test(`s13: fully covered question still answers: ${q}`, async () => {
    const e = await ask(q);
    assert.ok(!refused(e), `refused: ${e.answer}`);
    assert.match(e.answer, re);
  });
}
