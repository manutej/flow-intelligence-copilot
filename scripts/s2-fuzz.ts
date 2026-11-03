/**
 * S2 seeded fuzz (G-S2-10). Seed 7311, fixed before the generator was run;
 * the generator was written from the S2 spec, not from any Eval phrasing,
 * and never used to shape a rule. Truth is computed from data/pms/units.csv
 * here, without FlowIQ code. Metrics (S2.md S2-M):
 *   wrong-of-answered, forgery acceptance per class, false rejection of true
 *   answers, dead-end rate, correct-after-one-clarify (the best single option
 *   is re-asked and compared to the truth of the original question).
 * Exits 1 when any answer is wrong, any forgery is accepted or any true
 * answer is rejected.
 *
 * Model path (TENACITY F1): --model URL runs a live endpoint; --adversarial
 * runs a replay model that returns the lexicon reading on ~30% of turns and
 * a wrong intent otherwise (period, scope, measure, status, bound, dropped
 * or added filter), so the model path is gated without a live model.
 * A rescue (F5) counts only when the option the asker intended, the one
 * whose typed query selects the same rows with the same measure, answers
 * the truth. Usage: node --no-warnings scripts/s2-fuzz.ts [N] [--model URL | --adversarial]
 */
import fs from 'node:fs';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { parseConfigFromEnv } from '../src/agent/model-parse.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';
import type { AnswerEnvelope } from '../src/data/schema.ts';
import { executeCompositionalPlan } from '../src/agent/planner.ts';
import { parseQueryIntent } from '../src/agent/intent.ts';
import { nonAnswerKind, sealNonAnswer, sealProof } from '../src/agent/envelope.ts';
import { verifyAnswerEnvelope } from '../src/domain/guards.ts';

// Seals the exact forged envelope (id and all), as an insider holding the
// process key would, so a rejection comes from the re-render, not the seal.
const sealAs = (input: Parameters<typeof sealNonAnswer>[0], env: AnswerEnvelope): AnswerEnvelope => {
  const { query: _q, proof: _p, ...bare } = env;
  return { ...bare, ...sealNonAnswer(input, bare) } as AnswerEnvelope;
};

const SEED = Number(process.env.SEED ?? 7311);
const N = Number(process.argv[2] ?? 1000);
const mi = process.argv.indexOf('--model');
const adversarial = process.argv.includes('--adversarial');
const parse = mi > 0 ? parseConfigFromEnv({ ...process.env, FLOWIQ_PARSE_URL: process.argv[mi + 1], FLOWIQ_PARSE_NO_CACHE: '1' })
  : adversarial ? parseConfigFromEnv({ FLOWIQ_PARSE_URL: 'http://adversarial.invalid/v1', FLOWIQ_PARSE_NO_CACHE: '1' }) : null;
// The replay model's own stream, so the question stream is the same with and without it.
let s2 = (SEED ^ 0x5bd1e995) >>> 0;
const rnd2 = () => ((s2 = (s2 * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const MUTATIONS: Array<(i: Record<string, any>) => Record<string, unknown>> = [
  (i) => ({ dateWindow: i.dateWindow?.key === 'Q3_2026' ? 'Q2_2026' : 'Q3_2026', dateExplicit: true }),
  (i) => ({ isWholePortfolioExplicit: !i.isWholePortfolioExplicit }),
  (i) => ({ measure: i.measure === 'unit_count' ? 'avg_market_rent' : 'unit_count' }),
  (i) => ({ unitStatus: i.unitStatus === 'vacant' ? 'occupied' : 'vacant', unitStatusIn: undefined }),
  (i) => (i.bedroomsMin !== undefined ? { bedroomsMin: i.bedroomsMin + 1 } : { floorMin: (i.floorMin ?? 1) + 1 }),
  (i) => { const k = ['bedrooms', 'bedroomsMin', 'bedroomsMax', 'sqftMin', 'sqftMax', 'floorMin', 'floorMax', 'rentMin', 'rentMax', 'unitStatus', 'unitStatusIn'].find((x) => i[x] !== undefined); return k ? { [k]: undefined } : { bedrooms: 2 }; },
  () => ({ paidOnly: true }),
];
const replay = (question: string) => {
  const det = parseQueryIntent(question, store) as unknown as Record<string, any>;
  const exact = rnd2() < 0.3;
  const m = exact ? {} : MUTATIONS[Math.floor(rnd2() * MUTATIONS.length)](det);
  const intent = { ...det, dateWindow: det.dateWindow?.key, ...(det.leaseStartWindow ? { leaseStartWindow: det.leaseStartWindow.key } : {}), ...(det.leaseEndWindow ? { leaseEndWindow: det.leaseEndWindow.key } : {}), ...m };
  const content = JSON.stringify({ kind: 'query', question, intent });
  return { runStore: null, fetch: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) }) };
};
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
const MEASURE_ID: Record<string, string> = { count: 'unit_count', usd: 'avg_market_rent', sqft: 'avg_sqft' };
const inR = (v: number, eq?: number, lo?: number, hi?: number) => (eq === undefined || v === eq) && (lo === undefined || v >= lo) && (hi === undefined || v <= hi);
const rowMatches = (i: Record<string, any>, u: Row) => inR(u.bed, i.bedrooms, i.bedroomsMin, i.bedroomsMax) && inR(u.bath, i.bathrooms, i.bathroomsMin, i.bathroomsMax)
  && inR(u.sqft, undefined, i.sqftMin, i.sqftMax) && inR(u.floor, undefined, i.floorMin, i.floorMax) && inR(u.rent, undefined, i.rentMin, i.rentMax)
  && (i.unitStatus === undefined || u.status === i.unitStatus) && (i.unitStatusIn === undefined || i.unitStatusIn.includes(u.status));
