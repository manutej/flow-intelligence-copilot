import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

// TENACITY's s9 rows (VERDICT-S2-d9e6cc1) plus new rewordings.
const store = loadPortfolioStore();
const ask = async (q: string) => (await askFlowIqCopilot(q, { store, parse: null })).envelope;
const r = (e: { result: unknown }) => e.result as Record<string, unknown>;
const refused = (e: { result: unknown }) => r(e).unknown === true || r(e).clarification_needed === true;

for (const q of ['How many leads in Q3 2026?', 'Number of leads in Q3 2026?', 'How many leads in Q2 2026 at Marlowe Residences?', 'Spend at FY in Q3 2026?']) {
  test(`s9: answers: ${q}`, async () => {
    const e = await ask(q);
    assert.ok(!refused(e), e.answer);
  });
}
for (const q of [
  'Spend in FY at Kedzie Works?', 'Marketing spend in FY at Kedzie Works?', 'Spend at FY and Kedzie Works in Q3 2026?',
  'Spend over leads?', 'Spend over leads at Kedzie Works in Q3 2026?', 'Spend ÷ leads at Kedzie Works in Q3?',
  'Spend per signed lease at Kedzie Works in Q3?', 'Marketing spend for the FY?', 'Renewal rate for FY?',
  // Rewordings not in s9.
  'Marketing spend against tours at Marlowe in Q2 2026?', 'Spend to leases at Marlowe in Q2 2026?',
  'Lead count at FY and Marlowe in Q2 2026?', 'Occupancy in the FY?', 'Cost per lease at Marlowe in Q2 2026?',
  'Marketing spend and leads at Marlowe in Q2 2026?',
]) {
  test(`s9: not one figure: ${q}`, async () => {
    const e = await ask(q);
    assert.ok(refused(e), `answered: ${e.answer}`);
  });
}
test('a refusal never ends in an empty "Did you mean"', async () => {
  for (const q of ['Cmopare Printers Row Tower and the Marlowe on average rent.', 'Fiscally speaking, lead count in Q2 2026?']) {
    const e = await ask(q);
    assert.doesNotMatch(e.answer, /Did you mean:\s*\?/, e.answer);
    assert.match(e.answer, /no meaning for/);
  }
});
test('a ranked cost per signed lease still names its source', async () => {
  const e = await ask('Which paid source had the lowest cost per signed lease at Kedzie Works in Q3 2026?');
  assert.ok(!refused(e), e.answer);
  assert.match(e.answer, /lowest cost per signed lease/);
});
