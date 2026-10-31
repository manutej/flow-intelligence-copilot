import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

// TENACITY's s14 rows (VERDICT-S2-5738aef, repros/s14-probes*.ts and
// s14-rank.ts) plus rewordings written at 2026-10-31 05:24 CST against
// 5738aef, before any s14 fix ran (/tmp/s14/own-rewordings.txt).
// Truths from data/pms/leases.csv and units.csv as quoted in the verdict.
const store = loadPortfolioStore();
const ask = async (q: string) => (await askFlowIqCopilot(q, { store, parse: null })).envelope;
const r = (e: { result: unknown }) => e.result as Record<string, unknown>;
const refused = (e: { result: unknown }) => r(e).unknown === true || r(e).clarification_needed === true;
const notFyClarify = (e: { answer: string }) => !/which FY you mean/i.test(e.answer);

for (const q of [
  // Finding 1: dates the parse does not consume, on every measure.
  'Concessions at Kedzie Works in 2026/07?', 'How many leases end at Kedzie Works in 2026/07?',
  'Renewal rate at Kedzie Works in 2026/07?', 'Renewal rate at Kedzie Works in 2026.07?', 'Renewal rate in 2026/07?',
  // Finding 1: a snapshot measure asked for another period.
  'What is the occupancy at Kedzie Works in 2026/07?', 'What is the occupancy at Kedzie Works on 07/15/2026?',
  'What is the occupancy at Kedzie Works in 2H 2026?', 'What is the occupancy at Kedzie Works as of 2026/07/01?',
  'What is the occupancy at Kedzie Works in 2025?', 'What is the vacancy rate at Kedzie Works in Q3 2026?',
  'How many vacant units are at Kedzie Works in 07-2026?', 'Average rent for 2BR at Kedzie Works in 2026/07?',
  // Finding 2: an unresolved place never drops to the portfolio.
  'What is the occupancy at Printer Row?', 'What is the vacancy rate at Printer Row?',
  'What is the average rent at Printer Row?', 'Renewal rate at Printer Row?', 'How many vacant units at Printer Row?',
  'Cost Per Lead At The Clarendon Annex In Q3 2026?',
  // Finding 4: filters the figure cannot carry.
  'What is the occupancy at Kedzie Works for unit 304?', 'What is the vacancy rate at Kedzie Works with a dog?',
  'What is the occupancy at Kedzie Works in building B?', 'What is the average rent at Kedzie Works in building B?',
  'What is the occupancy at Kedzie Works from Facebook?', 'What is the vacancy rate at Kedzie Works on Zillow?',
  'What is the occupancy at Kedzie Works for 4-bedroom units?', 'What is the vacancy rate at Kedzie Works for 4-bedroom units?',
  'Which property has the most 4-bedroom units?',
  // Own rewordings (05:24 file).
  'Average concession at Kedzie Works in 2026_07?',
  'Renewal rate at Kedzie Works for 2026 07?', 'What is occupancy at Kedzie Works in 2024?', 'Vacancy at Kedzie Works next quarter?',
  'Average rent at Printers Raw?', 'Occupancy at Halstead Lofts?', 'How many vacant units at Kedzie Works for apartment 210?',
  'Average rent at Kedzie Works for cat owners?', 'Occupancy at Kedzie Works tower C?', 'Average rent at Kedzie Works from Zillow leads?',
  'Vacancy rate at Kedzie Works for 5-bedroom units?',
]) {
  test(`s14: refuses rather than answering a wider question: ${q}`, async () => {
    const e = await ask(q);
    assert.ok(refused(e), `answered: ${e.answer}`);
  });
}

test('s14 finding 3: renewal rate names the leases and denominator it uses', async () => {
  const e = await ask('Renewal rate at Kedzie Works?');
  assert.match(e.answer, /96 matching leases on file \(all end dates\), 17 of the 40 with a renewal outcome have renewed/);
  assert.match(e.answer, /42\.5%/);
  assert.doesNotMatch(e.answer, /ending in April to September 2026/);
});

test('s14 finding 3: a renewal window with no lease ends is refused, not relabelled', async () => {
  assert.ok(refused(await ask('Renewal rate at Kedzie Works in July 2026?')));
});

test('s14 finding 3: concession ranking filters on the window its label names', async () => {
  const e = await ask('Which property has the highest average concession?');
  assert.match(e.answer, /Armitage Commons \(P05\).*April to September 2026 at \$531\.25 across 8 leases/);
});

for (const q of ['Spend at Kedzie Works in Q3 2026, f-y-i?', 'Spend at Kedzie Works in Q3 2026 F.Y.I.?', 'Spend at Kedzie Works in Q3 2026, F.Y.I.?']) {
  test(`s14 LOW: FY is not read inside f-y-i: ${q}`, async () => {
    assert.ok(notFyClarify(await ask(q)));
  });
}

for (const [q, re] of [
  ['Concessions at Kedzie Works in July 2026?', /\$1,750\.00/],
  ['What is the occupancy at Kedzie Works?', /87\.3%/],
  ['Occupancy at Printers Row?', /95\.3%.*162 of 170/],
  ['How many units are at Kedzie Works on floor 3?', /18 matching units/],
  ['How many units are at Kedzie Works for units over 900 sq ft?', /46 matching units/],
  ['What is the average rent at Kedzie Works?', /\$2,225\.82/],
  ['How many units are at Kedzie Works for 2-bedroom units?', /37 matching units/],
  ['Renewal rate across all 8 buildings?', /renewal rate/],
  // The 05:24 file listed this as N; the parse reads 9/2026 as September
  // 2026, and one Kedzie lease ends then, so the answer is right.
  ['How many leases expire at Kedzie Works in 9/2026?', /Kedzie Works \[P06\]: 1\)/],
  ["FY's spend in Q3 2026?", /which FY you mean/i],
] as const) {
  test(`s14: covered question still answers as before: ${q}`, async () => {
    const e = await ask(q);
    assert.match(e.answer, re);
  });
}
