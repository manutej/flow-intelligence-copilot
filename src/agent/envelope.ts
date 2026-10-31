import { createHash } from 'node:crypto';
import type { AnswerEnvelope, AnswerProof, PortfolioStore, TypedQuery } from '../data/schema.ts';
import { parseQueryIntent, type ParsedQueryIntent } from './intent.ts';
import { executeCompositionalPlan } from './planner.ts';
import { typedQueryErrors } from './typed-query.ts';

/**
 * S2-L3: an answer is a render, not a claim. The planner renders each answer
 * from one fixed template per domain.measure.aggregation, filled only from
 * the result object and the store's canonical names. The verifier does not
 * read the text for figures: it re-executes the typed query, re-renders, and
 * accepts only an envelope whose answer bytes, result, rows and hashes equal
 * the re-render. Any edit to the text, however small, is a forgery.
 */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    return `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

export const hashOf = (v: unknown): string => createHash('sha256').update(canonical(v)).digest('hex');

export function templateId(intent: ParsedQueryIntent): string {
  return `${intent.domain}.${intent.measure}.${intent.aggregation}`;
}

export function sealProof(query: TypedQuery, result: Readonly<Record<string, unknown>>, rows: readonly string[]): AnswerProof {
  return {
    template_id: templateId(query.intent as ParsedQueryIntent),
    query_hash: hashOf(query),
    result_hash: hashOf(result),
    row_ids: [...rows],
  };
}

/** Why an answering envelope is not the exact re-render of its typed query; empty when it is. */
export function envelopeErrors(envelope: AnswerEnvelope, store: PortfolioStore): string[] {
  const q = envelope.query;
  const p = envelope.proof;
  if (!q || !p) return ['The answer carries no typed query and proof, so it is not a render of any computation'];
  if (typeof q.question !== 'string' || q.question.trim() === '') return ['The typed query has no question'];
  const intent = q.intent as ParsedQueryIntent;
  const schemaErrs = intent && typeof intent === 'object' ? typedQueryErrors(intent) : ['intent is missing'];
  if (schemaErrs.length > 0) return [`The typed query is not valid: ${schemaErrs.join('; ')}`];
  const errors: string[] = [];
  // F3: the query must be the reading of its own question, so another
  // question's render cannot be resealed under this one.
  if (hashOf(parseQueryIntent(q.question, store)) !== hashOf(intent)) {
    errors.push('The typed query is not the reading of its question');
  }
  if (p.query_hash !== hashOf(q)) errors.push('query_hash does not match the typed query');
  if (p.result_hash !== hashOf(envelope.result ?? {})) errors.push('result_hash does not match the result');
  const ref = executeCompositionalPlan(
    { id: envelope.id, type: 'adhoc', question: q.question, ...(q.result_schema ? { result_schema: q.result_schema } : {}) },
    store,
    { verify: false, intent },
  ).envelope;
  const r = ref.result as Record<string, unknown>;
  if (r.unknown === true || r.refused === true || r.clarification_needed === true) {
    return [...errors, 'The typed query has no answer on re-execution, so no figure can be stated'];
  }
  const rp = ref.proof!;
  if (p.template_id !== rp.template_id) errors.push(`template_id ${p.template_id} is not ${rp.template_id}`);
  if (p.result_hash !== rp.result_hash) errors.push('The result is not the re-executed result');
  if (canonical([...p.row_ids].sort()) !== canonical([...rp.row_ids].sort())) errors.push('row_ids are not the re-executed rows');
  if (canonical([...(Array.isArray(envelope.citations) ? envelope.citations : [])].sort()) !== canonical([...ref.citations].sort())) errors.push('The citations are not the re-executed rows');
  if (envelope.answer !== ref.answer) errors.push('The answer text is not byte-equal to the template re-render');
  return errors;
}

/**
 * TENACITY S2 finding 3: an "I don't know" or a refusal is bound to its
 * question too. The seal hashes the question, the outcome, the reason and
 * the text, so none can be moved or edited; the verifier then checks the
 * outcome is real for that question (its plain reading must not answer, and
 * a refusal must be one the fair-housing guard makes) and that the text adds
 * no figure the question did not state.
 */
export type NonAnswerKind = 'unknown' | 'refused';
export const nonAnswerKind = (r: Readonly<Record<string, unknown>> | undefined): NonAnswerKind | null =>
  r?.refused === true ? 'refused' : r?.unknown === true ? 'unknown' : null;

export function sealNonAnswer(question: string, envelope: Pick<AnswerEnvelope, 'answer' | 'result'>): { query: TypedQuery; proof: AnswerProof } {
  const kind = nonAnswerKind(envelope.result);
  return {
    query: { question, intent: { non_answer: kind } },
    proof: { template_id: `non_answer.${kind}`, query_hash: hashOf({ question, kind, reason: envelope.result.reason ?? null, answer: envelope.answer }), result_hash: hashOf(envelope.result), row_ids: [] },
  };
}

// A figure is money, a percent, or a number of 2+ digits outside an id.
const FIGURE_RE = /\$\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?%|(?<![A-Za-z#§:])\d{2,}(?:,\d{3})*(?:\.\d+)?(?![A-Za-z])/g;
// Legal citations ("42 U.S.C. § 3604(f)", "§ 5-8-030", "775 ILCS 5/3-102") and years are not figures.
const STATUTE_RE = /\b\d{4}-\d{2}(?:-\d{2})?\b|\d+\s+U\.S\.C\.?|§+\s*[\w.\-()/]+|\d+\s+ILCS\s+[\w./\-()]+|\b(?:19|20)\d\d\b/g;
const figures = (s: string) => (s.replace(STATUTE_RE, ' ').match(FIGURE_RE) ?? []).map((f) => f.replace(/[\s$,%]/g, ''));

export function nonAnswerErrors(
  envelope: AnswerEnvelope,
  store: PortfolioStore,
  confirm: { refusedBy: (question: string) => boolean; closedWorldGap: (question: string) => boolean },
): string[] {
  const kind = nonAnswerKind(envelope.result);
  if (!kind) return [];
  const q = envelope.query;
  if (!q || typeof q.question !== 'string' || !envelope.proof) return [`The ${kind === 'refused' ? 'refusal' : '"I don\'t know"'} is not sealed to a question`];
  const errors: string[] = [];
  const sealed = sealNonAnswer(q.question, envelope);
  if (envelope.proof.query_hash !== sealed.proof.query_hash || envelope.proof.result_hash !== sealed.proof.result_hash || envelope.proof.template_id !== sealed.proof.template_id) {
    errors.push('The non-answer is not the sealed one for its question');
  }
  const asked = new Set(figures(q.question));
  const added = figures(envelope.answer).filter((f) => !asked.has(f));
  if (added.length > 0) errors.push(`A non-answer must not state figures (${[...new Set(added)].join(', ')})`);
  if (kind === 'refused' && !confirm.refusedBy(q.question)) errors.push('The refusal is not one the fair-housing guard makes for its question');
  if (kind === 'unknown' && !confirm.closedWorldGap(q.question) && !confirm.refusedBy(q.question)) {
    // Re-parse and re-execute: an answerable plain reading is not unknown.
    const intent = parseQueryIntent(q.question, store);
    if (intent.measure !== 'unsupported') {
      const plan = executeCompositionalPlan({ id: envelope.id, type: 'adhoc', question: q.question }, store, { intent, verify: false });
      const r = plan.envelope.result as Record<string, unknown>;
      if (!nonAnswerKind(r) && r.clarification_needed !== true && envelopeErrors(plan.envelope, store).length === 0) errors.push('The question has an answer, so "I don\'t know" is not its outcome');
    }
  }
  return errors;
}
