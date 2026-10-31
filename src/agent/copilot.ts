import { nonAnswerKind, sealNonAnswer, setNonAnswerRenderer, type NonAnswerInput } from './envelope.ts';
import { unboundNegators, unresolvedUnitWords } from './closed-world.ts';
import type { ParsedQueryIntent } from './intent.ts';
import { clarifyEnvelope, clarifyOptions, restate, type ClarifyOption } from './clarify.ts';
import { parseQueryIntent } from './intent.ts';
import { continuesPreviousTurn, refersBackToPeople, type FairHousingSession } from '../domain/fair-housing.ts';
import { unknownWords } from '../domain/vocabulary.ts';
import type { PortfolioPolicyConfig } from '../config/rules.ts';
import { loadPortfolioStore } from '../data/loader.ts';
import type {
  AnswerEnvelope,
  PortfolioStore,
  QuestionRecord,
} from '../data/schema.ts';
import {
  checkFairHousingGuard,
  checkUnknownDataGuard,
  verifyAnswerEnvelope,
} from '../domain/guards.ts';
import {
  type ModelHarnessConfig,
  type ModelProviderId,
  resolveModelHarnessConfig,
  runUniversalModelHarness,
} from './model-harness.ts';
import { classifyFrame, composeFrame, frameModelConfig, PROTECTED_GROUPS, type FrameAnswers, type ProtectedGroup } from './frame-model.ts';
import { executeCompositionalPlan } from './planner.ts';
import { coverage, modelParse, parseConfigFromEnv, toIntent, type ModelParse, type ParseConfig } from './model-parse.ts';
import type { RunStore } from './run-store.ts';
import { canonicalQuestion } from './clarify.ts';
import { hashOf } from './envelope.ts';
import type { ToolCallTrace } from './tools.ts';

export interface CopilotRunOptions {
  readonly mode?: 'deterministic' | 'llm';
  readonly provider?: ModelProviderId;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly harness?: Partial<ModelHarnessConfig>;
  readonly store?: PortfolioStore;
  readonly policy?: Partial<PortfolioPolicyConfig>;
  /** Carries a refusal to later turns of the same conversation. */
  readonly session?: FairHousingSession;
  /** S2-L1 model parse; defaults to FLOWIQ_PARSE_* env (off when unset). */
  readonly parse?: ParseConfig | null;
  readonly parseDeps?: Parameters<typeof modelParse>[3];
}

export interface CopilotTurnResult {
  readonly envelope: AnswerEnvelope;
  readonly toolCalls: readonly ToolCallTrace[];
  readonly clarificationNeeded: boolean;
  readonly clarifyingQuestion: string | null;
  readonly clarifyOptions?: readonly ClarifyOption[];
  /** The frame model's answers when it added a refusal (sealed for re-render). */
  readonly frameAnswers?: { readonly group: string; readonly treatment: boolean };
  readonly restatement?: string;
  /** S2: which parser produced the executed query, and why the model was not used. */
  readonly parsePath?: ModelParse['path'];
  readonly parseFallbackReason?: string | null;
  readonly parse?: ModelParse;
  readonly modeUsed: 'deterministic' | 'llm';
  readonly providerUsed?: ModelProviderId;
  readonly modelUsed?: string;
  readonly llmFallbackReason: string | null;
  readonly verification: {
    readonly valid: boolean;
    readonly errors: readonly string[];
  };
}

/**
 * Runs a portfolio question through the four-step pipeline:
 * 1. Pre-check (`FLOW-103`): Fair Housing refusal and unmodeled schema check (`unknown: true`).
 * 2. Building resolution (`FLOW-101`): resolves colloquial names or returns `clarification_needed: true`
 *    when a singular reference matches more than one operating property.
 * 3. Tool execution (`FLOW-102` / `FLOW-104` / `FLOW-105`): runs the 6 read-only portfolio tools via either
 *    the Universal Model Harness (`ollama`, `local_openai` / Raven / Flint, `openrouter`, `xai`, `openai`,
 *    `anthropic`) or the local compositional planner (`src/agent/intent.ts` + `src/agent/planner.ts`).
 * 4. Post-check (`FLOW-103`): verifies every `<table>:<id>` citation against the CSV primary keys.
 */
