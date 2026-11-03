import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { spendUsd, usd, usdRe, round2, cpl, FX } from './fixtures/fx-expect.ts';
// Every CAD row (P06 and P07 Facebook Ads) sits in a dead pair, so the kit figure moves by the whole CAD delta.
const DEAD_USD = round2(46599.9 - spendUsd({}, 0.73) + spendUsd({}));
const YTD_USD = spendUsd({from:'2026-01',to:'2026-09'});

// TENACITY's s15 rows (VERDICT-S2-b551a31, repros/s15b-probes.ts and
// s15-lost.ts) plus own rewordings from /tmp/s15/own-rewordings.txt. That
// file was written after the s15 fix code and before this commit, so these
// rewordings are not blind. Truths from data/pms/*.csv as quoted below.
const store = loadPortfolioStore();
const ask = async (q: string) => (await askFlowIqCopilot(q, { store, parse: null })).envelope;
const r = (e: { result: unknown }) => e.result as Record<string, unknown>;
const notAnswered = (e: { result: unknown }) => r(e).unknown === true || r(e).clarification_needed === true || r(e).refused === true;

for (const q of [
  // Finding 1: a lower-case place that resolves to no one building.
  'Occupancy at printer row?', 'vacancy rate at printer row?', 'average rent at printer row?',
  'renewal rate at printer row?', 'concessions at printer row?', 'how many leases end at printer row in Q3 2026?',
  'spend at printer row in Q3 2026?', 'occupancy at the clarendon annex?',
  // Finding 2: a snapshot asked at a period end; a lease term the ledger lacks.
  'Occupancy at Kedzie Works at end of year?', 'Occupancy at Kedzie Works at quarter end?',
  'Occupancy at Kedzie Works at month end?', 'Average rent at Kedzie Works at year end?',
  'Renewal rate at Kedzie Works for month-to-month leases?', 'concessions at Kedzie Works for month-to-month leases?',
  // Finding 4: a currency other than USD.
  'Spend at Kedzie Works in Q3 2026 in CAD?', 'Cost per lead at Kedzie Works in Q3 2026 in CAD?',
  'Average rent at Kedzie Works in CAD?',
  // Leaks the format tail used to hide (grounded P09-G005, P32-G032, P05-G017).
  'occupancy at the lake property?',
  'How many leases are ending and how many renewed at the Marlowe?',
  // Own rewordings.
  'Occupancy at printers raw?', 'renewal rate at the marlowe tower?',
  'Average rent at Kedzie Works at the end of the quarter?', 'Vacant units at Kedzie Works at EOY?',
  'Concessions at Kedzie Works for 6-month leases?', 'Renewal rate at Kedzie Works for m2m leases?',
  'Spend at Kedzie Works in Q3 2026 in euros?', 'Cost per lead at Kedzie Works in Q3 2026 converted to CAD?',
]) {
  test(`s15: does not answer: ${q}`, async () => {
    assert.ok(notAnswered(await ask(q)));
  });
}

// M-9 (Manu, 2026-10-31) supersedes the P32-G032 leak reading: YTD is
// answered over 2026-01-01..2026-09-28 and labelled partial.
for (const q of ['How many leads did Kedzie Works get year to date?', 'How many leads did Kedzie Works get YTD?']) {
  test(`s15 M-9: answers YTD as partial: ${q}`, async () => {
    const e = await ask(q);
    assert.ok(!notAnswered(e), e.answer);
    assert.match(e.answer, /2026-01-01 to 2026-09-28 \(year to date, partial\).*158 leads/);
  });
}

// Finding 3: a format instruction is not part of the question.
test('s15 finding 3: P30-G040 on-notice units answer through the bullet tail', async () => {
  const e = await ask('How many on-notice units at Armitage Commons? Keep it to 3 bullets.');
  // units.csv: P05 has 2 rows with status notice, 90 rows in all.
  assert.match(e.answer, /Armitage Commons \(P05\) has 2 notice units \(out of 90 total units\)/);
});
test('s15 finding 3: P30-G027 the Annex reads as Cornell Annex through the bullet tail', async () => {
  const e = await ask('Vacancy at the Annex? Keep it to 3 bullets.');
  assert.match(e.answer, /Cornell Annex \(P09\)/);
});
test('s15 finding 3: P41-G039 keeps its Marlowe clarify through the bullet tail', async () => {
  const e = await ask('Residential vacancy at the Marlowe? Keep it to 3 bullets.');
  assert.equal(r(e).clarification_needed ?? (e as { clarification_needed?: boolean }).clarification_needed ?? r(e).unknown, true);
  assert.match(e.answer, /\(1\)[^;]*status = vacant, at Marlowe Residences \(P02\)/);
});

for (const [q, re] of [
  ['Occupancy at the Tower?', /Printers Row Tower \(P07\), 95\.3%/],
  ['Occupancy at Kedzie Works? Show your math.', /87\.3%/],
  ['Spend at Kedzie Works in Q3 2026 in USD?', new RegExp(usdRe(spendUsd({from:'2026-07',to:'2026-09',pid:'P06'})).source + ' USD')],
  ['Across operating buildings, how many total units are there and how many are occupied?', /1100 total units/],
  ['renewal rate at kedzie works for new leases?', /Kedzie Works \(P06\)/],
] as const) {
  test(`s15: still answers: ${q}`, async () => {
    assert.match((await ask(q)).answer, re);
  });
}
