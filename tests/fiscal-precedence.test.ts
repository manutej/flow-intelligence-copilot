import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

// A fiscal token outranks the "FY" alias: never Fulton Yards, never a default
// window, and the non-answer names no property. Wordings are new.
const store = loadPortfolioStore();
const ask = async (q: string) => (await askFlowIqCopilot(q, { store, parse: null })).envelope;

for (const q of ['What did we spend in FY.2026?', 'Spend fy 26 at Kedzie Works', 'Leads in F.Y.26?', 'Tours FY/2026?', 'Fiscal Q3 lead count for Fulton Yards?', 'FY-25 marketing spend']) {
  test(`a fiscal token is a period, not a property: ${q}`, async () => {
    const e = await ask(q);
    const r = e.result as Record<string, unknown>;
    assert.ok(r.unknown === true || r.clarification_needed === true, `answered: ${e.answer}`);
    assert.doesNotMatch(e.answer, /Fulton Yards|\(P\d\d\)|Kedzie Works/);
  });
}
test('Fulton Yards by name still resolves', async () => {
  const e = await ask('Marketing spend at Fulton Yards in Q2 2026?');
  assert.notEqual((e.result as Record<string, unknown>).unknown, true, e.answer);
});
