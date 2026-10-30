import type { AnswerEnvelope, PortfolioStore } from '../data/schema.ts';
import { numbersIn, numericLeaves } from '../domain/claim.ts';
import { parseQueryIntent } from './intent.ts';
import { executeCompositionalPlan } from './planner.ts';

/**
 * L3, the evidence layer: the answer is computed from a typed query, so the
 * verifier does not judge the figures by shape or bound. It re-parses the
 * query's question, checks the carried intent is the one that question
 * yields, re-runs the deterministic plan, and accepts a stated figure only
 * when the recompute produced exactly that value. The one derived form
 * allowed is a complement ("the other 96"): a recomputed whole minus a
 * recomputed part, and only where the text says other, remaining or rest.
 */
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.0051, Math.abs(b) * 1e-9);

export function recomputeErrors(envelope: AnswerEnvelope, store: PortfolioStore): string[] {
  const text = envelope.answer ?? '';
  const stated = numbersIn(text);
  const leaves = numericLeaves(envelope.result ?? {});
  const q = envelope.query;
  if (!q) {
    return stated.length + leaves.length > 0
      ? [`The answer states figures (${[...new Set([...stated, ...leaves])].join(', ')}) but carries no typed query to recompute them from`]
      : [];
  }
  if (typeof q.question !== 'string' || q.question.trim() === '') return ['The typed query has no question'];
  if (JSON.stringify(parseQueryIntent(q.question, store)) !== JSON.stringify(q.intent)) {
    return ['The typed query does not match the intent its question parses to'];
  }
  const ref = executeCompositionalPlan(
    { id: envelope.id, type: 'adhoc', question: q.question, ...(q.result_schema ? { result_schema: q.result_schema } : {}) },
    store,
    { verify: false },
  ).envelope;
  if (ref.result.unknown === true || ref.result.refused === true || ref.result.clarification_needed === true) {
    return ['The typed query has no answer to recompute, so no figure can be stated'];
  }
  const values = [...new Set([...numbersIn(ref.answer), ...numericLeaves(ref.result)])];
  const errors: string[] = [];
  const complements = [...plainLower(text).matchAll(/\b(?:the\s+)?(?:other|remaining|rest(?:\s+of\s+the)?)\s+(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  for (const n of stated) {
    if (values.some((v) => close(n, v))) continue;
    if (complements.includes(n) && values.some((a) => values.some((b) => a > b && close(n, a - b)))) continue;
    errors.push(`The answer states ${n}, which the recompute of its typed query does not produce (${values.join(', ') || 'no figures'})`);
  }
  // The claim binds by key: a count is the recomputed count, not any figure.
  for (const [key, v] of Object.entries(envelope.result ?? {})) {
    const want = (ref.result as Record<string, unknown>)[key];
    for (const n of numericLeaves(v)) {
      const ok = typeof want === 'number' ? close(n, want) : values.some((r) => close(n, r));
      if (!ok) errors.push(`Result ${key}=${n} is not the recomputed ${key}${typeof want === 'number' ? ` (${want})` : ''}`);
    }
  }
  // Stated facts that are not figures bind to the recompute too: building
  // names, ids, dates, quarters, years and status words. Each may appear no
  // more often than in the recomputed answer, so a swapped or repeated name
  // or a second "occupied" fails as a changed figure does.
  const refText = `${ref.answer} ${JSON.stringify(ref.result)} ${ref.citations.join(' ')}`;
  const have = tally(factsIn(ref.answer, store));
  const inRef = new Set(factsIn(refText, store));
  for (const [f, n] of tally(factsIn(text, store))) {
    if (!inRef.has(f)) errors.push(`The answer states ${f}, which the recompute of its typed query does not`);
    else if (n > Math.max(1, have.get(f) ?? 0)) errors.push(`The answer states ${f} ${n} times; the recompute states it ${have.get(f) ?? 0}`);
  }
  const refNums = tally(numbersIn(ref.answer).map(String));
  for (const [n, k] of tally(stated.map(String))) {
    if (complements.includes(Number(n))) continue;
    if (k > Math.max(1, refNums.get(n) ?? 0)) errors.push(`The answer states ${n} ${k} times; the recompute states it ${refNums.get(n) ?? 0}`);
  }
  // A status word is one the recompute uses, and a count next to one is
  // the count the recompute puts there.
  const STATUS = /\b(\d+)\s+(?:on\s+)?(vacant|occupied|notice)\b/g;
  const refPairs = [...plainLower(ref.answer).matchAll(STATUS)].map((m) => [m[1], m[2]]);
  for (const w of plainLower(text).match(/\b(?:vacant|occupied|notice)\b/g) ?? []) {
    if (!plainLower(ref.answer).includes(w)) errors.push(`The answer says ${w}, which the recompute does not`);
  }
  for (const [, n, w] of plainLower(text).matchAll(STATUS)) {
    const mine = refPairs.filter((p) => p[0] === n || p[1] === w);
    if (mine.length > 0 && !mine.some((p) => p[0] === n && p[1] === w)) errors.push(`The answer puts ${n} with ${w}; the recompute does not`);
  }
  // A name and the id beside it are the same building.
  for (const m of text.matchAll(/([A-Z][\w&.' ]+?)\s*[([](P\d{1,3})[)\]]/g)) {
    const p = store.properties.find((x) => m[1].trim().endsWith(x.name));
    if (p && p.propertyId !== m[2]) errors.push(`${p.name} is ${p.propertyId}, not ${m[2]}`);
  }
  for (const [key, v] of Object.entries(envelope.result ?? {})) {
    const refValue = (ref.result as Record<string, unknown>)[key];
    const want = new Set(refValue === undefined ? [] : stringLeaves(refValue));
    for (const x of stringLeaves(v)) if (refValue === undefined ? !refText.includes(x) : !want.has(x)) errors.push(`Result ${key} names "${x}", which the recompute does not`);
  }
  // A figure rests on rows: when the recompute cites rows below the
  // building level, the answer cites at least one of them. A sample is
  // enough; the planner itself cites a sample.
  const rows = ref.citations.filter((c) => !c.startsWith('properties:'));
  if (rows.length > 0 && !rows.some((c) => (envelope.citations ?? []).includes(c))) {
    errors.push(`The answer cites none of the rows its figures rest on (${rows.slice(0, 3).join(', ')})`);
  }
  // Provenance: every cited row belongs to a building the recompute is about.
  const owners = new Set(ref.citations.map((c) => store.primaryKeyIndex.get(c)));
  for (const c of envelope.citations ?? []) {
    if (!owners.has(store.primaryKeyIndex.get(c))) errors.push(`${c} lies outside the buildings the typed query covers`);
  }
  return errors;
}

/** Names, ids, dates, periods and status words a sentence states. */
function factsIn(text: string, store: PortfolioStore): string[] {
  const lower = plainLower(text);
  const names = store.properties.flatMap((p) => {
    const n = p.name.toLowerCase();
    return Array(lower.split(n).length - 1).fill(n) as string[];
  });
  return [
    ...names,
    ...(text.match(/\b(?:P\d{1,3}|[A-Z]{1,2}\d{3,})\b/g) ?? []),
    ...(lower.match(/\b\d{4}-\d{2}(?:-\d{1,2})?\b|\b(?:q[1-4]|h[12])\s+20\d{2}\b|\b20\d{2}\b/g) ?? []),
  ];
}

function tally(xs: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

function stringLeaves(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => stringLeaves(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => stringLeaves(x, out));
  return out;
}

const plainLower = (t: string) => t.normalize('NFKC').toLowerCase().replace(/(\d),(?=\d{3})/g, '$1');

/** The typed query a producer attaches for a question, as the planner does. */
export function typedQuery(question: string, store: PortfolioStore, result_schema?: Readonly<Record<string, string>>) {
  return { question, intent: parseQueryIntent(question, store), ...(result_schema ? { result_schema } : {}) };
}