export async function askFlowIqCopilot(
  input: string | QuestionRecord,
  options: CopilotRunOptions = {},
): Promise<CopilotTurnResult> {
  const question = typeof input === 'string' ? input : input.question;
  // A session refusal depends on earlier turns; note it before this turn sets state.
  const sessionRefused = !!sessionRefusal(options.session, question);
  const refusedQuestion = options.session?.refusedQuestion;
  const t = await askUnsealed(input, options);
  const kind = nonAnswerKind(t.envelope.result as Record<string, unknown>);
  if (!kind) return t;
  // Seal every refusal, "I don't know" and clarify to what it was rendered from.
  const store = options.store && !options.policy ? options.store : loadPortfolioStore(undefined, options.policy);
  // A tool-calling harness non-answer has no re-render of its own: it is
  // sealed as deterministic, so it verifies only if it is the model-off turn.
  const origin: NonAnswerInput['origin'] = sessionRefused && kind === 'refused' ? 'session'
    : t.parse && t.parsePath && t.parsePath !== 'deterministic' ? 'model'
    : t.frameAnswers && kind === 'refused' ? 'frame'
    : 'deterministic';
  const sealInput: NonAnswerInput = { question, origin, ...(origin === 'model' ? { model_intent: t.parse!.intent } : {}), ...(origin === 'frame' ? { frame: t.frameAnswers! } : {}), ...(origin === 'session' ? { refused_question: refusedQuestion ?? '' } : {}) };
  const envelope = { ...t.envelope, ...sealNonAnswer(sealInput, t.envelope) };
  return { ...t, envelope, verification: verifyAnswerEnvelope(envelope, store) };
}

/** The deterministic turn for a question: the model-off pipeline, with no session or frame model. */
export function deterministicTurn(qRecord: QuestionRecord, store: PortfolioStore): AnswerEnvelope {
  const fh = checkFairHousingGuard(qRecord.question, store);
  if (fh.refused) return { id: qRecord.id, answer: fh.reason ?? 'Refused under the Fair Housing Act.', result: { refused: true }, citations: fh.citations };
  const unknownCheck = checkUnknownDataGuard(qRecord.question, store);
  if (unknownCheck.unknown) return { id: qRecord.id, answer: unknownCheck.reason ?? "I don't know — that field is not in the portfolio CSV exports.", result: { unknown: true }, citations: unknownCheck.citations };
  return runDeterministicToolRouter(qRecord, store).envelope;
}

/** The frame model's refusal, rendered from its sealed group answer. */
function frameRefusal(group: string): Pick<AnswerEnvelope, 'answer' | 'result' | 'citations'> {
  return {
    answer: `Refused: this asks to treat people differently based on ${group.replace(/_/g, ' ')}, which the Fair Housing Act and the Illinois Human Rights Act prohibit. I can help with the same task without that criterion.`,
    result: { refused: true },
    citations: [],
  };
}

setNonAnswerRenderer((input, store) => {
  const qRecord: QuestionRecord = { id: 'RENDER', type: 'adhoc', question: input.question };
  if (input.origin === 'session') {
    // Re-run the session predicate: it holds only for a turn that refers
    // back to the refused people or carries on from the refused turn.
    // The sealed earlier question must itself be refused by the guard, and
    // this question must refer back to it or carry on from it.
    if (typeof input.refused_question !== 'string' || !checkFairHousingGuard(input.refused_question, store).refused) {
      throw new Error('the sealed earlier question is not one the Fair Housing guard refuses');
    }
    const r = sessionRefusal({ refusedEarlier: true }, input.question);
    if (!r) throw new Error('the question does not carry on from a refused turn');
    return { answer: r.reason, result: { refused: true }, citations: r.citations };
  }
  if (input.origin === 'frame') {
    const f = input.frame;
    if (!f || typeof f.group !== 'string' || typeof f.treatment !== 'boolean' || !PROTECTED_GROUPS.includes(f.group as ProtectedGroup) || !composeFrame({ group: f.group, treatment: f.treatment } as FrameAnswers)) {
      throw new Error('the sealed frame answers do not compose to a refusal');
    }
    return frameRefusal(f.group);
  }
  if (input.origin === 'model') {
    const fh = checkFairHousingGuard(input.question, store);
    if (fh.refused || checkUnknownDataGuard(input.question, store).unknown) return deterministicTurn(qRecord, store);
    const intent = toIntent({ kind: 'query', question: input.question, intent: modelIntentKeys(input.model_intent) });
    if (typeof intent === 'string') throw new Error(`model reading is not a TypedQuery: ${intent}`);
    return modelReadingTurn(qRecord, store, intent).envelope;
  }
  return deterministicTurn(qRecord, store);
});

