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
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { nonAnswerKind, sealNonAnswer, sealProof } from '../src/agent/envelope.ts';
import { parseQueryIntent } from '../src/agent/intent.ts';
import { parseConfigFromEnv } from '../src/agent/model-parse.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';
import type { AnswerEnvelope } from '../src/data/schema.ts';
import { verifyAnswerEnvelope } from '../src/domain/guards.ts';

const argv = process.argv.slice(2);
const tierArg = argv.indexOf('--tier') >= 0 ? argv[argv.indexOf('--tier') + 1] : null;
const file = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--tier') ?? '/home/box/flowiq-scenarios/v1/set/questions.jsonl';
if (/holdout|heldout|expected|generation_audit|patterns|seeds|build_set/.test(file)) throw new Error(`refusing to read ${file}: dev questions only`);
// Each external set is pinned by sha256 with a blocking answer floor per
// source (and tier); a changed file fails until the pin is re-set on purpose.
const pins = JSON.parse(fs.readFileSync(new URL('./external-sets.json', import.meta.url).pathname, 'utf8')) as Record<string, { sha256: string; label: string; floors: Record<string, number> }>;
const pinKey = file.split('/').slice(-2).join('/');
const pin = pins[pinKey];
const sha = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const pinError = !pin ? `no pin for ${pinKey} in scripts/external-sets.json` : pin.sha256 !== sha ? `${pinKey} sha256 ${sha.slice(0, 12)} is not the pinned ${pin.sha256.slice(0, 12)}` : null;
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
  .filter((r) => !tierArg || r.tier === tierArg)
  .map((r) => (r.turns ? (r.turns.filter((t: { role: string }) => t.role === 'user').length === 1 ? r.turns.at(-1).content : null) : (r.question ?? r.direct_question ?? null)) as string | null)
  .filter((q): q is string => typeof q === 'string');
let answered = 0, falseReject = 0, forged = 0, forgedAccepted = 0, modelAnswers = 0, modelDiverged = 0, modelMismatch = 0;
let prev: AnswerEnvelope | null = null;
let nonAnswers = 0, nonAnswerFalseReject = 0, idkForged = 0, idkForgedAccepted = 0;
let lastIdk: AnswerEnvelope | null = null;
const rejectSample: string[] = [];
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
    // TENACITY c082279 findings 2/3: a non-answer moved onto this answerable
    // question, an unsealed "I don't know", and one with an added figure.
    // Non-answers sealed with this process's key onto this answerable
    // question: another question's genuine IDK, small and spelled-out
    // figures, a clarify with a figure; plus an unsealed IDK.
    const sealed = (answer: string, result: Record<string, unknown>) => ({ id: e.id, answer, result, citations: [], ...sealNonAnswer({ question: q, origin: 'deterministic' }, { answer, result, citations: [] }) });
    const forgeries = [
      ...(lastIdk ? [sealed(lastIdk.answer, lastIdk.result)] : []),
      { id: e.id, answer: "I don't know.", result: { unknown: true }, citations: [] },
      sealed("I don't know. Fulton Yards has 7 vacant units.", { unknown: true }),
      sealed("I don't know. Spend was forty thousand dollars.", { unknown: true }),
      sealed('Spend was $40,000 — did you mean Q2 or Q3?', { unknown: true, clarification_needed: true }),
    ];
    for (const f of forgeries) { idkForged++; if (verifyAnswerEnvelope(f as AnswerEnvelope, store).valid) idkForgedAccepted++; }
  } else if (nonAnswerKind(e.result as Record<string, unknown>)) {
    nonAnswers++;
    if (!d.verification.valid) { nonAnswerFalseReject++; if (rejectSample.length < 5) rejectSample.push(`${q.slice(0, 80)} :: ${(d.verification.errors ?? []).join('; ')}`); }
    else lastIdk = e;
  }
  if (isAnswer(e.result as Record<string, unknown>) && e.query) {
    // Citations shape forgeries on a real answer turned to $0.
    for (const citations of [undefined, null, 'units:U0001', {}]) {
      idkForged++;
      const z = { ...e, citations, result: Object.fromEntries(Object.entries(e.result).map(([k, v]) => [k, typeof v === 'number' ? 0 : v])), answer: 'It was $0.', proof: { ...(e.proof as object), row_ids: [] } };
      if (verifyAnswerEnvelope(z as unknown as AnswerEnvelope, store).valid) idkForgedAccepted++;
    }
  }
  const a = await askFlowIqCopilot(q, { store, parse, parseDeps: replay(q) } as never);
  if (a.parsePath === 'model' && isAnswer(a.envelope.result as Record<string, unknown>)) {
    modelAnswers++;
    if (JSON.stringify(a.parse?.intent) !== JSON.stringify(a.parse?.deterministic)) modelDiverged++;
    if (a.envelope.answer !== e.answer) modelMismatch++;
  }
}
const floor = pin?.floors[tierArg ?? 'all'] ?? 0;
const out = { source: file, tier: tierArg ?? 'all', label: pin?.label ?? null, sha256: sha, pinError, questions: qs.length, answered, answeredPct: Math.round((1000 * answered) / Math.max(1, qs.length)) / 10, answerFloorPct: floor, nonAnswers, nonAnswerFalseRejections: nonAnswerFalseReject, nonAnswerAndShapeForgeries: idkForged, nonAnswerAndShapeForgeriesAccepted: idkForgedAccepted, rejectSample, falseRejections: falseReject, coherentForgeries: forged, coherentForgeriesAccepted: forgedAccepted, modelAnswers, modelDivergedAnswers: modelDiverged, modelAnswerMismatch: modelMismatch };
console.log(JSON.stringify(out));
if (pinError || falseReject || forgedAccepted || nonAnswerFalseReject || idkForgedAccepted || out.answeredPct < floor || modelDiverged || modelMismatch) process.exitCode = 1;
