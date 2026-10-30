/**
 * S1R regressions (F-060..F-098), written as generated properties rather
 * than example strings. Every case is built from a seeded generator over
 * the comparator, number and status lexicons and the store, and truth is
 * computed from the CSVs here, without FlowIQ code. No string comes from an
 * Eval report.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { parseRange, statedValues, type Field } from '../src/domain/comparators.ts';
import { verifyAnswerEnvelope } from '../src/domain/guards.ts';

const store = loadPortfolioStore();
const rows = fs.readFileSync('data/pms/units.csv', 'utf8').replace(/\r/g, '').trim().split('\n').slice(1).map((l) => {
  const f = l.split(',').map((x) => x.trim());
  return { p: f[1], bed: +f[3], bath: +f[4], sqft: +f[5], floor: +f[6], rent: +f[8], status: f[9] };
});
type Row = (typeof rows)[number];
const PIDS = [...new Set(rows.map((u) => u.p))].sort();
const ask = async (q: string) => askFlowIqCopilot(q, { store });

// ---- seeded generator (seed fixed before the tests were written) ----
let seed = 90210;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

// ---- number surface forms ----
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const ORD1 = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth'];
const ORDT = ['', '', 'twentieth', 'thirtieth', 'fortieth', 'fiftieth', 'sixtieth', 'seventieth', 'eightieth', 'ninetieth'];
const word = (n: number) => (n < 20 ? ONES[n] : n % 10 === 0 ? TENS[n / 10] : `${TENS[Math.floor(n / 10)]}-${ONES[n % 10]}`);
const ordWord = (n: number) => (n < 20 ? ORD1[n] : n % 10 === 0 ? ORDT[n / 10] : `${TENS[Math.floor(n / 10)]}-${ORD1[n % 10]}`);
const suffix = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
const ordDigit = (n: number) => `${n}${suffix(n)}`;
const money = (n: number) => `$${n.toLocaleString('en-US')}`;

// ---- typed value phrases per field ----
const VALUE: Record<Field, (n: number) => string[]> = {
  bedrooms: (n) => [`${n} bedrooms`, `${word(n)} bedrooms`, `${n} BR`],
  bathrooms: (n) => [`${n} baths`, `${word(n)} bathrooms`],
  sqft: (n) => [`${n} sq ft`, `${n} square feet`],
  floor: (n) => [`floor ${n}`, `the ${ordDigit(n)} floor`, `the ${ordWord(n)} floor`],
  rent: (n) => [money(n), `${money(n)} a month`],
};
const RANGE: Record<Field, [number, number]> = { bedrooms: [0, 3], bathrooms: [1, 3], sqft: [450, 1500], floor: [1, 24], rent: [1200, 4800] };
const step = (f: Field) => (f === 'bathrooms' ? 0.5 : 1);
type Op = 'gte' | 'gt' | 'lte' | 'lt';
const OPS: Record<Op, string[]> = {
  gte: ['at least', 'no fewer than', 'a minimum of'],
  gt: ['more than', 'over', 'above'],
  lte: ['at most', 'no more than', 'up to'],
  lt: ['fewer than', 'under', 'below'],
};
const expect = (op: Op, n: number, f: Field) => (op === 'gte' ? { min: n } : op === 'gt' ? { min: n + step(f) } : op === 'lte' ? { max: n } : { max: n - step(f) });
const FIELDS = Object.keys(VALUE) as Field[];
const isContradiction = (r: { min?: number; max?: number } | undefined) => r !== undefined && r.min !== undefined && r.max !== undefined && r.min > r.max;

describe('L1 comparators: every op composes with every field and number form (F-061, F-089)', () => {
  for (let k = 0; k < 120; k++) {
    const f = pick(FIELDS);
    const n = int(...RANGE[f]);
    const op = pick(Object.keys(OPS) as Op[]);
    const q = `units with ${pick(OPS[op])} ${pick(VALUE[f](n))}`;
    it(`${f} ${op} ${n}: ${q}`, () => assert.deepEqual(parseRange(q, f), expect(op, n, f)));
  }
  for (let k = 0; k < 40; k++) {
    const n = int(1, 29);
    const form = pick([`on the ${ordWord(n)} floor`, `on the ${ordDigit(n)} floor`, `on floor ${word(n)}`]);
    it(`F-089 floor = ${n}: ${form}`, () => assert.deepEqual(parseRange(`units ${form}`, 'floor'), { min: n, max: n }));
    it(`F-089 floor >= ${n}: ${form} or higher`, () => assert.deepEqual(parseRange(`units ${form} or higher`, 'floor'), { min: n }));
  }
});

describe('L1 intervals and unions (F-074, F-090)', () => {
  for (let k = 0; k < 60; k++) {
    const f = pick(['bedrooms', 'floor', 'sqft', 'rent'] as Field[]);
    const [lo, hi] = RANGE[f];
    const a = int(lo, hi - 1);
    const b = int(a + 1, hi);
    const [va, vb] = [VALUE[f](a)[0], VALUE[f](b)[0]];
    const bare = f === 'rent' ? money(a) : String(a);
    it(`range ${f} ${a}..${b}`, () => {
      assert.deepEqual(parseRange(`units between ${bare} and ${vb}`, f), { min: a, max: b });
      assert.deepEqual(parseRange(`units from ${va} to ${vb}`, f), { min: a, max: b });
    });
  }
  for (let k = 0; k < 40; k++) {
    const a = int(0, 3);
    const b = int(0, 3);
    if (a === b) continue;
    const forms = [`${word(a)}- or ${word(b)}-bedroom units`, `${a}- or ${b}-bedroom units`, `${a} or ${b} bedroom units`];
    for (const q of forms) it(`union {${a},${b}}: ${q}`, () => {
      const r = parseRange(q, 'bedrooms');
      // Policy (F-074): a union with no gap is its interval; one with a gap
      // is a contradiction the typed-query check refuses. Never one value.
      if (Math.abs(a - b) === 1) assert.deepEqual(r, { min: Math.min(a, b), max: Math.max(a, b) });
      else assert.ok(isContradiction(r), JSON.stringify(r));
    });
  }
});

describe('L1 noun binding: a comparator stays on its own noun (F-075)', () => {
  for (let k = 0; k < 60; k++) {
    const [f, g] = [pick(FIELDS), pick(FIELDS)];
    if (f === g) continue;
    const [n, m] = [int(...RANGE[f]), int(...RANGE[g])];
    const [o1, o2] = [pick(Object.keys(OPS) as Op[]), pick(Object.keys(OPS) as Op[])];
    const q = `units with ${pick(OPS[o1])} ${VALUE[f](n)[0]} and ${pick(OPS[o2])} ${VALUE[g](m)[0]}`;
    it(q, () => {
      assert.deepEqual(parseRange(q, f), expect(o1, n, f));
      assert.deepEqual(parseRange(q, g), expect(o2, m, g));
    });
  }
  for (let k = 0; k < 20; k++) {
    const n = int(2, 20);
    const s = int(500, 1200);
    const q = `${pick([`the ${ordWord(n)} floor`, `floor ${n}`])} units under ${s} sq ft`;
    it(q, () => {
      assert.deepEqual(statedValues(q, 'floor'), [n]);
      assert.deepEqual(parseRange(q, 'sqft'), { max: s - 1 });
    });
  }
});

describe('L1 end to end: an answer, when given, matches the CSV (F-060, F-074..F-076, F-089, F-090)', () => {
  const STATUS: Array<[string, string | undefined]> = [['vacant', 'vacant'], ['occupied', 'occupied'], ['', undefined]];
  const test = (u: Row, f: Field, op: Op, n: number) => {
    const v = { bedrooms: u.bed, bathrooms: u.bath, sqft: u.sqft, floor: u.floor, rent: u.rent }[f];
    return op === 'gte' ? v >= n : op === 'gt' ? v > n : op === 'lte' ? v <= n : v < n;
  };
  for (let k = 0; k < 60; k++) {
    const p = pick(PIDS);
    const f = pick(FIELDS);
    const n = int(...RANGE[f]);
    const op = pick(Object.keys(OPS) as Op[]);
    const [sw, st] = pick(STATUS);
    const kind = pick(['count', 'avgSqft', 'avgRent'] as const);
    const filter = `${pick(OPS[op])} ${pick(VALUE[f](n))}`;
    const q = kind === 'count' ? `How many ${sw ? `${sw} ` : ''}units with ${filter} are at ${p}?`
      : kind === 'avgSqft' ? `What is the average sq ft of ${sw ? `${sw} ` : ''}units with ${filter} at ${p}?`
        : `What is the average rent of ${sw ? `${sw} ` : ''}units with ${filter} at ${p}?`;
    it(q, async () => {
      const r = (await ask(q)).envelope.result as Record<string, unknown>;
      if (r.unknown === true) return;
      const s = rows.filter((u) => u.p === p && (st === undefined || u.status === st) && test(u, f, op, n));
      if (kind === 'count') assert.equal(r.count, s.length, JSON.stringify(r));
      else {
        const key = kind === 'avgSqft' ? 'sqft' : 'usd';
        const want = s.length === 0 ? undefined : Math.round((s.reduce((a, u) => a + (kind === 'avgSqft' ? u.sqft : u.rent), 0) / s.length) * 100) / 100;
        if (want !== undefined) assert.ok(Math.abs(Number(r[key]) - want) < 0.06, `${JSON.stringify(r)} want ${want}`);
      }
    });
  }
  for (let k = 0; k < 20; k++) {
    const p = pick(PIDS);
    const [a, b] = [int(0, 3), int(0, 3)];
    if (a === b) continue;
    const q = `How many ${word(a)}- or ${word(b)}-bedroom units are at ${p}?`;
    it(`F-090 ${q}`, async () => {
      const r = (await ask(q)).envelope.result as Record<string, unknown>;
      if (r.unknown === true) return;
      assert.equal(r.count, rows.filter((u) => u.p === p && (u.bed === a || u.bed === b)).length, JSON.stringify(r));
    });
  }
  it('two exact values on one field are not answered as one of them (F-062)', async () => {
    for (const p of PIDS.slice(0, 3)) {
      const [a, b] = [int(0, 1), int(2, 3)];
      const r = (await ask(`How many units that have ${a} bedrooms and that have ${b} bedrooms are at ${p}?`)).envelope.result as Record<string, unknown>;
      assert.equal(r.unknown, true, JSON.stringify(r));
    }
  });
});

describe('L1 clarify: options offered means clarification_needed, and every option runs (F-062, F-077)', () => {
  const NONSENSE = ['zorbly', 'with a moat', 'near the quasar', 'glimmering'];
  for (let k = 0; k < 16; k++) {
    const p = pick(store.properties);
    const q = pick([`How many units ${pick(NONSENSE)} are at ${p.name}?`, `What is the average rent of ${pick(NONSENSE)} units at ${p.propertyId}?`]);
    it(q, async () => {
      const t = await ask(q);
      const r = t.envelope.result as Record<string, unknown>;
      assert.equal(r.unknown, true, JSON.stringify(r));
      const opts = t.clarifyOptions ?? [];
      assert.equal(r.clarification_needed === true, opts.length > 0, JSON.stringify(r));
      assert.equal(t.clarificationNeeded, opts.length > 0);
      assert.ok(opts.length <= 4);
      assert.equal(new Set(opts.map((o) => o.question)).size, opts.length);
      for (const o of opts) {
        assert.ok(o.label.trim() && o.question.trim().endsWith('?'), JSON.stringify(o));
        const res = (await ask(o.question)).envelope.result as Record<string, unknown>;
        assert.notEqual(res.unknown, true, `${o.question} -> ${JSON.stringify(res)}`);
      }
    });
  }
  it('an answer carries a restatement of the typed query (L1-6)', async () => {
    const t = await ask(`How many vacant units are at ${PIDS[0]}?`);
    assert.match(t.restatement ?? '', /^I computed: .*status = vacant/);
  });
});

describe('L3 binding: aliases, shares and periods (F-066..F-068, F-078, F-080, F-092, F-093, F-096)', async () => {
  const real = await Promise.all(store.properties.map(async (p) => ({ p, t: await ask(`How many vacant units are at ${p.propertyId}?`) })));
  const ok = (env: (typeof real)[number]['t']['envelope'], answer: string) => verifyAnswerEnvelope({ ...env, answer }, store).valid;
  const cases = [(s: string) => s, (s: string) => s.toLowerCase(), (s: string) => s.toUpperCase(), (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())];
  it('every real count answer verifies', () => { for (const { t } of real) assert.ok(verifyAnswerEnvelope(t.envelope, store).valid, t.envelope.answer); });
  it('another building\'s alias, in any case and at any length, is rejected (F-078, F-092)', () => {
    for (const { p, t } of real) for (const o of store.properties) if (o.propertyId !== p.propertyId) for (const a of o.aka) for (const c of cases) {
      if (o.aka.length === 0 || p.name.toLowerCase().includes(a.toLowerCase())) continue;
      const forged = t.envelope.answer.replace(`${p.name} (${p.propertyId})`, `${c(a)} (${p.propertyId})`);
      assert.equal(ok(t.envelope, forged), false, forged);
    }
  });
  it('id forms other than the canonical one are rejected (F-066)', () => {
    for (const { p, t } of real) {
      const d = p.propertyId.slice(1);
      for (const form of [`p${d}`, `P-${d}`, `P ${Number(d)}`, `P0${d}`]) assert.equal(ok(t.envelope, t.envelope.answer.replace(`(${p.propertyId})`, `(${form})`)), false, form);
    }
  });
  it('a negated status is rejected (F-067)', () => {
    for (const { t } of real.filter(({ t }) => /\bvacant units\b/.test(t.envelope.answer))) for (const neg of ['non-', 'not ', 'un']) {
      assert.equal(ok(t.envelope, t.envelope.answer.replace(/\bvacant units\b/, `${neg}vacant units`)), false);
    }
  });
  const shares = await Promise.all(PIDS.map(async (p) => ({ p, t: await ask(`What percent of units are occupied at ${p}?`) })));
  const STATUSES = ['occupied', 'vacant', 'on notice'];
  it('a share binds the status of numerator and denominator (F-096)', () => {
    for (const { t } of shares) {
      const a = t.envelope.answer;
      const m = a.match(/% of units are (occupied|vacant|on notice) \((\d+) of (\d+)/);
      if (!m) continue;
      assert.ok(verifyAnswerEnvelope(t.envelope, store).valid, a);
      for (const s of STATUSES) if (s !== m[1]) assert.equal(ok(t.envelope, a.replace(`% of units are ${m[1]}`, `% of units are ${s}`)), false, s);
      assert.equal(ok(t.envelope, a.replace(`(${m[2]} of`, `(${Number(m[2]) - 1} of`)), false);
      assert.equal(ok(t.envelope, a.replace(`of ${m[3]} units`, `of ${Number(m[3]) + 1} units`)), false);
      const part = a.match(/(\d+) (occupied|vacant|on notice)(?= \+|\)|,)/);
      if (part) assert.equal(ok(t.envelope, a.replace(part[0], `${Number(part[1]) + 1} ${part[2]}`)), false, part[0]);
    }
  });
  const HEADS = ['this', 'last', 'next', 'current', 'prior', 'trailing', 'past', 'rolling', 'previous'];
  const SPANS = () => [`${word(int(2, 24))} months`, `${int(2, 24)} months`, `${word(int(2, 9))} weeks`, `${int(2, 90)} days`];
  it('a period counted from now, or with no year, is rejected (F-068, F-080, F-093)', () => {
    const t = real[0].t;
    for (let k = 0; k < 60; k++) {
      const h = pick(HEADS);
      const period = pick([
        `${h} ${pick(['fiscal', 'calendar', 'financial'])} ${pick(['year', 'quarter'])}`,
        `the ${pick(['trailing', 'past', 'rolling', 'last'])} ${pick(SPANS())}`,
        `${pick(['Q', 'H'])}${int(1, 2)}`,
        `${pick(['year', 'quarter', 'month'])} to date`,
        pick(['YTD', 'QTD', 'MTD', 'TTM', 'LTM']),
        `fiscal year`,
      ]);
      assert.equal(ok(t.envelope, `${t.envelope.answer} (${period})`), false, period);
    }
  });
  it('a dated answer from the planner still verifies', async () => {
    const t = await ask(`What is the cost per signed lease at ${store.properties[0].name} in Q3 2026?`);
    const r = t.envelope.result as Record<string, unknown>;
    if (r.unknown !== true) assert.ok(t.verification.valid, t.envelope.answer);
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
  const first = fs.readFileSync('data/pms/units.csv', 'utf8').split('\n')[1].trim();
  it('an exponent amount is refused', () => assert.match(withRow('ils/spend.csv', `S9997,2026-08,${PIDS[1]},Zillow,${int(2, 9)}e${int(7, 12)},USD,posted`) ?? '', /S9997 has amount/));
  it('an amount over the row ceiling is refused', () => assert.match(withRow('ils/spend.csv', `S9996,2026-08,${PIDS[2]},Zillow,${10 ** int(9, 12)},USD,posted`) ?? '', /S9996 has amount/));
  it('a case-folded duplicate unit id is refused', () => assert.match(withRow('pms/units.csv', first.replace(/^U/, 'u')) ?? '', /repeats unit_id/));
});