// A sealed model reading carries resolved date windows; toIntent takes keys.
function modelIntentKeys(i: unknown): unknown {
  if (!i || typeof i !== 'object') return i;
  const o = { ...(i as Record<string, unknown>) };
  for (const k of ['dateWindow', 'leaseStartWindow', 'leaseEndWindow']) {
    const w = o[k] as { key?: string } | undefined;
    if (w && typeof w === 'object' && typeof w.key === 'string') o[k] = w.key;
  }
  return o;
}

async function askUnsealed(
  input: string | QuestionRecord,
  options: CopilotRunOptions = {},
): Promise<CopilotTurnResult> {
  const store =
    options.store && !options.policy
      ? options.store
      : loadPortfolioStore(undefined, options.policy);

  const qRecord: QuestionRecord =
    typeof input === 'string'
      ? { id: 'ADHOC', type: 'adhoc', question: input }
      : input;

  const question = qRecord.question;
  const toolCalls: ToolCallTrace[] = [];

  const inherited = sessionRefusal(options.session, question);
  const fhCheck = inherited ?? checkFairHousingGuard(question, store);
  if (fhCheck.refused && options.session) {
    options.session.refusedEarlier = true;
    if (!inherited) options.session.refusedQuestion = question;
  }
  if (fhCheck.refused) {
    const envelope: AnswerEnvelope = {
      id: qRecord.id,
      answer: fhCheck.reason ?? 'Refused under the Fair Housing Act.',
      result: { refused: true },
      citations: fhCheck.citations,
    };
    return {
      envelope,
      toolCalls,
      clarificationNeeded: false,
      clarifyingQuestion: null,
      modeUsed: 'deterministic',
      providerUsed: 'deterministic',
      modelUsed: 'flowiq-deterministic-v2.0',
      llmFallbackReason: null,
      verification: verifyAnswerEnvelope(
        envelope,
        store,
        qRecord.result_schema,
      ),
    };
  }

  const unknownCheck = checkUnknownDataGuard(question, store);
  if (unknownCheck.unknown) {
    const envelope: AnswerEnvelope = {
      id: qRecord.id,
      answer:
        unknownCheck.reason ??
        "I don't know — that field is not in the portfolio CSV exports.",
      result: { unknown: true },
      citations: unknownCheck.citations,
    };
    return {
      envelope,
      toolCalls,
      clarificationNeeded: false,
      clarifyingQuestion: null,
      modeUsed: 'deterministic',
      providerUsed: 'deterministic',
      modelUsed: 'flowiq-deterministic-v2.0',
      llmFallbackReason: null,
      verification: verifyAnswerEnvelope(
        envelope,
        store,
        qRecord.result_schema,
      ),
    };
  }

  // L2 model layer: decomposed sub-questions that can only add a refusal to
  // the deterministic check above. Off unless FLOWIQ_FRAME_MODEL is set.
  const frameCfg = frameModelConfig();
  let frameFallback: string | null = null;
  if (frameCfg || process.env.FLOWIQ_FRAME_MODEL) {
    const frame = await classifyFrame(question);
    frameFallback = frame.fallbackReason;
    if (frame.refuse && frame.answers) {
      const envelope: AnswerEnvelope = { id: qRecord.id, ...frameRefusal(frame.answers.group) };
      return {
        frameAnswers: { group: frame.answers.group, treatment: frame.answers.treatment },
        envelope,
        toolCalls,
        clarificationNeeded: false,
        clarifyingQuestion: null,
        modeUsed: 'llm',
        providerUsed: 'openrouter',
        modelUsed: frameCfg?.model,
        llmFallbackReason: null,
        verification: verifyAnswerEnvelope(envelope, store, qRecord.result_schema),
      };
    }
  }

  if (options.mode === 'llm' || options.provider || options.harness) {
    const resolvedConfig = resolveModelHarnessConfig({
      ...options.harness,
      ...(options.provider ? { provider: options.provider } : {}),
      ...(options.model ? { model: options.model } : {}),
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    });

    if (resolvedConfig.provider === 'deterministic') {
      return runDeterministicToolRouter(
        qRecord,
        store,
        [frameFallback, 'No external LLM provider configured (set OLLAMA_HOST, LOCAL_LLM_BASE_URL, OPENROUTER_API_KEY, XAI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY); used local compositional planner'].filter(Boolean).join('. '),
      );
    }

    const harnessRes = await runUniversalModelHarness(qRecord, {
      store,
      harness: resolvedConfig,
    });

    return {
      envelope: harnessRes.envelope,
      toolCalls: harnessRes.toolCalls,
      clarificationNeeded: harnessRes.clarificationNeeded,
      clarifyingQuestion: harnessRes.clarifyingQuestion,
      modeUsed:
        harnessRes.providerUsed === 'deterministic' ? 'deterministic' : 'llm',
      providerUsed: harnessRes.providerUsed,
      modelUsed: harnessRes.modelUsed,
      llmFallbackReason: harnessRes.fallbackReason ?? frameFallback,
      verification: harnessRes.verification,
    };
  }

  const parseCfg = options.parse === undefined ? parseConfigFromEnv() : options.parse;
  if (parseCfg) return runModelParseRouter(qRecord, store, parseCfg, options.parseDeps, frameFallback);
  return runDeterministicToolRouter(qRecord, store, frameFallback);
}

