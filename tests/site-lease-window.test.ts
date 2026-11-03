// FLOWIQ-SITE-003: relative lease windows resolve against the data's as_of date,
// never against the wall clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

const ask = async (q: string, asOfDate?: string) => {
  const store = asOfDate ? loadPortfolioStore(undefined, { asOfDate }) : loadPortfolioStore();
  return askFlowIqCopilot(q, { store, parse: null });
};
const count = (r: { envelope: { result: unknown } }) => (r.envelope.result as { count?: number }).count;

test('next month resolves against as_of and names the window', async () => {
  const r = await ask('How many leases renew next month?');
  assert.match(r.envelope.answer, /November 2026/);
  assert.equal(count(r), 149);
  assert.notEqual(count(r), 1033);
});

test('as_of differing from today shifts the window', async () => {
  const r = await ask('How many leases renew next month?', '2026-11-15');
  assert.match(r.envelope.answer, /December 2026/);
  const dec = await ask('how many leases expire in December?');
  assert.equal(count(r), count(dec));
});

test('renewal status filter and breakdown', async () => {
  const pending = await ask('of the leases ending next month, how many are pending renewal?');
  assert.equal(count(pending), 59);
  const renewed = await ask('of the leases ending next month, how many already renewed?');
  assert.equal(count(renewed), 75);
  const byStatus = await ask('lease expirations next month by renewal status');
  assert.match(byStatus.envelope.answer, /renewed 75, pending 59/);
});

test('by building lists each building', async () => {
  const r = await ask('lease expirations next month by building');
  assert.match(r.envelope.answer, /Wabash Point \[P08\]: 24/);
});

test('no window asks for one', async () => {
  const r = await ask('how many renewals are coming up?');
  assert.equal(r.clarificationNeeded ?? (r.envelope.result as { clarification_needed?: boolean }).clarification_needed, true);
  assert.match(r.envelope.answer, /window/);
});
