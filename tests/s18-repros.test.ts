import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

// Repros from VERDICT-S3-9684691 findings 3-6.
const store = loadPortfolioStore();
const turn = async (q: string) => (await askFlowIqCopilot(q, { store, parse: null })) as unknown as { envelope: { answer: string; result: Record<string, unknown> }; clarifyOptions?: { question: string }[] };

test('s18: a did-you-mean option keeps the asked measure (F3)', async () => {
  for (const [q, fixed] of [
    ['Vacancy rate at Armitage Cmomons?', 'Vacancy rate at Armitage Commons?'],
    ['Vacancy rate at Kedzie Wroks?', 'Vacancy rate at Kedzie Works?'],
    ['Vacancy rate at the Clarendn?', 'Vacancy rate at The Clarendon?'],
  ]) {
    const t = await turn(q);
    assert.equal(t.envelope.result.clarification_needed, true, q);
    assert.deepEqual(t.clarifyOptions?.map((o) => o.question), [fixed], q);
  }
});

test('s18: a phrase mixing two properties clarifies, never resolves (F4)', async () => {
  const t = await turn('Vacancy rate at Kedzie Park?');
  assert.equal(t.envelope.result.clarification_needed, true);
  assert.deepEqual(t.clarifyOptions?.map((o) => o.question), ['Vacancy rate at Kedzie Works?']);
  assert.equal((await turn('Vacancy at South Loop Point?')).envelope.result.unknown, undefined);
});

test('s18: all of a partly covered year says so (F5)', async () => {
  const t = await turn('Spend at Kedzie Works in all of 2026?');
  assert.match(t.envelope.answer, /2026-01-01 to 2026-12-31 \(months outside the data have no rows\)/);
});

test('s18: a filtered ranking names its filter and a runner-up tie (F6)', async () => {
  const t = await turn('which building has the most vacants (2-bed) currently');
  assert.match(t.envelope.answer, /most vacant 2-bedroom units at 5/);
  assert.match(t.envelope.answer, /next: Fulton Yards, The Clarendon and Printers Row Tower tie with 3 each/);
});
