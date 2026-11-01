import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

// A breakdown the parse does not carry (group, rank or grain) is never
// answered with one overall figure. Wordings are new, not TENACITY's.
const store = loadPortfolioStore();
const ask = async (q: string) => (await askFlowIqCopilot(q, { store, parse: null })).envelope;
const nonAnswer = (r: Record<string, unknown>) => r.unknown === true || r.clarification_needed === true || r.refused === true;

const dropped: ReadonlyArray<readonly [string, string]> = [
  // Vacancy per building is now a supported breakdown (FLOWIQ-SITE-004).
  ['Show me average market rent for every community.', 'every community'],
  ['Spend at each asset for July 2026', 'each asset'],
  ['Renewal rate - by bldg class?', 'bldg class'],
  ['Lead volume quarter over quarter?', 'quarter over quarter'],
  ['Weekly lead count at Kedzie Works?', 'Weekly'],
  ['What property tops the list on renewal rate?', ''],
  ['Renewals [per building] in 2026?', 'per building'],
  ['Marketing spend: per month, Q2 2026', 'per month'],
];
for (const [q, words] of dropped) {
  test(`a dropped breakdown is not answered: ${q}`, async () => {
    const e = await ask(q);
    assert.ok(nonAnswer(e.result as Record<string, unknown>), `answered: ${e.answer}`);
    if (words) assert.ok(e.answer.includes(words), `message does not name the breakdown: ${e.answer}`);
  });
}

// Scope, filters, rate units and bounds are not breakdowns.
for (const q of [
  'How many vacant units across operating buildings with a gym?',
  'Average market rent across class B buildings?',
  'Monthly rent at risk at Kedzie Works from notice leases?',
  'Rent per month at risk at Logan Lofts from residents on notice?',
  'Apply rate by source in Q3 2026?',
  'Cost per tour by channel in Q2 2026?',
  // VERDICT-S2-d1091cb finding 5: a source breakdown is listed per source.
  'Cost per lead, by channel, at Kedzie Works in Q3?',
]) {
  test(`scope, filters and rate units still answer: ${q}`, async () => {
    const e = await ask(q);
    assert.ok(!nonAnswer(e.result as Record<string, unknown>), `not answered: ${e.answer}`);
  });
}
