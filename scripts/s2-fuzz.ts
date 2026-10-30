/**
 * S2 seeded fuzz (G-S2-10). Seed 7311, fixed before the generator was run;
 * the generator was written from the S2 spec, not from any Eval phrasing,
 * and never used to shape a rule. Truth is computed from data/pms/units.csv
 * here, without FlowIQ code. Metrics (S2.md S2-M):
 *   wrong-of-answered, forgery acceptance per class, false rejection of true
 *   answers, dead-end rate, correct-after-one-clarify (the best single option
 *   is re-asked and compared to the truth of the original question).
 * Exits 1 when any answer is wrong, any forgery is accepted or any true
 * answer is rejected. Usage: node --no-warnings scripts/s2-fuzz.ts [N] [--model URL]
 */
import fs from 'node:fs';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { parseConfigFromEnv } from '../src/agent/model-parse.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';
import type { AnswerEnvelope } from '../src/data/schema.ts';
import { executeCompositionalPlan } from '../src/agent/planner.ts';
import { sealProof } from '../src/agent/envelope.ts';
import { verifyAnswerEnvelope } from '../src/domain/guards.ts';

const SEED = Number(process.env.SEED ?? 7311);
const N = Number(process.argv[2] ?? 1000);
const mi = process.argv.indexOf('--model');
const parse = mi > 0 ? parseConfigFromEnv({ ...process.env, FLOWIQ_PARSE_URL: process.argv[mi + 1], FLOWIQ_PARSE_NO_CACHE: '1' }) : null;
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
type Filter = { text: string; ok: ((u: Row) => boolean) | null; tag: string };

const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
const num = (noun: 'bed' | 'sqft' | 'floor' | 'rent'): Filter => {
  const vals = { bed: [1, 2, 3], sqft: [550, 650, 750, 850, 950], floor: [2, 3, 4, 5, 6], rent: [1600, 1900, 2200, 2500] }[noun];
  const a = pick(vals), b = pick(vals.filter((v) => v > a).concat([a + (noun === 'bed' ? 1 : noun === 'floor' ? 2 : 200)]));
  const unit = { bed: (n: number) => `${n} bedrooms`, sqft: (n: number) => `${n} sq ft`, floor: (n: number) => `floor ${n}`, rent: (n: number) => `$${n} rent` }[noun];
  const key = { bed: 'bed', sqft: 'sqft', floor: 'floor', rent: 'rent' }[noun] as 'bed' | 'sqft' | 'floor' | 'rent';
  // Rent and floor are phrased as people say them ("rent between $1900 and
  // $2500", "on floor 3 or above"), not as "$1900 rent" or "at least floor 3".
  const forms: Array<[string, (v: number) => boolean]> = noun === 'rent' ? [
    [`with rent of at least $${a}`, (v) => v >= a],
    [`with rent of $${a} or more`, (v) => v >= a],
    [`with rent no more than $${a}`, (v) => v <= a],
    [`with rent over $${a}`, (v) => v > a],
    [`with rent under $${a}`, (v) => v < a],
    [`with rent between $${a} and $${b}`, (v) => v >= a && v <= b],
  ] : noun === 'floor' ? [
    [`on floor ${a} or above`, (v) => v >= a],
    [`on floor ${a} or below`, (v) => v <= a],
    [`above floor ${a}`, (v) => v > a],
    [`below floor ${a}`, (v) => v < a],
    [`on floors ${a} to ${b}`, (v) => v >= a && v <= b],
  ] : [
    [`with at least ${unit(a)}`, (v) => v >= a],
    [`with ${unit(a)} or more`, (v) => v >= a],
    [`with no more than ${unit(a)}`, (v) => v <= a],
    [`with more than ${unit(a)}`, (v) => v > a],
    [`with fewer than ${unit(a)}`, (v) => v < a],
    [`with between ${unit(a)} and ${unit(b)}`, (v) => v >= a && v <= b],
  ];
  if (noun === 'floor') forms.push([`on the ${ORD[a]} floor`, (v) => v === a], [`on or above floor ${a}`, (v) => v >= a]);
  if (noun === 'bed') forms.push([`with exactly ${a} bedrooms`, (v) => v === a]);
  const [text, ok] = pick(forms);
  return { text, ok: (u) => ok(u[key]), tag: `num:${noun}` };
};
const filters: Array<() => Filter> = [
  () => num('bed'), () => num('sqft'), () => num('floor'), () => num('rent'),
  () => pick([
    { text: 'that are vacant', ok: (u: Row) => u.status === 'vacant', tag: 'status' },
    { text: 'that are occupied', ok: (u: Row) => u.status === 'occupied', tag: 'status' },
    { text: 'that are on notice', ok: (u: Row) => u.status === 'notice', tag: 'status' },
  ]),
  // Negation and unappliable filters (G-S2-7): truth exists for negation, none for the rest.
  () => pick([
    { text: 'that are not vacant', ok: (u: Row) => u.status !== 'vacant', tag: 'negation' },
    { text: 'excluding vacant ones', ok: (u: Row) => u.status !== 'vacant', tag: 'negation' },
    { text: 'with a balcony', ok: null, tag: 'unappliable' },
    { text: 'that allow cats', ok: null, tag: 'unappliable' },
    { text: 'renovated last year', ok: null, tag: 'unappliable' },
  ]),
];
const measures = [
  { q: (w: string, b: string) => pick([`How many units ${w} are at ${b}?`, `Count the units ${w} at ${b}.`]), v: (x: Row[]) => x.length, key: 'count' },
  { q: (w: string, b: string) => `What is the average market rent of units ${w} at ${b}?`, v: (x: Row[]) => (x.length ? x.reduce((a, u) => a + u.rent, 0) / x.length : null), key: 'usd' },
  { q: (w: string, b: string) => `What is the average sq ft of units ${w} at ${b}?`, v: (x: Row[]) => (x.length ? x.reduce((a, u) => a + u.sqft, 0) / x.length : null), key: 'sqft' },
];
const close = (a: unknown, b: number | null) => typeof a === 'number' && b !== null && Math.abs(a - b) <= 0.06 + Math.abs(b) * 1e-6;

