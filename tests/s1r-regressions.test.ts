/**
 * S1R regressions for EVAL-S0b F-060..F-071. Truth comes from the units CSV,
 * read here without FlowIQ code.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { parseRange, statedValues } from '../src/domain/comparators.ts';

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
    ['larger than 700 sq ft and 900 sq ft or less', 'sqft', { min: 701, max: 900 }],
    ['on floor 3 or above and below floor 8', 'floor', { min: 3, max: 7 }],
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

describe('F-066..F-068: claims are bound to the result, not trusted as prose', async () => {
  const { verifyAnswerEnvelope } = await import('../src/domain/guards.ts');
  const t = await askFlowIqCopilot('How many vacant units are at Kedzie Works?', { store });
  const base = t.envelope;
  const forged = (answer: string) => verifyAnswerEnvelope({ ...base, answer }, store).valid;
  const otherAlias = store.properties.find((p) => p.propertyId !== 'P06' && p.aka.some((a) => a.length >= 3))!;
  it('the real answer verifies', () => assert.ok(verifyAnswerEnvelope(base, store).valid, base.answer));
  it('F-066 another building\'s alias, or an id in another form, is rejected', () => {
    assert.equal(forged(base.answer.replace('Kedzie Works (P06)', `${otherAlias.aka.find((a) => a.length >= 3)} (P06)`)), false);
    assert.equal(forged(base.answer.replace('(P06)', '(p06)')), false);
    assert.equal(forged(base.answer.replace('(P06)', '(P-06)')), false);
  });
  it('F-067 a negated status or a count/total swap is rejected', () => {
    assert.equal(forged(base.answer.replace(/\bvacant units\b/, 'non-vacant units')), false);
    const m = base.answer.match(/out of (\d+) total units/);
    if (m) assert.equal(forged(base.answer.replace(m[0], `out of ${Number(base.result.count) - 1} total units`)), false);
  });
  it('F-068 relative dates and garbled numbers are rejected', () => {
    assert.equal(forged(`${base.answer} (as of last Tuesday)`), false);
    assert.equal(forged(`${base.answer} since March.`), false);
    assert.equal(forged(base.answer.replace('P06', 'Psix')), false);
    assert.equal(forged(base.answer.replace('P06', 'P0six')), false);
  });
});

describe('F-069: the loader refuses unbounded spend and case-folded duplicate ids', async () => {
  const os = await import('node:os');
  const path = await import('node:path');
  const withRow = (rel: string, row: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's1r-'));
    fs.cpSync('data', path.join(dir, 'data'), { recursive: true });
    fs.appendFileSync(path.join(dir, 'data', rel), row + '\n');
    try { loadPortfolioStore(dir); return null; } catch (e) { return String(e); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };
  it('1e9 spend is refused', () => assert.match(withRow('ils/spend.csv', 'S9997,2026-08,P01,Zillow,1e9,USD,posted') ?? '', /S9997 has amount 1e9/));
  it('spend over the row ceiling is refused', () => assert.match(withRow('ils/spend.csv', 'S9996,2026-08,P01,Zillow,1000000000,USD,posted') ?? '', /S9996 has amount/));
  it('a lowercase duplicate unit id is refused', () => assert.match(withRow('pms/units.csv', 'u0001,P01,826,1,1,600,8,none,2315,occupied') ?? '', /repeats unit_id u0001/));
});

describe('F-062: two exact values on one field are not answered as one of them', () => {
  it('2 bedrooms and 3 bedrooms', async () => {
    const r = await ask('How many units that have 2 bedrooms and that have 3 bedrooms are at P02?');
    assert.equal(r.unknown, true, JSON.stringify(r));
  });
});

describe('S1R round 2: intervals, noun binding, rent on averages, short aliases, open periods', async () => {
  const { verifyAnswerEnvelope } = await import('../src/domain/guards.ts');
  const ranges: Array<[string, Parameters<typeof parseRange>[1], { min?: number; max?: number } | 'contradiction']> = [
    ['units with 1 to 2 baths', 'bathrooms', { min: 1, max: 2 }],
    ['2 or 3 bedroom units', 'bedrooms', { min: 2, max: 3 }],
    ['floors 3-5', 'floor', { min: 3, max: 5 }],
    ['from the 3rd to the 5th floor', 'floor', { min: 3, max: 5 }],
    ['$2,200 or more', 'rent', { min: 2200 }],
    ['4th floor under 700 sq ft', 'sqft', { max: 699 }],
    ['2 bedrooms and below floor 6', 'floor', { max: 5 }],
    ['floor 2 or 4', 'floor', 'contradiction'],
  ];
  for (const [q, field, want] of ranges) it(`F-074/F-075 ${field}: ${q}`, () => {
    const r = parseRange(q, field);
    if (want === 'contradiction') assert.ok(r && r.min !== undefined && r.max !== undefined && r.min > r.max, JSON.stringify(r));
    else assert.deepEqual(r, want);
  });
  for (const [q, field, v] of [['level 4', 'floor', 4], ['4th floor under 700 sq ft', 'floor', 4], ['2 bedrooms and below floor 6', 'bedrooms', 2]] as const)
    it(`F-075 exact ${field} stays on its noun: ${q}`, () => assert.deepEqual(statedValues(q, field), [v]));
  it('F-074 a count over a range matches the CSV', async () => {
    assert.equal((await ask('How many units have 1 to 2 bedrooms at P03?')).count, count('P03', (u) => u.bed >= 1 && u.bed <= 2));
  });
  it('F-075 a comparator binds to its own noun', async () => {
    assert.equal((await ask('How many 3 bedroom units are below floor 4 at P02?')).count, count('P02', (u) => u.bed === 3 && u.floor < 4));
  });
  it('F-076 a rent filter on an average is applied', async () => {
    const s = rows.filter((u) => u.p === 'P04' && u.rent < 2500);
    const want = Math.round((s.reduce((a, u) => a + u.sqft, 0) / s.length) * 10) / 10;
    assert.equal((await ask('Average sq ft of units with rent under $2,500 at P04?')).sqft, want);
  });
});
