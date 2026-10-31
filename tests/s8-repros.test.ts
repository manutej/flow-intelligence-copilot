import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

// Rows from TENACITY's s8 repro set (VERDICT-S2-6c95fcd findings 1-5).
const store = loadPortfolioStore();
const ask = async (q: string) => (await askFlowIqCopilot(q, { store, parse: null })).envelope;
const r = (e: { result: unknown }) => e.result as Record<string, unknown>;
const refused = (e: { result: unknown }) => r(e).unknown === true || r(e).clarification_needed === true;

for (const q of [
  'Top-3 buildings by renewal rate?', 'Top 3 by renewal rate?', 'Who has the highest renewal rate?',
  'The building with the highest renewal rate?', 'Highest renewal rate building?', 'Renewal rate highest to lowest?',
  'How do the buildings compare on renewal rate?', 'Spend / lead at Kedzie Works in Q3?',
  'Spend divided by leads at Kedzie Works in Q3?', 'Spend for each lead at Kedzie Works in Q3?',
  'Marketing spend between Kedzie Works and Marlowe in Q3 2026?', 'Which is higher on renewal rate, Kedzie Works or Marlowe?',
  'Marketing spend Q3 FY2026?', 'Marketing spend in Q3 of fiscal 2026?', 'Marketing spend Q3 fiscal year 2026?',
  'Marketing spend Q3 2026 fiscal?', 'Marketing spend in 2026 Q3 (fiscal)?', 'Marketing spend in Q2 FY26?',
  'Marketing spend in the 2026 fiscal year?', 'Marketing spend for the fiscal year ending June 2026?',
  'Marketing spend fiscal year ending 2026?', 'Marketing spend in the fiscal quarter ending Sep 2026?',
]) {
  test(`s8: not answered with a figure: ${q}`, async () => {
    const e = await ask(q);
    assert.ok(refused(e), `answered: ${e.answer}`);
  });
}
for (const q of ['FY spend?', 'Marketing spend FY?', 'FY renewal rate?', 'Marketing spend FY at Kedzie Works?']) {
  test(`s8: bare FY asks which FY: ${q}`, async () => {
    const e = await ask(q);
    assert.equal(r(e).clarification_needed, true, e.answer);
    assert.match(e.answer, /Fulton Yards/);
  });
}
for (const q of ['Marketing spend calendar year 2026?', 'Marketing spend in calendar 2026?', 'Marketing spend CY2026?']) {
  test(`s8: a calendar year answers the whole year: ${q}`, async () => {
    const e = await ask(q);
    assert.ok(!refused(e), e.answer);
    assert.match(e.answer, /2026-01-01 to 2026-12-31/);
  });
}