// Forgery classes, each a small edit of a true envelope.
const FORGE: Record<string, (e: AnswerEnvelope) => AnswerEnvelope | null> = {
  digit: (e) => (/\d/.test(e.answer) ? { ...e, answer: e.answer.replace(/\d(?!.*\d)/, (d) => String((+d + 1) % 10)) } : null),
  building: (e) => { const p = props.find((x) => e.answer.includes(x.name)); const o = props.find((x) => x !== p); return p && o ? { ...e, answer: e.answer.replaceAll(p.name, o.name) } : null; },
  alias_case: (e) => { const p = props.find((x) => e.answer.includes(x.name)); return p ? { ...e, answer: e.answer.replace(p.name, p.name.toUpperCase()) } : null; },
  status: (e) => (/vacant/.test(e.answer) ? { ...e, answer: e.answer.replace('vacant', 'occupied') } : /occupied/.test(e.answer) ? { ...e, answer: e.answer.replace('occupied', 'vacant') } : null),
  unit: (e) => (/sq ?ft/.test(e.answer) ? { ...e, answer: e.answer.replace(/sq ?ft/, 'sq m') } : /\$|USD/.test(e.answer) ? { ...e, answer: e.answer.replace(/USD|\$/, '€') } : null),
  appended: (e) => ({ ...e, answer: `${e.answer} This is up 3% from last quarter.` }),
  whitespace: (e) => ({ ...e, answer: `${e.answer} ` }),
  result: (e) => { const k = ['count', 'usd', 'sqft'].find((x) => typeof e.result[x] === 'number'); return k ? { ...e, result: { ...e.result, [k]: (e.result[k] as number) + 1 } } : null; },
  citation: (e) => { const u = store.units.find((x) => !e.citations.includes(x.citationId)); return u ? { ...e, citations: [...e.citations.slice(1), u.citationId] } : null; },
  // A forger who can hash: edit the query and reseal the proof.
  // Counted only when the edited query computes something else; an edit
  // that re-executes to the same answer bytes claims nothing new.
  resealed_query: (e) => {
    const i = e.query?.intent as { floorMin?: number } | undefined;
    if (!i) return null;
    const query = { ...e.query!, intent: { ...i, floorMin: (i.floorMin ?? 0) + 3 } };
    const re = executeCompositionalPlan({ id: e.id, type: 'adhoc', question: query.question }, store, { verify: false, intent: query.intent as never }).envelope;
    return re.answer === e.answer ? null : { ...e, query, proof: sealProof(query, e.result, e.citations) };
  },
  resealed_result: (e) => { const k = ['count', 'usd', 'sqft'].find((x) => typeof e.result[x] === 'number'); if (!k || !e.query) return null; const result = { ...e.result, [k]: (e.result[k] as number) + 1 }; return { ...e, result, answer: e.answer.replace(String(e.result[k]), String(result[k])), proof: sealProof(e.query, result, e.citations) }; },
  intent: (e) => { const i = e.query?.intent as { unitStatus?: string } | undefined; return i ? { ...e, query: { ...e.query!, intent: { ...i, unitStatus: i.unitStatus === 'notice' ? 'vacant' : 'notice' } } } : null; },
};

