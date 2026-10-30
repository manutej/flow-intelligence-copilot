/**
 * S1R regressions for EVAL-S0b F-060..F-071. Truth comes from the units CSV,
 * read here without FlowIQ code.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { parseRange } from '../src/domain/comparators.ts';

const store = loadPortfolioStore();
const rows = fs.readFileSync('data/pms/units.csv', 'utf8').trim().split('\n').slice(1).map((l) => {
  const f = l.split(',').map((x) => x.trim());
  return { p: f[1], bed: +f[3], bath: +f[4], sqft: +f[5], floor: +f[6], rent: +f[8], status: f[9] };
});
type Row = (typeof rows)[number];
const count = (p: string, f: (u: Row) => boolean) => rows.filter((u) => u.p === p && f(u)).length;
const ask = async (q: string) => (await askFlowIqCopilot(q, { store })).envelope.result as Record<string, unknown>;

describe('F-061: comparators are typed rules that compose', () => {
  const cases: Array<[string, Parameters<typeof parseRange>[1], { min?: number; max?: number }]> = [
    ['on or above floor 5', 'floor', { min: 5 }],
    ['at or above the 5th floor', 'floor', { min: 5 }],
    ['above floor 5', 'floor', { min: 6 }],
    ['on or below floor 3', 'floor', { max: 3 }],
    ['between floors 4 and 7', 'floor', { min: 4, max: 7 }],
    ['between 650 and 950 sq ft', 'sqft', { min: 650, max: 950 }],
    ['sqft between 650 and 950', 'sqft', { min: 650, max: 950 }],
    ['greater than or equal to 800 sq ft', 'sqft', { min: 800 }],
    ['rent of at most $2,000', 'rent', { max: 2000 }],
    ['3 bedrooms or more', 'bedrooms', { min: 3 }],
    ['no more than 2 baths', 'bathrooms', { max: 2 }],
  ];
  for (const [q, field, want] of cases) it(`${q} -> ${JSON.stringify(want)}`, () => assert.deepEqual(parseRange(q, field), want));
  it('"on or above floor N" counts floor N itself', async () => {
    const r = await ask('How many units on or above floor 5 are at Kedzie Works?');
    assert.equal(r.count, count('P06', (u) => u.floor >= 5), JSON.stringify(r));
  });
});

describe('F-060: every unit measure runs the same coverage gate', () => {
  const avgSqft = (p: string, f: (u: Row) => boolean) => {
    const s = rows.filter((u) => u.p === p && f(u));
    return Math.round((s.reduce((a, u) => a + u.sqft, 0) / s.length) * 10) / 10;
  };
  it('a sqft range on an average is applied, not dropped', async () => {
    const r = await ask('What is the average sq ft of units between 650 and 950 sq ft at P05?');
    assert.equal(r.sqft, avgSqft('P05', (u) => u.sqft >= 650 && u.sqft <= 950), JSON.stringify(r));
  });
  for (const q of [
    'Average sq ft of units with a move-out notice at P05?',
    'Average sq ft of units on floors 9 to 12 at P05?',
  ]) {
    it(`never the building-wide average: ${q}`, async () => {
      const r = await ask(q);
      assert.notEqual(r.sqft, avgSqft('P05', () => true), JSON.stringify(r));
    });
  }
});

describe('F-062: unbound words lead to clarify with 2-4 options, answers carry a restatement', () => {
  it('offers typed readings', async () => {
    const t = await askFlowIqCopilot('How many units with a hot tub are at Kedzie Works?', { store });
    assert.equal((t.envelope.result as Record<string, unknown>).unknown, true);
    assert.ok(t.clarifyOptions && t.clarifyOptions.length >= 2 && t.clarifyOptions.length <= 4, JSON.stringify(t.clarifyOptions));
  });
  it('restates what an answer computed', async () => {
    const t = await askFlowIqCopilot('How many vacant units are at Kedzie Works?', { store });
    assert.match(t.restatement ?? '', /^I computed: the number of units, status = vacant, at Kedzie Works \(P06\)\.$/);
  });
});
