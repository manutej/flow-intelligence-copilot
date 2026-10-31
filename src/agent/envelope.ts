import * as nodeCrypto from 'node:crypto';
import { createHash, randomBytes } from 'node:crypto';

// The pinned @types/node predates createHmac's export; it exists at runtime.
const { createHmac } = nodeCrypto as unknown as {
  createHmac(alg: string, key: unknown): { update(data: string): { digest(enc: 'hex'): string } };
};
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
export type NonAnswerKind = 'unknown' | 'refused' | 'clarify';
export const nonAnswerKind = (r: Readonly<Record<string, unknown>> | undefined): NonAnswerKind | null =>
  r?.refused === true ? 'refused' : r?.clarification_needed === true ? 'clarify' : r?.unknown === true ? 'unknown' : null;

/**
 * What a non-answer (refusal, "I don't know", clarify) was rendered from.
 * deterministic and model turns are re-rendered from this input by the
 * verifier; session, frame and harness turns depend on state the verifier
 * does not hold, so for them the keyed seal is the whole check.
 */
export interface NonAnswerInput {
  readonly question: string;
  readonly origin: 'deterministic' | 'model' | 'session' | 'frame' | 'harness';
  readonly model_intent?: unknown;
}
type Rendered = Pick<AnswerEnvelope, 'answer' | 'result' | 'citations'>;
type Renderer = (input: NonAnswerInput, store: PortfolioStore) => Rendered;

// Per-process key: a seal proves this process rendered the turn. A
// FLOWIQ_SEAL_KEY lets separate processes (replays, audits) share it.
const SEAL_KEY = process.env.FLOWIQ_SEAL_KEY ? Buffer.from(process.env.FLOWIQ_SEAL_KEY) : randomBytes(32);
const seal = (input: NonAnswerInput, env: Rendered) =>
  createHmac('sha256', SEAL_KEY).update(hashOf({ input, answer: env.answer, result: env.result, citations: env.citations ?? null })).digest('hex');
const rendered = (env: Rendered) => hashOf({ answer: env.answer, result: env.result, citations: env.citations ?? null });

let renderer: Renderer | null = null;
/** The copilot registers how it renders a non-answer turn (avoids an import cycle). */
export function setNonAnswerRenderer(fn: Renderer): void {
  renderer = fn;
}

export function sealNonAnswer(input: NonAnswerInput, envelope: Rendered): { query: TypedQuery; proof: AnswerProof } {
  const kind = nonAnswerKind(envelope.result);
  return {
    query: { question: input.question, intent: { non_answer: kind, origin: input.origin, ...(input.model_intent !== undefined ? { model_intent: input.model_intent } : {}) } },
    proof: { template_id: `non_answer.${kind}`, query_hash: seal(input, envelope), result_hash: hashOf(envelope.result), row_ids: [] },
  };
}

/**
 * A non-answer is valid only when this process sealed it and, re-rendered
 * from its question (and the model reading, for a model turn), it is byte
 * for byte the same answer, result and citations. No figure or wording
 * heuristics: any edit, move or invention fails the comparison.
 */
export function nonAnswerErrors(envelope: AnswerEnvelope, store: PortfolioStore): string[] {
  const kind = nonAnswerKind(envelope.result);
  if (!kind) return [];
  const label = kind === 'refused' ? 'refusal' : kind === 'clarify' ? 'clarify' : '"I don\'t know"';
  const q = envelope.query as (TypedQuery & { intent?: Record<string, unknown> }) | undefined;
  const intent = (q?.intent ?? {}) as Record<string, unknown>;
  if (!q || typeof q.question !== 'string' || !envelope.proof || typeof intent.origin !== 'string') return [`The ${label} is not sealed to a question`];
  const input: NonAnswerInput = { question: q.question, origin: intent.origin as NonAnswerInput['origin'], ...('model_intent' in intent ? { model_intent: intent.model_intent } : {}) };
  if (intent.non_answer !== kind || envelope.proof.template_id !== `non_answer.${kind}` || envelope.proof.query_hash !== seal(input, envelope)) return [`The ${label} is not the one this process sealed for its question`];
  if (input.origin !== 'deterministic' && input.origin !== 'model') return [];
  if (!renderer) return ['No renderer is registered to re-render the non-answer'];
  let again: Rendered;
  try {
    again = renderer(input, store);
  } catch (e) {
    return [`The ${label} could not be re-rendered: ${(e as Error).message}`];
  }
  return rendered(again) === rendered(envelope) ? [] : [`The ${label} is not the turn FlowIQ renders for its question`];
}
