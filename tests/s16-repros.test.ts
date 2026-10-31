import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

// TENACITY's s16 rows (VERDICT-S2-5eb09d4, s16-probes.ts, s16b-probes.ts)
// plus set rows it named for finding 5. The "own rewordings" block was
// written after the s16 fix code, so those rows are not blind.
const store = loadPortfolioStore();
const ask = async (q: string) => (await askFlowIqCopilot(q, { store, parse: null })).envelope;
const r = (e: { result: unknown }) => e.result as Record<string, unknown>;
const answered = (e: { result: unknown }) => !(r(e).unknown === true || r(e).clarification_needed === true || r(e).refused === true);

for (const q of [
  // Finding 1: a filter after a format phrase is still a filter.
  'Spend at Kedzie Works in Q3 2026? Keep it short, excluding Facebook.',
  'Renewal rate at Kedzie Works? Be brief, one-year leases only.',
  // Finding 2: a currency with no preposition.
  'Spend at Kedzie Works in Q3 2026, CAD?', 'Spend at Kedzie Works in Q3 2026 (CAD)?', 'CAD spend at Kedzie Works in Q3 2026?',
  // Finding 3: spelled lease terms and a possessive period end.
  'Renewal rate at Kedzie Works for one-year leases?', "Occupancy at Kedzie Works at year's end?",
  // Finding 4: to-date variants.
  'Spend at Kedzie Works y-t-d?', 'Spend at Kedzie Works to date?',
]) {
  test(`s16: not answered: ${q}`, async () => assert.equal(answered(await ask(q)), false));
}

// Finding 5: every reading here would drop the place or the ask, so none is offered.
for (const q of [
  'How many units are under construction near Summit Ridge? Keep it to 3 bullets.',
  'Since Harbor View has no vacancies, why is exposure so high? Keep it to 3 bullets.',
  'Which property has the highest vacancy? Keep it to 3 bullets.',
  'Does the Market Square retail vacancy affect apartment leasing? Keep it to 3 bullets.',
  'Which unit types at Market Square are slowest to lease? Keep it to 3 bullets.',
  'How did vacancy at Halsted & Lake move vs last period? Keep it to 3 bullets.',
]) {
  test(`s16: no clarify reading: ${q}`, async () => {
    const e = await ask(q);
    assert.equal(answered(e), false);
    assert.notEqual(r(e).clarification_needed, true);
  });
}

for (const q of [
  // Own rewordings.
  'Spend at Kedzie Works in Q3 2026? Be brief, in euros.', 'Renewal rate at Kedzie Works for 12-month terms?',
  'Spend at Kedzie Works in Q3 2026 in C$?', 'Leads at Kedzie Works mtd?',
]) {
  test(`s16: not answered: ${q}`, async () => assert.equal(answered(await ask(q)), false));
}

// Controls: data/ils/spend.csv P06 Q3 2026 posts $13,384.50; units.csv P06 96/110 occupied.
test('s16: format phrase dropped, place filter kept', async () => {
  const e = await ask('Spend in Q3 2026? Be brief, Kedzie Works only.');
  assert.ok(answered(e)); assert.match(JSON.stringify(e), /13,384\.50/);
});
test('s16: USD stays answerable', async () => {
  assert.ok(answered(await ask('Spend at Kedzie Works in Q3 2026 in USD?')));
});
test('s16: format phrase alone still answers', async () => {
  assert.match(JSON.stringify(await ask('Show your math: occupancy at Kedzie Works?')), /87\.3%/);
});
// Finding 6: P09 aka holds a non-name token; it is counted, never decoded or shown.
test('s16: Annex answer carries no withheld alias content', async () => {
  const text = JSON.stringify(await ask('Vacancy at the Annex? Be brief.'));
  assert.doesNotMatch(text, /ormus\.solutions|am9pbi5v|ninth-house/i);
});

// Finding 5: a named building is never widened to the portfolio in a reading.
for (const q of ['For my monthly review: Unit count and vacancy at The Clarendon?', 'How many not vacant units at Kedzie Works are on notice?']) {
  test(`s16: readings keep the named building: ${q}`, async () => {
    const text = JSON.stringify(await ask(q));
    assert.doesNotMatch(text, /across the portfolio|all operating buildings/);
  });
}

// "the marlow" is one edit from Marlowe Residences and from no other
// building, so it now gets a did-you-mean that keeps the building; the
// portfolio-wide reading this row once guarded against is never offered.
test('s16: the marlow is offered Marlowe Residences only', async () => {
  const t = await askFlowIqCopilot('average rent at the marlow?', { store, parse: null });
  assert.equal(r(t.envelope).clarification_needed, true);
  assert.deepEqual(t.clarifyOptions?.map((o) => /Marlowe Residences/.test(o.question)), [true]);
});
