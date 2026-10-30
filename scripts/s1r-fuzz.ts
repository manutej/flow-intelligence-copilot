/**
 * S1R seeded fuzz (S1R-G5, U1-U3). Seed chosen once before any run and never
 * used to tune: SEED=7311. Truth is computed from data/pms/units.csv here,
 * without FlowIQ code. Usage: node --no-warnings scripts/s1r-fuzz.ts [N]
 */
import fs from 'node:fs';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

const SEED = 7311;
const N = Number(process.argv[2] ?? 2000);
let s = SEED >>> 0;
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];

const store = loadPortfolioStore();
const rows = fs.readFileSync('data/pms/units.csv', 'utf8').trim().split('\n').slice(1).map((l) => {
  const f = l.split(',').map((x) => x.trim());
  return { p: f[1], bed: +f[3], bath: +f[4], sqft: +f[5], floor: +f[6], rent: +f[8], status: f[9] };
});
type Row = (typeof rows)[number];
const props = store.properties.filter((p) => rows.some((r) => r.p === p.propertyId));

type Filter = { text: string; ok: (u: Row) => boolean };
const filters: Array<() => Filter> = [
  () => { const n = pick([1, 2, 3]); return { text: pick([`with ${n} bedrooms`, `that have ${n} bedrooms`]), ok: (u) => u.bed === n }; },
  () => { const n = pick([600, 700, 800, 900]); return pick([
    { text: `larger than ${n} square feet`, ok: (u: Row) => u.sqft > n },
    { text: `of ${n} sq ft or less`, ok: (u: Row) => u.sqft <= n },
  ]); },
  () => { const n = pick([3, 5, 8]); return pick([
    { text: `on floor ${n} or above`, ok: (u: Row) => u.floor >= n },
    { text: `below floor ${n}`, ok: (u: Row) => u.floor < n },
  ]); },
  () => { const n = pick([1800, 2200, 2600]); return { text: pick([`renting for more than $${n}`, `priced at no more than $${n}`]), ok: (u) => (u.rent > n) === true || false }; },
  () => ({ text: 'that are vacant', ok: (u) => u.status === 'vacant' }),
  () => ({ text: pick(['with a dishwasher', 'facing the courtyard', 'with in-unit laundry']), ok: () => false }), // unbound: must not answer
];
// The price filter's second form is "at most".
const fix = (f: Filter): Filter => f.text.startsWith('priced at no more than') ? { text: f.text, ok: (u) => u.rent <= Number(f.text.replace(/\D/g, '')) } : f;

const measures = [
  { q: (w: string, b: string) => `How many units ${w} are at ${b}?`, v: (s: Row[]) => s.length, key: 'count' },
  { q: (w: string, b: string) => `What is the average market rent of units ${w} at ${b}?`, v: (s: Row[]) => (s.length ? s.reduce((a, u) => a + u.rent, 0) / s.length : null), key: 'usd' },
  { q: (w: string, b: string) => `What is the average size in sq ft of units ${w} at ${b}?`, v: (s: Row[]) => (s.length ? s.reduce((a, u) => a + u.sqft, 0) / s.length : null), key: 'sqft' },
];

const close = (a: unknown, b: number | null) => typeof a === 'number' && b !== null && Math.abs(a - b) <= 0.06 + Math.abs(b) * 1e-6;
let answered = 0, wrong = 0, unknown = 0, unboundAnswered = 0, clarifyRescued = 0, deadEnds = 0;
for (let i = 0; i < N; i++) {
  const p = pick(props);
  const fs1 = [...new Set([fix(pick(filters)()), ...(rnd() < 0.5 ? [fix(pick(filters)())] : [])])];
  const m = pick(measures);
  const q = m.q(fs1.map((f) => f.text).join(' and '), pick([p.name, p.propertyId]));
  const unbound = fs1.some((f) => /dishwasher|courtyard|laundry/.test(f.text));
  const truth = m.v(rows.filter((u) => u.p === p.propertyId && fs1.every((f) => f.ok(u))));
  const t = await askFlowIqCopilot(q, { store });
  const r = t.envelope.result as Record<string, unknown>;
  if (r.unknown === true || r.refused === true || r.clarification_needed === true) {
    unknown++;
    const opts = (t.clarifyOptions ?? []).filter((o) => o.question);
    let rescued = false;
    for (const o of opts.slice(0, 1)) {
      const r2 = (await askFlowIqCopilot(o.question, { store })).envelope.result as Record<string, unknown>;
      if (r2.unknown !== true && r2.refused !== true) rescued = true;
    }
    if (rescued) clarifyRescued++;
    else if (opts.length === 0) deadEnds++;
    continue;
  }
  answered++;
  if (unbound) { unboundAnswered++; wrong++; continue; }
  if (!close(r[m.key], truth === null ? null : Math.round(truth * 100) / 100)) {
    wrong++;
    if (wrong <= 15) console.log(`WRONG got=${r[m.key]} true=${truth} | ${q}`);
  }
}
const pct = (x: number) => Math.round((x / N) * 1000) / 10;
console.log(JSON.stringify({ seed: SEED, questions: N, answered, wrong, wrongPctOfAnswered: Math.round((wrong / Math.max(1, answered)) * 1000) / 10, unknown, unboundAnswered,
  U1_answeredFirstTry: pct(answered - wrong), U2_answeredAfterOneClarify: pct(answered - wrong + clarifyRescued), U3_deadEndRate: pct(deadEnds) }));
