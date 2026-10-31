import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

// Fiscal reads need a period token; a stated calendar period is answered;
// bare FY as a place is Fulton Yards. Wordings are new.
const store = loadPortfolioStore();
const ask = async (q: string) => (await askFlowIqCopilot(q, { store, parse: null })).envelope;
const r = (e: { result: unknown }) => e.result as Record<string, unknown>;

for (const q of ['Lead count for f/y 2027?', 'Tours in fiscal year 2026 Q2?', 'Leads FY2026 H1 at Marlowe?']) {
  test(`a fiscal period token is not answered: ${q}`, async () => {
    const e = await ask(q);
    assert.ok(r(e).unknown === true || r(e).clarification_needed === true, `answered: ${e.answer}`);
    assert.match(e.answer, /fiscal/i);
  });
}
test('a fiscal word beside a calendar quarter answers that quarter', async () => {
  const e = await ask('Fiscal lead count in Q2 2026?');
  assert.notEqual(r(e).unknown, true, e.answer);
  assert.match(e.answer, /2026-04-01/);
});
test('FY used as a place resolves to Fulton Yards', async () => {
  const e = await ask('Total marketing spend at FY in Q2 2026?');
  assert.notEqual(r(e).unknown, true, e.answer);
  const byName = await ask('Total marketing spend at Fulton Yards in Q2 2026?');
  assert.equal(e.answer, byName.answer);
});