let deadEndsAnswerable = 0, answerable = 0;
let answered = 0, wrong = 0, clarified = 0, deadEnds = 0, truthClar = 0, rescued = 0, falseReject = 0, restateMissing = 0;
const negUnapp = { asked: 0, wrong: 0 };
const forg: Record<string, { tried: number; accepted: number }> = Object.fromEntries(Object.keys(FORGE).map((k) => [k, { tried: 0, accepted: 0 }]));
const paths: Record<string, number> = {};
const ask = (q: string) => askFlowIqCopilot(q, { store, parse });
for (let i = 0; i < N; i++) {
  const p = pick(props);
  const fsel = [pick(filters)(), ...(rnd() < 0.5 ? [pick(filters)()] : [])].filter((f, k, a) => a.findIndex((g) => g.tag === f.tag) === k);
  const m = pick(measures);
  const q = m.q(fsel.map((f) => f.text).join(' and '), pick([p.name, p.propertyId]));
  const hasTruth = fsel.every((f) => f.ok !== null);
  const sel = hasTruth ? rows.filter((u) => u.p === p.propertyId && fsel.every((f) => f.ok!(u))) : [];
  const tv = hasTruth ? m.v(sel) : null;
  const truth = tv === null ? null : Math.round(tv * 100) / 100;
  if (truth !== null) answerable++;
  const special = fsel.some((f) => f.tag === 'negation' || f.tag === 'unappliable');
  if (special) negUnapp.asked++;
  const t = await ask(q);
  paths[t.parsePath ?? 'deterministic'] = (paths[t.parsePath ?? 'deterministic'] ?? 0) + 1;
  const r = t.envelope.result as Record<string, unknown>;
  if (r.unknown === true || r.refused === true || r.clarification_needed === true) {
    const opts = t.clarifyOptions ?? [];
    if (opts.length === 0) {
      deadEnds++;
      if (truth !== null) deadEndsAnswerable++;
      if (!t.restatement) restateMissing++;
      if (process.env.SHOW_CLARIFY) console.log(`DEADEND ${truth !== null ? 'answerable' : 'no-truth'} ${q}`);
      continue;
    }
    clarified++;
    if (!t.restatement) restateMissing++;
    if (truth === null) continue;
    truthClar++;
    if (process.env.SHOW_CLARIFY) console.log(`CLARIFY ${q} -> ${opts.map((o) => o.question).join(' | ')}`);
    let ok = false;
    for (const o of opts) {
      const r2 = (await ask(o.question)).envelope.result as Record<string, unknown>;
      if (close(r2[m.key], truth)) { ok = true; break; }
    }
    if (ok) rescued++;
    else if (process.env.SHOW_CLARIFY) console.log(`NORESCUE ${q} -> ${opts.map((o) => o.question).join(' | ')}`);
    continue;
  }
  answered++;
  if (!t.restatement) restateMissing++;
  if (!verifyAnswerEnvelope(t.envelope, store).valid) falseReject++;
  if (!close(r[m.key], truth)) {
    wrong++;
    if (special) negUnapp.wrong++;
    if (wrong <= 10) console.log(`WRONG got=${r[m.key]} true=${truth} | ${q}`);
  }
  for (const [k, f] of Object.entries(FORGE)) {
    const e = f(t.envelope);
    if (!e) continue;
    forg[k].tried++;
    if (verifyAnswerEnvelope(e, store).valid) forg[k].accepted++;
  }
}
const pct = (x: number, d: number) => Math.round((x / Math.max(1, d)) * 1000) / 10;
const tried = Object.values(forg).reduce((a, x) => a + x.tried, 0), acc = Object.values(forg).reduce((a, x) => a + x.accepted, 0);
const out = {
  seed: SEED, questions: N, parse: parse ? `model ${parse.baseUrl} (uncached)` : 'deterministic', paths, answered, wrong,
  wrongPctOfAnswered: pct(wrong, answered),
  coveragePct: pct(answered - wrong + rescued, N),
  clarified, deadEndPct: pct(deadEnds, N), deadEnds, answerable, deadEndsAnswerable, deadEndAnswerablePct: pct(deadEndsAnswerable, answerable), correctAfterOneClarifyPct: pct(rescued, truthClar), clarifyWithTruth: truthClar,
  negationUnappliable: negUnapp, restatementMissing: restateMissing,
  forgeryAcceptancePct: pct(acc, tried), forgeriesTried: tried, forgeryByClass: forg, falseRejections: falseReject,
};
console.log(JSON.stringify(out));
if (wrong > 0 || acc > 0 || falseReject > 0) process.exitCode = 1;