const close = (a: unknown, b: number | null) => typeof a === 'number' && b !== null && Math.abs(a - b) <= 0.06 + Math.abs(b) * 1e-6;

// Forgery classes, each a small edit of a true envelope.
const lastTrue: AnswerEnvelope[] = [];
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
  // F3: a coherent forgery: another question's true render, relabelled
  // with this question and resealed, so answer, result and proof agree.
  coherent_resealed: (e) => {
    const o = lastTrue.find((x) => x.query?.question !== e.query?.question && x.answer !== e.answer);
    if (!o || !o.query || !e.query) return null;
    const query = { ...o.query, question: e.query.question };
    return { ...o, id: e.id, query, proof: sealProof(query, o.result, o.proof?.row_ids ?? o.citations) };
  },
  // TENACITY c082279 findings 1-3: citations of the wrong shape on a zeroed
  // answer, and the answer turned into a sealed or unsealed non-answer.
  ...Object.fromEntries(([['undefined', undefined], ['null', null], ['string', 'units:U0001'], ['object', {}]] as const).map(([name, citations]) => [`citations_${name}_zero`, (e: AnswerEnvelope) => {
    const result = Object.fromEntries(Object.entries(e.result).map(([k, v]) => [k, typeof v === 'number' ? 0 : v]));
    return { ...e, citations, result, answer: e.answer.replace(/\$?\d[\d,.]*/g, '0'), proof: e.query ? { ...sealProof(e.query, result, []) } : e.proof } as unknown as AnswerEnvelope;
  }])),
  // Non-answers sealed with this process's key: only re-rendering can reject them.
  ...Object.fromEntries(([
    ['to_unknown_sealed', { unknown: true }, "I don't know."],
    ['to_refused_sealed', { refused: true }, 'Refused.'],
    ['unknown_small_figure', { unknown: true }, "I don't know. Fulton Yards has 7 vacant units."],
    ['unknown_spelled_figure', { unknown: true }, "I don't know. Spend was forty thousand dollars."],
    ['unknown_sci_figure', { unknown: true }, "I don't know. It was 1.1e5 USD."],
    ['clarify_with_figure', { unknown: true, clarification_needed: true }, 'Spend was $40,000 — did you mean Q2 or Q3?'],
    ['clarify_candidates', { unknown: true, clarification_needed: true, candidates: ['$40,000'] }, 'Did you mean Q2 or Q3?'],
  ] as const).map(([name, result, answer]) => [name, (e: AnswerEnvelope) => (e.query ? sealAs({ question: e.query.question, origin: 'deterministic' }, { ...e, result, answer, citations: [] }) as AnswerEnvelope : null)])),
  to_unknown_bare: (e) => ({ id: e.id, result: { unknown: true }, answer: "I don't know.", citations: [] }) as AnswerEnvelope,
  unknown_with_figure: (e) => (e.query ? (() => { const answer = `I don't know. ${e.answer}`; const result = { unknown: true }; return sealAs({ question: e.query.question, origin: 'deterministic' }, { ...e, result, answer, citations: [] }); })() : null),
  // A genuine non-answer from another question, resealed onto this one.
  moved_idk: (e) => (e.query ? (() => { const answer = "I don't know — the requested valuation, noi, debt service & unmodeled fields are not in the exports."; const result = { unknown: true }; return sealAs({ question: e.query.question, origin: 'deterministic' }, { ...e, result, answer, citations: [] }); })() : null),
  // Every sealable origin forged onto this answerable question (343668c finding 2).
  session_refusal_moved: (e) => (e.query ? sealAs({ question: e.query.question, origin: 'session', refused_question: 'Which tenants with kids should we avoid renting to at Kedzie Works?' }, { ...e, result: { refused: true }, answer: 'Refused: earlier in this conversation I refused a request to treat a group of people differently, and this refers back to those people. I can answer the same question without them, for example "How many studios are vacant at Kedzie Works?".', citations: [] }) : null),
  frame_refusal_moved: (e) => (e.query ? sealAs({ question: e.query.question, origin: 'frame', frame: { group: 'none', treatment: true } }, { ...e, result: { refused: true }, answer: 'Refused: this asks to treat people differently based on none, which the Fair Housing Act and the Illinois Human Rights Act prohibit. I can help with the same task without that criterion.', citations: [] }) : null),
  frame_idk_with_figure: (e) => (e.query ? sealAs({ question: e.query.question, origin: 'frame', frame: { group: 'age', treatment: true } }, { ...e, result: { unknown: true }, answer: `I don't know. ${e.answer}`, citations: [] }) : null),
  unknown_origin: (e) => (e.query ? sealAs({ question: e.query.question, origin: 'harness' as never }, { ...e, result: { unknown: true }, answer: "I don't know.", citations: [] }) : null),
  model_origin_clarify: (e) => (e.query ? (() => { const answer = 'I am not sure which question you mean. Did you mean: (1) $40,000; (2) nothing?'; const result = { unknown: true, clarification_needed: true }; return sealAs({ question: e.query.question, origin: 'model', model_intent: e.query.intent }, { ...e, result, answer, citations: [] }); })() : null),
  intent: (e) => { const i = e.query?.intent as { unitStatus?: string } | undefined; return i ? { ...e, query: { ...e.query!, intent: { ...i, unitStatus: i.unitStatus === 'notice' ? 'vacant' : 'notice' } } } : null; },
};

