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

test('two measures: any link between two measures asks for two figures (S3 F1)', async () => {
  for (const q of [
    'Renewal rate along with vacancy at Kedzie Works?',
    'Give me vacancy, and also renewal rate, for Kedzie Works',
    'Kedzie Works vacancy rate, renewal rate',
  ]) assert.ok(!answered(await turn(q)), q);
});

test('two measures: one measure phrase with a state or verb is still answered', async () => {
  for (const q of ['How many vacant units at Kedzie Works?', 'How many leases renewed at Kedzie Works?']) assert.ok(answered(await turn(q)), q);
});

test('two measures: a building or prepositional phrase between the measures still needs two figures (S3 39f1288 F1)', async () => {
  for (const q of [
    'vacancy rate at Kedzie Works and renewal rate',
    'renewal rate for Kedzie Works and vacancy rate',
    'Show vacancy at Kedzie Works and, if you can, also the renewal rate',
    'occupancy at Fulton Yards and the vacancy rate',
  ]) assert.ok(!answered(await turn(q)), q);
});

test('two measures: one measure with a building is still answered (S3 39f1288 F1 negatives)', async () => {
  for (const q of ['Vacancy rate at Kedzie Works?', 'Renewal rate at Kedzie Works?', 'Occupancy at Fulton Yards?']) assert.ok(answered(await turn(q)), q);
});

test('status counts: a coordinated "<status> units" is a second count (S3 53ca424 F1)', async () => {
  for (const q of [
    'vacancy rate at Kedzie Works and occupied units',
    'vacancy rate and occupied units at Kedzie Works',
  ]) {
    const e = await turn(q);
    // Either both figures are reported, or the turn does not answer.
    assert.ok(!answered(e) || (/12\.7%/.test(e.answer) && /\b(?:90|96)\b/.test(e.answer)), q);
  }
});

test('status counts: a status word that modifies the measure is still answered', async () => {
  for (const q of ['What is the average rent of vacant units at Kedzie Works?', 'How many occupied units at Kedzie Works?', 'Vacancy rate at Kedzie Works?']) assert.ok(answered(await turn(q)), q);
});

test('count answers name the bedroom filter (S3 53ca424 F5)', async () => {
  for (const [q, bed] of [
    ['How many occupied 2-bed units at Fulton Yards?', /2[- ]?bed/i],
    ['How many 1-bed units at Halsted & Lake are vacant?', /1[- ]?bed/i],
  ] as const) {
    const e = await turn(q);
    assert.ok(answered(e), q);
    assert.match(e.answer, bed, q);
  }
});

test('status counts: a status word outside the measure phrase is a second figure (S3 9474975 F1, F2)', async () => {
  for (const q of [
    'vacancy rate and occupied 2-bed units at Kedzie Works',
    'vacancy rate and units occupied at Kedzie Works',
    'vacancy rate and occupied homes at Kedzie Works',
    // fresh shapes of the same category
    'occupancy rate at Fulton Yards and vacant studio apartments',
    'Kedzie Works vacancy rate plus the residences that are occupied',
    'vacancy rate at Kedzie Works, and empty units',
    'vacancy rate and available units at Kedzie Works',
    'occupancy at Halsted & Lake and also the empty units',
    'vacancy rate and occupied 1-bedroom homes at Halsted & Lake',
  ]) {
    const e = await turn(q);
    // The plan computes one figure, so the fail-safe answer is not to answer.
    assert.ok(!answered(e), q);
  }
});

test('status counts: a status word inside the measure phrase is still answered', async () => {
  for (const q of [
    'How many occupied 2-bed units at Kedzie Works?',
    'How many units are occupied at Kedzie Works?',
    'Count of vacant units at Kedzie Works',
    'What is the average rent of occupied units at Fulton Yards?',
  ]) assert.ok(answered(await turn(q)), q);
});