/**
 * S2-L1: the model's TypedQuery runs only when it validates and covers the
 * question. A query that leaves a word or a stated filter unbound becomes a
 * clarify between typed readings; a model that is off, down, slow or off
 * schema hands the turn to the deterministic parser, and the turn says so.
 */
export async function runModelParseRouter(
  qRecord: QuestionRecord,
  store: PortfolioStore,
  cfg: ParseConfig,
  deps: CopilotRunOptions['parseDeps'],
  frameFallback: string | null = null,
): Promise<CopilotTurnResult> {
  const mp = await modelParse(qRecord.question, store, cfg, deps);
  const det = runDeterministicToolRouter(qRecord, store, frameFallback);
  const tag = (t: CopilotTurnResult, path: ModelParse['path'] = mp.path): CopilotTurnResult => {
    const r = { ...t, parsePath: path, parseFallbackReason: mp.fallbackReason, parse: mp };
    noteTurn(deps?.runStore, mp, r);
    return r;
  };
  if (mp.path === 'deterministic') return tag(det);
  const t = modelReadingTurn(qRecord, store, mp.intent, det, cfg.model, frameFallback);
  return tag(t, t.parsePath);
}

/**
 * The turn for a valid model reading, as a pure function of the question
 * and that reading (coverage and the lexicon parse are recomputed), so the
 * verifier can re-render a model clarify or "I don't know" byte for byte.
 */
