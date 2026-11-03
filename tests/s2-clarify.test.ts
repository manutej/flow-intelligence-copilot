import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { parseQueryIntent } from '../src/agent/intent.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

const store = loadPortfolioStore();
const ask = (question: string) => askFlowIqCopilot({ id: 't', type: 'adhoc', question }, { store, mode: 'deterministic', parse: null });
const truth = (pid: string, ok: (s: string) => boolean) => store.units.filter((u) => u.propertyId === pid && ok(u.status)).length;

test('S2 clarify: a lone negated status is answered as its complement set, never the inverted status (F6)', async () => {
  const t = await ask('How many units that are not vacant are at P02?');
  assert.equal(t.verification.valid, true);
  assert.deepEqual((t.envelope.query?.intent as { unitStatusIn?: string[] }).unitStatusIn, ['notice', 'occupied']);
  assert.equal((t.envelope.result as { count: number }).count, truth('P02', (s) => s !== 'vacant'));
  assert.match(t.restatement ?? '', /status in \{notice, occupied\}/);
  assert.doesNotMatch(t.restatement ?? '', /status = vacant/);
});

test('S2 clarify: a status already inside the complement is offered alone; a contradiction has no reading', async () => {
  const t = await ask('Count the units that are occupied and that are not vacant at P04.');
  assert.equal(t.clarifyOptions?.[0]?.query?.unitStatus, 'occupied');
  const c = await ask('How many units that are vacant and not vacant are at P04?');
  assert.equal((c.clarifyOptions ?? []).length, 0);
  assert.ok(c.restatement);
});

test('S2 clarify: an unknown building gets no guessed building by a shared word', async () => {
  const t = await ask('How many vacant units does Lakeview Tower have?');
  assert.equal(t.envelope.result.unknown, true);
  assert.equal((t.clarifyOptions ?? []).length, 0);
  assert.doesNotMatch(t.restatement ?? '', /Printers Row/);
});

test('S2 parse: rent stated as a filter is not the measure, and "rent of $X or more" is a bound', () => {
  const a = parseQueryIntent('What is the average sq ft of units with rent between $1900 and $2500 at Wabash Point?', store);
  assert.equal(a.measure, 'avg_sqft');
  assert.deepEqual([a.rentMin, a.rentMax], [1900, 2500]);
  const b = parseQueryIntent('How many units with rent of $2500 or more are at P05?', store);
  assert.deepEqual([b.measure, b.rentMin, b.rentMax], ['unit_count', 2500, undefined]);
  assert.equal(parseQueryIntent('What is the average rent of units with rent over $2000?', store).measure, 'avg_market_rent');
});
