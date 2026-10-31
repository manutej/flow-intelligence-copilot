/**
 * TENACITY F4: a fuzz set the S2 generator did not write. Runs Scenario's
 * dev questions (questions.jsonl only; never holdout, expected or audit
 * files) through the deterministic path and through the adversarial replay
 * model, and checks what holds without expected answers:
 *   - every answer verifies (false rejections = 0),
 *   - a coherent resealed forgery (the previous answer under this question) is rejected,
 *   - the model path never answers with an intent other than the lexicon reading,
 *   - an adversarial-model answer is byte-equal to the deterministic answer.
 * Prints one JSON line; exits 1 on any failure.
 *   node --no-warnings scripts/s3-external-fuzz.ts [questions.jsonl]
 */
import fs from 'node:fs';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { sealProof } from '../src/agent/envelope.ts';
import { parseQueryIntent } from '../src/agent/intent.ts';
import { parseConfigFromEnv } from '../src/agent/model-parse.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';
import type { AnswerEnvelope } from '../src/data/schema.ts';
import { verifyAnswerEnvelope } from '../src/domain/guards.ts';

const file = process.argv[2] ?? '/home/box/flowiq-scenarios/v1/set/questions.jsonl';
if (/holdout|heldout|expected|generation_audit/.test(file)) throw new Error(`refusing to read ${file}: dev questions only`);
const store = loadPortfolioStore();
const parse = parseConfigFromEnv({ FLOWIQ_PARSE_URL: 'http://adversarial.invalid/v1', FLOWIQ_PARSE_NO_CACHE: '1' });
let s = 9173;
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const replay = (question: string) => {
  const det = parseQueryIntent(question, store) as unknown as Record<string, any>;
  const muts: Array<Record<string, unknown>> = [{}, { isWholePortfolioExplicit: !det.isWholePortfolioExplicit }, { dateWindow: det.dateWindow?.key === 'Q3_2026' ? 'Q2_2026' : 'Q3_2026' }, { paidOnly: !det.paidOnly }, { aggregation: det.aggregation === 'value' ? 'argmax' : 'value' }];
  const intent = { ...det, dateWindow: det.dateWindow?.key, ...(det.leaseStartWindow ? { leaseStartWindow: det.leaseStartWindow.key } : {}), ...(det.leaseEndWindow ? { leaseEndWindow: det.leaseEndWindow.key } : {}), ...muts[Math.floor(rnd() * muts.length)] };
  const content = JSON.stringify({ kind: 'query', question, intent });
  return { runStore: null, fetch: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) }) };
};
const isAnswer = (r: Record<string, unknown>) => r.unknown !== true && r.refused !== true && r.clarification_needed !== true && r.draft !== true;
const qs = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  .map((r) => (r.turns ? (r.turns.filter((t: { role: string }) => t.role === 'user').length === 1 ? r.turns.at(-1).content : null) : (r.question ?? r.direct_question ?? null)) as string | null)
  .filter((q): q is string => typeof q === 'string');
let answered = 0, falseReject = 0, forged = 0, forgedAccepted = 0, modelAnswers = 0, modelDiverged = 0, modelMismatch = 0;
let prev: AnswerEnvelope | null = null;
for (const q of qs) {
  const d = await askFlowIqCopilot(q, { store, parse: null });
  const e = d.envelope;
  if (isAnswer(e.result as Record<string, unknown>) && e.query) {
    answered++;
    if (!verifyAnswerEnvelope(e, store).valid) falseReject++;
    if (prev?.query && prev.answer !== e.answer) {
      const query = { ...prev.query, question: e.query.question };
      forged++;
      if (verifyAnswerEnvelope({ ...prev, id: e.id, query, proof: sealProof(query, prev.result, prev.proof?.row_ids ?? []) }, store).valid) forgedAccepted++;
    }
    prev = e;
  }
  const a = await askFlowIqCopilot(q, { store, parse, parseDeps: replay(q) } as never);
  if (a.parsePath === 'model' && isAnswer(a.envelope.result as Record<string, unknown>)) {
    modelAnswers++;
    if (JSON.stringify(a.parse?.intent) !== JSON.stringify(a.parse?.deterministic)) modelDiverged++;
    if (a.envelope.answer !== e.answer) modelMismatch++;
  }
}
const out = { source: file, questions: qs.length, answered, falseRejections: falseReject, coherentForgeries: forged, coherentForgeriesAccepted: forgedAccepted, modelAnswers, modelDivergedAnswers: modelDiverged, modelAnswerMismatch: modelMismatch };
console.log(JSON.stringify(out));
if (falseReject || forgedAccepted || modelDiverged || modelMismatch) process.exitCode = 1;