export function modelReadingTurn(
  qRecord: QuestionRecord,
  store: PortfolioStore,
  intent: ParsedQueryIntent,
  det: CopilotTurnResult = runDeterministicToolRouter(qRecord, store),
  model = 'model',
  frameFallback: string | null = null,
): CopilotTurnResult {
  const deterministic = parseQueryIntent(qRecord.question, store);
  const cov = coverage(qRecord.question, intent, deterministic, store);
  const mp = { intent, deterministic, coverage: cov, path: cov.ok ? 'model' as const : 'model-clarify' as const };
  const cfg = { model };
  const tag = (t: CopilotTurnResult, path: ModelParse['path'] = mp.path): CopilotTurnResult => ({ ...t, parsePath: path });
  const isAnswer = (r: Record<string, unknown>) => r.unknown !== true && r.refused !== true && r.clarification_needed !== true;
  if (mp.path === 'model') {
    const out = closedVocabulary(executeCompositionalPlan(qRecord, store, { intent: mp.intent }), qRecord, store);
    if (isAnswer(out.envelope.result as Record<string, unknown>)) {
      return tag({ ...out, restatement: restate(mp.intent, qRecord.question, store), modeUsed: 'llm', providerUsed: 'local_openai', modelUsed: cfg.model, llmFallbackReason: frameFallback });
    }
    return tag(det, 'deterministic');
  }
  // model-clarify: model and lexicon disagree, or a word is unbound.
  if (!isAnswer(det.envelope.result as Record<string, unknown>)) return tag(det);
  // A model that only drops filters the lexicon bound from the question's
  // words, adds filters no word states, or differs in fields the computation does not read (the reading
  // restates the same), has not offered another reading; it failed to read
  // the whole question. That is a model failure: the turn is the model-off turn.
  if (mp.coverage.unbound.every((u) => u.includes(':'))) {
    const filled = { ...mp.intent } as Record<string, unknown>;
    const d0 = mp.deterministic as unknown as Record<string, unknown>;
    // Every word is bound here, so a field the model sets that the lexicon
    // left unset has no word behind it (unstated): an invented constraint.
    for (const u of mp.coverage.unbound) {
      const [k, how] = u.split(':');
      if (how === 'dropped') filled[k] = d0[k];
      if (how === 'unstated') delete filled[k];
    }
    if (restate(filled as unknown as ParsedQueryIntent, qRecord.question, store) === restate(mp.deterministic, qRecord.question, store)) return tag(det, 'deterministic');
  }
  const options: ClarifyOption[] = [
    { label: restate(mp.deterministic, qRecord.question, store).replace(/^I computed: /, ''), question: qRecord.question, query: mp.deterministic },
  ];
  const mq = canonicalQuestion(mp.intent);
  if (mq !== null && mq !== qRecord.question) options.push({ label: restate(mp.intent, mq, store).replace(/^I computed: /, ''), question: mq, query: mp.intent });
  // A model reading that cannot be put as a distinct question offers the user
  // nothing to choose: that is a model failure, so the turn is the model-off
  // turn rather than a dead end over a valid lexicon answer.
  if (options.length < 2) return tag(det, 'deterministic');
  const restatement = `I could not bind ${mp.coverage.unbound.join(', ')}. I read: ${restate(mp.deterministic, qRecord.question, store).replace(/^I computed: /, '')}`;
  const envelope: AnswerEnvelope = options.length >= 2
    ? { id: qRecord.id, answer: `I am not sure which question you mean. Did you mean: ${options.map((o, k) => `(${k + 1}) ${o.label}`).join('; ')}?`, result: { unknown: true, clarification_needed: true }, citations: [] }
    : { id: qRecord.id, answer: `I don't know — ${restatement}`, result: { unknown: true }, citations: [] };
  return tag({
    envelope, toolCalls: [], clarificationNeeded: options.length >= 2, clarifyingQuestion: options.length >= 2 ? options.map((o) => o.question).join(' / ') : null,
    ...(options.length >= 2 ? { clarifyOptions: options } : {}), restatement,
    modeUsed: 'llm', providerUsed: 'local_openai', modelUsed: cfg.model, llmFallbackReason: frameFallback,
    verification: verifyAnswerEnvelope(envelope, store, qRecord.result_schema),
  });
}

// A negated status has no single-status field; the restatement must not
// claim the inverted status was read.
function negationNote(question: string): string {
  const neg = unboundNegators(question);
  return neg.length ? ` (${neg.map((w) => `"${w}"`).join(', ')} has no field: a typed query holds a status or a status set, never a negation)` : '';
}
function stripStatusIfNegated(i: ParsedQueryIntent, question: string): ParsedQueryIntent {
  return unboundNegators(question).length ? { ...i, unitStatus: undefined } : i;
}

function noteTurn(runs: RunStore | null | undefined, mp: ModelParse, t: CopilotTurnResult): void {
  if (!runs || !mp.runKey) return;
  runs.append({ type: 'turn', key: mp.runKey, ts: new Date().toISOString(), path: t.parsePath, clarify_options: (t.clarifyOptions ?? []).map((o) => o.question), answer_hash: hashOf({ answer: t.envelope.answer, result: t.envelope.result }) });
}

