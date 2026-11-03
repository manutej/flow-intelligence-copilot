import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

const store = loadPortfolioStore();
const ask = async (q: string) => (await askFlowIqCopilot(q, { store, parse: null })).envelope.result as Record<string, unknown>;
const nonAnswer = (r: Record<string, unknown>) => r.unknown === true || r.clarification_needed === true || r.refused === true;

// A stated grouping a scalar template cannot honor never yields the total.
for (const q of ['What is the renewal rate by property class?', 'Renewal rate by building?', 'Total spend by source in Q3?', 'Total marketing spend for each building in Q2 2026', 'Renewal rate per property']) {
  test(`a dropped grouping is not answered: ${q}`, async () => assert.ok(nonAnswer(await ask(q))));
}
// Rates and per-source templates still answer.
for (const q of ['Cost per tour by source in Q3?', 'How much rent per month is at risk at Logan Lofts from residents who have given notice?', 'What was total marketing spend in Q2 2026?']) {
  test(`a rate or per-source breakdown still answers: ${q}`, async () => assert.ok(!nonAnswer(await ask(q))));
}
