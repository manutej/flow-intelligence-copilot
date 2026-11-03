/**
 * S0b / EVAL-S0 F-048, F-049: the L1 comparator grammar and the closed
 * vocabulary. Truth comes from the units CSV, read here without FlowIQ code.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

const store = loadPortfolioStore();
const rows = fs.readFileSync('data/pms/units.csv', 'utf8').trim().split('\n').slice(1).map((l) => {
  const f = l.split(',').map((x) => x.trim());
  return { p: f[1], bed: +f[3], bath: +f[4], sqft: +f[5], floor: +f[6], rent: +f[8], status: f[9] };
});
type Row = (typeof rows)[number];
const count = (p: string, f: (u: Row) => boolean) => rows.filter((u) => u.p === p && f(u)).length;
const avg = (p: string, f: (u: Row) => boolean, k: 'sqft' | 'rent') => {
  const s = rows.filter((u) => u.p === p && f(u));
  return Math.round((s.reduce((a, u) => a + u[k], 0) / s.length) * 100) / 100;
};
const ask = async (q: string) => (await askFlowIqCopilot(q, { store })).envelope.result as Record<string, unknown>;

describe('L1 comparators are ranges, strict or inclusive as written', () => {
  const cases: Array<[string, () => Record<string, number>]> = [
    ['How many units with at least 2 bedrooms are at Armitage Commons?', () => ({ count: count('P05', (u) => u.bed >= 2) })],
    ['How many units with 2 or more bedrooms are at Armitage Commons?', () => ({ count: count('P05', (u) => u.bed >= 2) })],
    ['How many units with 2+ bedrooms are at Armitage Commons?', () => ({ count: count('P05', (u) => u.bed >= 2) })],
    ['How many units with at most 1 bedroom are at Armitage Commons?', () => ({ count: count('P05', (u) => u.bed <= 1) })],
    ['How many units with 1 or fewer bedrooms are at Armitage Commons?', () => ({ count: count('P05', (u) => u.bed <= 1) })],
    ['How many units under 1000 sq ft are at Armitage Commons?', () => ({ count: count('P05', (u) => u.sqft < 1000) })],
    ['How many units above floor 5 are at Kedzie Works?', () => ({ count: count('P06', (u) => u.floor > 5) })],
    ['How many units with market rent above $2500 are at Kedzie Works?', () => ({ count: count('P06', (u) => u.rent > 2500) })],
    ['How many notice units are at Marlowe Residences?', () => ({ count: count('P02', (u) => u.status === 'notice') })],
  ];
  for (const [q, want] of cases) {
    it(q, async () => {
      const r = await ask(q);
      assert.equal(r.count, want().count, JSON.stringify(r));
    });
  }
  it('average sqft with an at-least bathroom filter', async () => {
    const r = await ask('What is the average square footage of units with at least 1 bathroom at Armitage Commons?');
    assert.ok(Math.abs((r.sqft as number) - avg('P05', (u) => u.bath >= 1, 'sqft')) <= 0.051, JSON.stringify(r));
  });
  it('an average sqft question is answered in sqft even with a rent filter', async () => {
    const r = await ask('What is the average square footage of units with market rent above $3000 at Kedzie Works?');
    assert.ok(Math.abs((r.sqft as number) - avg('P06', (u) => u.rent > 3000, 'sqft')) <= 0.051, JSON.stringify(r));
  });
  it('an average over no units is unknown, not 0', async () => {
    const r = await ask('What is the average market rent of studio units with two bathrooms at Marlowe Residences?');
    assert.equal(r.unknown, true);
  });
  it('plain marketing spend is spend, not cost per lease', async () => {
    const r = await ask('Marketing spend at Armitage Commons');
    assert.equal(r.usd, 12300);
  });
});

describe('L1 closed vocabulary covers every script', () => {
  for (const q of [
    'How many units с балконом are at Halsted & Lake?',
    'How many 🐶 units are at Halsted & Lake?',
    'How many units ٢ غرف نوم are at Halsted & Lake?',
    '只算两居室 How many units are at Halsted & Lake?',
  ]) {
    it(q, async () => {
      const r = await ask(q);
      assert.equal(r.unknown, true, JSON.stringify(r));
    });
  }
});