export function runDeterministicToolRouter(
  qRecord: QuestionRecord,
  store: PortfolioStore,
  llmFallbackReason: string | null = null,
): CopilotTurnResult {
  const out = closedVocabulary(executeCompositionalPlan(qRecord, store), qRecord, store);
  const r = out.envelope.result as Record<string, unknown>;
  const answered = r.unknown !== true && r.refused !== true && r.clarification_needed !== true;
  const offered = answered || r.refused === true ? [] : out.clarifyOptions ?? unitClarify(qRecord.question, store).clarifyOptions ?? [];
  const opts = wellFormedOptions(offered, qRecord, store);
  return {
    ...withClarify(out, opts, qRecord, store),
    ...(answered
      ? { restatement: restate(parseQueryIntent(qRecord.question, store), qRecord.question, store) }
      : opts.length > 0
        ? { restatement: `I could not bind every word${negationNote(qRecord.question)}. I read: ${restate(stripStatusIfNegated(parseQueryIntent(qRecord.question, store), qRecord.question), qRecord.question, store).replace(/^I computed: /, '')}` }
        : r.refused === true ? {}
          // A dead end still says what was read, so the user can rephrase.
          : { restatement: `I did not answer${negationNote(qRecord.question)}. I read: ${restate(stripStatusIfNegated(parseQueryIntent(qRecord.question, store), qRecord.question), qRecord.question, store).replace(/^I computed: /, '')}` }),
    modeUsed: 'deterministic',
    providerUsed: 'deterministic',
    modelUsed: 'flowiq-deterministic-v2.0',
    llmFallbackReason,
  };
}

/**
 * Clarify options are well-formed (S1R F-077): each carries a non-empty
 * question, no two are the same, and each one FlowIQ runs to an answer, so
 * one click never lands on another unknown. A reading that fails is dropped.
 */
function wellFormedOptions(options: readonly ClarifyOption[], qRecord: QuestionRecord, store: PortfolioStore): ClarifyOption[] {
  const seen = new Set<string>();
  // A reading keeps the measure the question asks for (S2-CL): a count in
  // place of an average is a different question.
  const asked = parseQueryIntent(qRecord.question, store).measure;
  return options.filter((o) => {
    if (asked !== 'unsupported' && o.query && o.query.measure !== asked) return false;
    const q = o.question.trim();
    if (q.length === 0 || o.label.trim().length === 0 || seen.has(q.toLowerCase()) || q === qRecord.question.trim()) return false;
    seen.add(q.toLowerCase());
    const res = closedVocabulary(executeCompositionalPlan({ ...qRecord, question: q }, store), { ...qRecord, question: q }, store).envelope.result as Record<string, unknown>;
    return res.unknown !== true && res.refused !== true && res.clarification_needed !== true;
  }).slice(0, 4);
}

/** Options offered means clarification_needed is true, in the result and on the turn; none offered means none claimed. */
function withClarify(
  out: ReturnType<typeof executeCompositionalPlan>,
  options: ClarifyOption[],
  qRecord: QuestionRecord,
  store: PortfolioStore,
): ReturnType<typeof executeCompositionalPlan> {
  const r = out.envelope.result as Record<string, unknown>;
  if (options.length === 0) {
    const { clarifyOptions: _drop, ...rest } = out;
    return rest;
  }
  const head = out.envelope.answer.replace(/\s*Did you mean:[\s\S]*$/, '').trim();
  const envelope: AnswerEnvelope = {
    ...out.envelope,
    answer: `${head} Did you mean: ${options.map((o, k) => `(${k + 1}) ${o.label}`).join('; ')}?`,
    result: { ...r, unknown: true, clarification_needed: true },
  };
  return {
    ...out,
    envelope,
    clarifyOptions: options,
    clarificationNeeded: true,
    clarifyingQuestion: out.clarifyingQuestion ?? options.map((o) => o.question).join(' / '),
    verification: verifyAnswerEnvelope(envelope, store, qRecord.result_schema),
  };
}

/** A unit question left unknown by words no filter binds gets typed readings, not a dead end. */
function unitClarify(question: string, store: PortfolioStore): { clarifyOptions?: readonly ClarifyOption[] } {
  if (parseQueryIntent(question, store).domain !== 'units') return {};
  const unbound = unresolvedUnitWords(question, store).filter((w) => /^\p{L}/u.test(w));
  return unbound.length > 0 ? { clarifyOptions: clarifyOptions(question, unbound, store) } : {};
}

