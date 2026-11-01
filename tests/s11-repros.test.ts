import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { spendUsd, usd, usdRe, round2, cpl, FX } from './fixtures/fx-expect.ts';
// Every CAD row (P06 and P07 Facebook Ads) sits in a dead pair, so the kit figure moves by the whole CAD delta.
const DEAD_USD = round2(46599.9 - spendUsd({}, 0.73) + spendUsd({}));
const YTD_USD = spendUsd({from:'2026-01',to:'2026-09'});

// TENACITY's s11 rows (VERDICT-S2-bc7e870) plus rewordings written at
// 2026-10-31 02:52 CST against bc7e870, before any s11 fix ran.
const store = loadPortfolioStore();
const ask = async (q: string) => (await askFlowIqCopilot(q, { store, parse: null })).envelope;
const r = (e: { result: unknown }) => e.result as Record<string, unknown>;
const refused = (e: { result: unknown }) => r(e).unknown === true || r(e).clarification_needed === true;
const K = 'at Kedzie Works in Q3 2026?';

for (const q of [
  // Finding 1: a quarter range never answers its first quarter alone ($112,706.60).
  'Marketing spend from Q2 to Q3 2026?', 'Marketing spend Q2 through Q3 2026?', 'Marketing spend in Q2-Q3 2026?',
  'Marketing spend between Q2 and Q3 2026?', 'Marketing spend in Q2 2026 to Q3 2026?', 'Cost per lead from Q2 through Q3 2026 at Kedzie Works?',
  // Finding 2: ISO months.
  'Marketing spend in 2026-07 and 2026-08?',
  // Finding 3: measure nouns from every domain.
  `Spend and renewals ${K}`, `Spend and move-ins ${K}`, `Spend and occupancy ${K}`, `Cost per lead and renewals ${K}`,
  `Cost per lead and move-ins ${K}`, `Cost per lead and occupancy ${K}`, `Cost per lead and conversions ${K}`,
  `Spend per conversion ${K}`, `Spend per new resident ${K}`, `How many leads converted ${K}`, `How many leads moved in ${K}`,
  `Tour to lease rate per dollar ${K}`,
  // Finding 4: an unranked "which" never names row 0.
  `Which channel ${K.replace('?', '')}? cost per lead?`, `Cost per lead which source ${K}`, `Cost per tour which channel ${K}`,
  // Finding 6.
  'Spend at F Y in Q3 2026?',
  // Own rewordings (02:52 file).
  'Lead count from Q2 through Q3 2026?', 'Marketing spend Q2 thru Q3 2026?', 'Marketing spend in Q2–Q3 2026?',
  'Marketing spend for 2026-07 and 2026-09?',
  'Spend plus renewals at Marlowe Residences in Q2 2026?', 'Cost per lead with move-ins at Marlowe Residences in Q2 2026?',
  'Spend per renewal at Marlowe Residences in Q2 2026?', 'Lead count and occupancy at Marlowe Residences in Q2 2026?',
  'Spend per conversion at Marlowe Residences in Q2 2026?', 'What channel at Marlowe Residences in Q2 2026, cost per lead?',
  'Cost per lead, which vendor, Marlowe Residences Q2 2026?', 'Cost per lead from listing sites at Marlowe Residences in Q2 2026?',
  'Spend at F Y in Q2 2026?', 'Lead count at F Y in Q2 2026?',
]) {
  test(`s11: not one figure: ${q}`, async () => {
    const e = await ask(q);
    assert.ok(refused(e), `answered: ${e.answer}`);
  });
}

for (const [q, want, not] of [
  // Finding 4: several named sources pool and name every source.
  [`Cost per lead from Zillow and Apartments.com ${K}`, /pooled cost per lead was \$325\.00.*Apartments\.com and Zillow/, /overall/],
  ['Cost per lead from Zillow and Rent. at Marlowe Residences in Q2 2026?', /\$224\.32/, null],
  // Finding 5: a subset is labelled as the subset.
  [`Cost per lead for paid sources ${K}`, new RegExp(usdRe(cpl(spendUsd({from:'2026-07',to:'2026-09',pid:'P06'}), 60)).source + '.*paid sources'), /all sources/],
  [`Tour to lease rate for paid sources ${K}`, /22\.2%/, /all sources/],
  [`Cost per lead from ILS ${K}`, new RegExp(usdRe(cpl(spendUsd({from:'2026-07',to:'2026-09',pid:'P06'}), 60)).source + '.*paid sources'), /all sources/],
  [`Cost per lead by marketing source ${K}`, new RegExp('Facebook Ads ' + usdRe(cpl(spendUsd({from:'2026-07',to:'2026-09',pid:'P06',sources:['Facebook Ads']}), 10)).source), /overall/],
  // Controls that must still answer.
  ['Marketing spend from July to September 2026?', usdRe(spendUsd({from:'2026-07',to:'2026-09'})), null],
  ['Marketing spend in July and August 2026?', usdRe(spendUsd({from:'2026-07',to:'2026-08'})), null],
  // VERDICT-S2-d1091cb LOW: an ISO month range is a window, not a refusal.
  ['Marketing spend in 2026-07 through 2026-08?', usdRe(spendUsd({from:'2026-07',to:'2026-08'})), null],
  ['Marketing spend in Q3 and September 2026?', usdRe(spendUsd({from:'2026-07',to:'2026-09'})), null],
  [`Cost per lead from Zillow ${K}`, /\$318\.18/, null],
  [`Tour to lease rate ${K}`, /33\.3%/, null],
  [`Cost per lead ${K}`, usdRe(cpl(spendUsd({from:'2026-07',to:'2026-09',pid:'P06'}), 84)), null],
  ['Spend at FY in Q2 2026?', /Fulton Yards \(P03\)/, null],
] as const) {
  test(`s11: answers: ${q}`, async () => {
    const e = await ask(q);
    assert.ok(!refused(e), e.answer);
    assert.match(e.answer, want);
    if (not) assert.doesNotMatch(e.answer, not);
  });
}