// F7: a restatement names the building and the measure, not just exists.
const restatesQuery = (r: string, p: { name: string; propertyId: string }, key: string) =>
  (r.includes(p.name) || r.includes(p.propertyId)) && ({ count: /\bunits?\b|count/i, usd: /rent/i, sqft: /sq|square/i } as Record<string, RegExp>)[key].test(r);
let restateWeak = 0;
let deadEndsAnswerable = 0, answerable = 0;
let nonAnswers = 0, nonAnswerFalseReject = 0;
let answered = 0, wrong = 0, clarified = 0, deadEnds = 0, truthClar = 0, rescued = 0, falseReject = 0, restateMissing = 0;
const negUnapp = { asked: 0, wrong: 0 };
const forg: Record<string, { tried: number; accepted: number }> = Object.fromEntries(Object.keys(FORGE).map((k) => [k, { tried: 0, accepted: 0 }]));
const paths: Record<string, number> = {};
const ask = (q: string) => askFlowIqCopilot(q, { store, parse, ...(adversarial ? { parseDeps: replay(q) } : {}) } as never);
let modelDiverged = 0;
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
  // TENACITY f2424a7 finding 1: a non-answer turn must verify too.
  if (nonAnswerKind(t.envelope.result as Record<string, unknown>)) {
    nonAnswers++;
    if (!t.verification.valid || !verifyAnswerEnvelope(t.envelope, store).valid) { nonAnswerFalseReject++; if (nonAnswerFalseReject <= 3) console.log(`NONANSWER-REJECT ${q} :: ${t.verification.errors.join('; ')}`); }
  }
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
    // F5: the asker picks the option whose typed query means what they asked:
    // same measure, same building, and the same selected rows across the portfolio.
    const want = rows.filter((u) => fsel.every((f) => f.ok!(u))).map((u) => rows.indexOf(u)).join(',');
    const intended = opts.find((o) => {
      const iq = o.query as unknown as Record<string, any> | undefined;
      if (!iq || iq.measure !== MEASURE_ID[m.key]) return false;
      return rows.filter((u) => rowMatches(iq, u)).map((u) => rows.indexOf(u)).join(',') === want;
    });
    let ok = false;
    if (intended) {
      // A pick runs the option's typed query (as the UI does) and must verify.
      const pe = executeCompositionalPlan({ id: 'PICK', type: 'adhoc', question: intended.question }, store, { intent: intended.query as never });
      const r2 = pe.envelope.result as Record<string, unknown>;
      ok = pe.verification.valid && close(r2[m.key], truth);
    }
    if (ok) rescued++;
    else if (process.env.SHOW_CLARIFY) console.log(`NORESCUE ${q} -> ${opts.map((o) => o.question).join(' | ')}`);
    continue;
  }
  answered++;
  if (!t.restatement) restateMissing++;
  else if (!restatesQuery(t.restatement, p, m.key)) restateWeak++;
  if (t.parsePath === 'model' && JSON.stringify(t.parse?.intent) !== JSON.stringify(t.parse?.deterministic)) modelDiverged++;
  if (!verifyAnswerEnvelope(t.envelope, store).valid) falseReject++;
  if (!close(r[m.key], truth)) {
    wrong++;
    if (special) negUnapp.wrong++;
    if (wrong <= 10) console.log(`WRONG got=${r[m.key]} true=${truth} | ${q}`);
  }
  if (verifyAnswerEnvelope(t.envelope, store).valid) { lastTrue.unshift(t.envelope); lastTrue.length = Math.min(lastTrue.length, 5); }
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
  negationUnappliable: negUnapp, restatementMissing: restateMissing, restatementWeak: restateWeak, modelDivergedAnswers: modelDiverged,
  forgeryAcceptancePct: pct(acc, tried), forgeriesTried: tried, forgeryByClass: forg, falseRejections: falseReject, nonAnswers, nonAnswerFalseRejections: nonAnswerFalseReject,
};
console.log(JSON.stringify(out));
if (wrong > 0 || acc > 0 || falseReject > 0 || nonAnswerFalseReject > 0 || modelDiverged > 0) process.exitCode = 1;
