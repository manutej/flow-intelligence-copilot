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
  // Provenance: every cited row belongs to a building the recompute is about.
  const owners = new Set(ref.citations.map((c) => store.primaryKeyIndex.get(c)));
  for (const c of envelope.citations ?? []) {
    if (!owners.has(store.primaryKeyIndex.get(c))) errors.push(`${c} lies outside the buildings the typed query covers`);
  }
  return errors;
}

const plainLower = (t: string) => t.normalize('NFKC').toLowerCase().replace(/(\d),(?=\d{3})/g, '$1');

/** The typed query a producer attaches for a question, as the planner does. */
export function typedQuery(question: string, store: PortfolioStore, result_schema?: Readonly<Record<string, string>>) {
  return { question, intent: parseQueryIntent(question, store), ...(result_schema ? { result_schema } : {}) };
}
