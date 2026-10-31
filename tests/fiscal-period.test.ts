import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

const store = loadPortfolioStore();
const ask = async (q: string) => (await askFlowIqCopilot(q, { store, parse: null })).envelope;

for (const q of ['What was marketing spend in FY2025?', 'Marketing spend FY26', "spend for FY '25", 'Leads by source this fiscal year', 'What was spend in fiscal Q2?', 'FYTD spend at Kedzie Works']) {
  test(`a fiscal period is never answered on a default window: ${q}`, async () => {
    const e = await ask(q);
    const r = e.result as Record<string, unknown>;
    assert.ok(r.unknown === true || r.clarification_needed === true, `answered: ${e.answer}`);
  });
}
test('calendar years and FY-free questions still answer', async () => {
  const r = (await ask('What was total marketing spend in Q2 2026?')).result as Record<string, unknown>;
  assert.notEqual(r.unknown, true);
});
