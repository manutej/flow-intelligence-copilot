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
  if (canonical([...(envelope.citations ?? [])].sort()) !== canonical([...ref.citations].sort())) errors.push('The citations are not the re-executed rows');
  if (envelope.answer !== ref.answer) errors.push('The answer text is not byte-equal to the template re-render');
  return errors;
}
