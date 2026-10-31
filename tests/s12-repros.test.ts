import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

// TENACITY's s12 rows (VERDICT-S2-d1091cb) plus rewordings written at
// 2026-10-31 03:44 CST against d1091cb, before any s12 fix ran
// (/tmp/s12/own-rewordings.txt). Truths from repros/s12-truth.ts and
// repros/s12-p32.ts.
const store = loadPortfolioStore();
const ask = async (q: string) => (await askFlowIqCopilot(q, { store, parse: null })).envelope;
const r = (e: { result: unknown }) => e.result as Record<string, unknown>;
const refused = (e: { result: unknown }) => r(e).unknown === true || r(e).clarification_needed === true;

for (const q of [
  // Finding 1: single date tokens, H2 and MM/YYYY are checked.
  'Marketing spend in 07/2026 and 08/2026?', 'Marketing spend on 2026-07-15?',
  // Finding 2: an unknown source is a leftover.
  'Cost per lead from Facebook at Kedzie Works in Q3 2026?',
  // Finding 3: bedroom filters do not apply to spend.
  'Cost per lead for 2-bedroom leads at Kedzie Works in Q3 2026?', 'Spend on studios at Kedzie Works in Q3 2026?',
  // Finding 5: an unranked which names no source.
  'Cost per signed lease, which channel at Kedzie Works in Q3 2026?', 'Cost per signed lease which source at Kedzie Works in Q3 2026?',
  'Which channel at Kedzie Works in Q3 2026? cost per signed lease?',
  // Finding 6.
  'Spend at F  Y in Q3 2026?', 'Spend at F-Y in Q3 2026?',
  // Own rewordings (03:44 file).
  'Cost per lead from FB at Kedzie Works in Q3 2026?', 'Cost per lead from Craigslist at Kedzie Works in Q3 2026?',
  'Lead count from TikTok at Kedzie Works in Q3 2026?', 'Cost per lead among studio leads at Kedzie Works in Q3 2026?',
  'Marketing spend for 1-bedroom units at Kedzie Works in Q3 2026?', 'Cost per signed lease, what source, Kedzie Works Q3 2026?',
  'Cost per signed lease broken down by source at Kedzie Works in Q3 2026?', 'Spend at F - Y in Q3 2026?', 'Spend at f   y in Q3 2026?',
  'How many leads wanted 2+ bedroom units at PRT?',
]) {
  test(`s12: not one figure: ${q}`, async () => {
    const e = await ask(q);
    assert.ok(refused(e), `answered: ${e.answer}`);
  });
}

for (const [q, want] of [
  // Finding 4: the eight P32 lead counts, with building and filter restated.
  ['How many leads wanted 1-bedroom units at the Commons?', /Armitage Commons.*\b31 leads that wanted a 1-bedroom unit/],
  ['How many leads wanted studio units at PRT?', /Printers Row Tower.*\b51 leads that wanted a studio/],
  ['How many leads wanted 2-bedroom units at Printers Row Tower?', /Printers Row Tower.*\b77 leads that wanted a 2-bedroom unit/],
  ['How many leads wanted 1-bedroom units at Marlowe Residences?', /Marlowe Residences.*\b87 leads that wanted a 1-bedroom unit/],
  ['How many leads did Halsted & Lake get this year? Exclude down units.', /Halsted & Lake.*\b179 leads.*Unit status/],
  ['How many leads wanted 1-bedroom units at the Yards?', /Fulton Yards.*\b57 leads that wanted a 1-bedroom unit/],
  ['How many leads wanted studio units at Fulton Yards?', /Fulton Yards.*\b28 leads that wanted a studio/],
  ['How many leads wanted studio units at the Point?', /Wabash Point.*\b28 leads that wanted a studio/],
  // Finding 1 and LOW: windows that do parse answer their own figure.
  ['Marketing spend in H2 2026?', /2026-07-01 to 2026-12-31.*\$111,893\.30/],
  ['Marketing spend in 2026-07?', /\$35,592\.80/],
  ['Marketing spend in 09/2026?', /\$38,591\.70/],
  ['Marketing spend from 2026-04 to 2026-06?', /\$112,706\.60/],
  ['Marketing spend between 2026-07-01 and 2026-08-31?', /\$73,301\.60/],
  ['Marketing spend in 2026-07 through 2026-08?', /\$73,301\.60/],
  // Finding 5: one resolver for every source measure.
  ['Cost per signed lease by source at Kedzie Works in Q3 2026?', /Kedzie Works.*by paid source:.*Apartments\.com \$2,150\.00.*Google Ads \$1,830\.00.*Zillow \$1,750\.00/],
  ['Which channel had the lowest cost per lead at Kedzie Works in Q3 2026?', /Facebook Ads had the lowest cost per lead.*\$120\.45/],
  ['Which source had the highest cost per lead at Kedzie Works in Q3 2026?', /Apartments\.com had the highest cost per lead.*\$330\.77/],
  ['Which source had the lowest cost per tour at Kedzie Works in Q3 2026?', /Apartment List had the lowest cost per tour.*\$510\.00/],
  ['Which channel had the highest tour to lease rate at Kedzie Works in Q3 2026?', /Referral.*62\.5%/],
  // Controls (03:44 file).
  ['Facebook Ads cost per lead at Kedzie Works in Q3 2026?', /Kedzie Works.*\$120\.45/],
  ['How many leads wanted studio apartments at Fulton Yards?', /\b28 leads that wanted a studio/],
  ['Marketing spend in July 2026?', /\$35,592\.80/],
  ['Spend at FY in Q3 2026?', /Fulton Yards \(P03\).*\$13,640\.00/],
] as const) {
  test(`s12: answers: ${q}`, async () => {
    const e = await ask(q);
    assert.ok(!refused(e), e.answer);
    assert.match(e.answer, want);
  });
}
