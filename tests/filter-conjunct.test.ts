import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

// A conjunct that restricts the units ("and with rent under $X") is a filter,
// not a second measure; a second measure noun still asks for a second figure.
const store = loadPortfolioStore();
const turn = async (q: string) => (await askFlowIqCopilot(q, { store, parse: null })).envelope;
const r = (e: { result: unknown }) => e.result as Record<string, unknown>;
const answered = (e: { result: unknown }) => !(r(e).unknown === true || r(e).clarification_needed === true || r(e).refused === true);

test('filter conjuncts: a restrictive clause after "and" is answered', async () => {
  for (const q of [
    'Count the units with 850 sq ft or more and with rent under $2200 at P03.',
    'What is the average sq ft of units that are occupied and with rent under $2200 at P03?',
  ]) assert.ok(answered(await turn(q)), q);
});

test('filter conjuncts: a status filter in a clause keeps its reading on offer', async () => {
  for (const [q, status] of [
    ['What is the average market rent of units that are not vacant and that are occupied at P06?', 'occupied'],
    ['What is the average market rent of units that are on notice and excluding vacant ones at P07?', 'notice'],
  ] as const) {
    const e = await turn(q);
    assert.equal(r(e).clarification_needed ?? r(e).unknown, true, q);
    assert.match(e.answer, new RegExp(`Only ${status} \\(already not vacant\\)`), q);
  }
});

test('filter conjuncts: two measure nouns still need two figures', async () => {
  const e = await turn('Unit count and vacancy at Kedzie Works?');
  assert.ok(!answered(e));
});
