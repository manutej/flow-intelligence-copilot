import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

// One figure only when every content word is accounted for. Wordings are new.
const store = loadPortfolioStore();
const ask = async (q: string) => (await askFlowIqCopilot(q, { store, parse: null })).envelope;
const r = (e: { result: unknown }) => e.result as Record<string, unknown>;
const refused = (e: { result: unknown }) => r(e).unknown === true || r(e).clarification_needed === true;

for (const q of [
  'Best-5 communities on occupancy?', 'Who leads in lead volume for Q2 2026?', 'Order the sites by renewal rate, best first',
  'Occupancy: Marlowe versus Kedzie Works?', 'Is Marlowe lower than Kedzie Works on renewal rate?',
  'Leads ÷ tours at Marlowe in Q2 2026?', 'Marketing spend divided by tours at Marlowe in Q2 2026?',
  'Spend for every signed lease at Marlowe in Q2 2026?', 'Marketing spend Marlowe and Kedzie Works Q2 2026?',
  'Lead count, FY Q2 2026?', 'Tours in the fiscal half ending June 2026?', 'Spend 2026 FY Q2 at Marlowe?',
  'FY occupancy?',
]) {
  test(`not one pooled figure: ${q}`, async () => {
    const e = await ask(q);
    assert.ok(refused(e), `answered: ${e.answer}`);
  });
}
for (const [q, want] of [
  ['Lead count for CY26 Q2?', /2026-04-01 to 2026-06-30/],
  ['Fiscally, lead count in Q2 2026?', /2026-04-01 to 2026-06-30/],
  ['Marketing spend across Marlowe and Kedzie Works combined in Q2 2026?', /\$/],
  ['Lead count at FY in Q2 2026?', /Fulton Yards \(P03\)/],
] as const) {
  test(`fully covered question still answers: ${q}`, async () => {
    const e = await ask(q);
    assert.ok(!refused(e), e.answer);
    assert.match(e.answer, want);
  });
}