/**
 * L1 closed grammar: an answer stands only if every word of the question has a
 * meaning. Refusals, unknowns and clarifications pass through untouched.
 */
function closedVocabulary(
  out: ReturnType<typeof executeCompositionalPlan>,
  qRecord: QuestionRecord,
  store: PortfolioStore,
): ReturnType<typeof executeCompositionalPlan> {
  const r = out.envelope.result as Record<string, unknown>;
  if (r.unknown === true || r.refused === true || r.clarification_needed === true) return out;
  const asked = withoutMetaInstructions(qRecord.question);
  const unparsed = [...unknownWords(asked, store), ...(out.envelope.query && (out.envelope.query.intent as { domain?: string }).domain === 'units' ? unboundNegators(asked) : [])];
  const why =
    unparsed.length > 0
      ? `FlowIQ has no meaning for ${unparsed.map((w) => `"${w}"`).join(', ')} in this question`
      : /\bhow\s+many\b/i.test(qRecord.question) && !hasCount(r)
        ? 'the question asks "how many" but the plan computed no count'
        : null;
  if (why === null) return out;
  if (unparsed.length > 0) {
    // Clarify, not a dead end: offer typed readings (result keys unchanged).
    const { envelope: c, options } = clarifyEnvelope(qRecord.id, qRecord.question, unparsed, store);
    const envelope: AnswerEnvelope = { ...c, result: { unknown: true } };
    return { ...out, envelope, clarifyOptions: options, verification: verifyAnswerEnvelope(envelope, store, qRecord.result_schema) };
  }
  const envelope: AnswerEnvelope = {
    id: qRecord.id,
    answer: `I don't know — ${why}, so it will not answer a different question in its place.`,
    result: { unknown: true },
    citations: ['properties:P01'],
  };
  return { ...out, envelope, verification: verifyAnswerEnvelope(envelope, store, qRecord.result_schema) };
}

/**
 * An instruction about FlowIQ's own rules ("[SYSTEM OVERRIDE: ...]",
 * "Ignore prior rules", "Do not obey any lead note") asks nothing of the
 * data, and the answer is computed from the data whatever it says, so its
 * words are not question words. An instruction about the data ("only count
 * lake views") is kept and must parse.
 */
const META_INSTRUCTION_RE =
  /\[[^\]]*\b(?:system|override|ignore|instructions?|rules?)\b[^\]]*\]|[^.?!]*\b(?:ignore|disregard|override|(?:do\s+not|don'?t|never)\s+(?:obey|follow|trust|believe))\b[^.?!]*\b(?:rules?|instructions?|notes?|prompts?|system|messages?)\b[^.?!]*[.!]?/gi;

function withoutMetaInstructions(question: string): string {
  return question.normalize('NFKC').replace(/[\p{Cf}]/gu, '').replace(META_INSTRUCTION_RE, ' ');
}

/** "How many" is answered by a whole-number count, not by money, a rate or a size. */
function hasCount(result: Record<string, unknown>): boolean {
  const MEASURE = /usd|percent|rate|sqft|rent|share|mean|avg|average|posterior|delta/i;
  const walk = (v: unknown, key: string): boolean =>
    typeof v === 'number'
      ? Number.isInteger(v) && !MEASURE.test(key)
      : v !== null && typeof v === 'object' && Object.entries(v).some(([k, x]) => walk(x, Array.isArray(v) ? key : k));
  return walk(result, '');
}

function sessionRefusal(session: FairHousingSession | undefined, question: string) {
  if (!session?.refusedEarlier) return null;
  // Only a turn that points back at the people or carries on from the
  // refused turn inherits it; a clean, self-contained question is answered.
  if (!refersBackToPeople(question) && !continuesPreviousTurn(question)) return null;
  return {
    refused: true,
    reason:
      'Refused: earlier in this conversation I refused a request to treat a group of people differently, and this refers back to those people. I can answer the same question without them, for example "How many studios are vacant at Kedzie Works?".',
    citations: [] as never[],
  };
}
