import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

// Wrong answers from the v4-answerable dev set, one family per fix, plus a
// rewording of each. Expected figures are recomputed from data/pms/*.csv.
const store = loadPortfolioStore();
const turn = async (q: string) => (await askFlowIqCopilot(q, { store, parse: null })).envelope;
const r = (e: { result: unknown }) => e.result as Record<string, unknown>;
const answered = (e: { result: unknown }) => !(r(e).unknown === true || r(e).clarification_needed === true || r(e).refused === true);

test('concessions: a total is a sum over the matching leases', async () => {
  for (const [q, usd] of [
    ['total concessions Jul-Sep Wabash Point', 3250],
    ['$ concessions for H&L leases Q1 2026', 500],
    ['how much in concessions did we give at Wabash Point on leases starting in Q3 2026?', 3250],
  ] as const) {
    assert.equal(r(await turn(q)).usd, usd, q);
  }
});

test('concessions: a portfolio total is labelled as the portfolio', async () => {
  const e = await turn('how much in concessions did we give at the portfolio on leases starting Q1 2026?');
  assert.equal(r(e).usd, 19500);
  assert.match(e.answer, /operating portfolio/);
  assert.doesNotMatch(e.answer, /Halsted/);
});

test('concessions: an averaging word still asks for the mean', async () => {
  assert.equal(r(await turn('average concession at Wabash Point in Q3 2026')).usd, 406.25);
});

test('lease counts apply the named renewal outcome', async () => {
  for (const [q, n] of [
    ['number of leases marked renewed at H&L', 26],
    ['how many pending renewal leases at Kedzie Works?', 17],
    ['the Commons count of pending renewal leases', 13],
  ] as const) {
    assert.equal(r(await turn(q)).count, n, q);
  }
  // A rewording the lease parser does not reach is IDK, never an unfiltered count.
  const e = await turn('how many renewed leases at Wabash Point?');
  assert.ok(!answered(e) || r(e).count === 38);
});

test('highest or lowest spend is never answered as cost per signed lease', async () => {
  for (const q of ['who had the highest spend 2026-05?', 'who had the lowest spend for July?', 'which property had the largest spend in May 2026?']) {
    const e = await turn(q);
    assert.ok(!answered(e) || !/cost per signed lease/.test(e.answer), q);
  }
});

test('the most vacants ranks vacant units, not all units', async () => {
  const e = await turn('which building has the most vacants (2-bed) currently');
  assert.equal(r(e).property_id, 'P06');
  assert.equal(r(e).count, 5);
});
