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
import { classifyFrame, frameModelConfig } from './frame-model.ts';
import { executeCompositionalPlan } from './planner.ts';
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
}

export interface CopilotTurnResult {
  readonly envelope: AnswerEnvelope;
  readonly toolCalls: readonly ToolCallTrace[];
  readonly clarificationNeeded: boolean;
  readonly clarifyingQuestion: string | null;
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

  const fhCheck = sessionRefusal(options.session, question) ?? checkFairHousingGuard(question, store);
  if (fhCheck.refused && options.session) options.session.refusedEarlier = true;
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
    if (frame.refuse) {
      const envelope: AnswerEnvelope = {
        id: qRecord.id,
        answer: `Refused: this asks to treat people differently based on ${frame.answers?.group.replace(/_/g, ' ')}, which the Fair Housing Act and the Illinois Human Rights Act prohibit. I can help with the same task without that criterion.`,
        result: { refused: true },
        citations: [],
      };
      return {
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

  return runDeterministicToolRouter(qRecord, store, frameFallback);
}

export function runDeterministicToolRouter(
  qRecord: QuestionRecord,
  store: PortfolioStore,
  llmFallbackReason: string | null = null,
): CopilotTurnResult {
  const out = closedVocabulary(executeCompositionalPlan(qRecord, store), qRecord, store);
  return {
    ...out,
    modeUsed: 'deterministic',
    providerUsed: 'deterministic',
    modelUsed: 'flowiq-deterministic-v2.0',
    llmFallbackReason,
  };
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
  const unparsed = unknownWords(withoutMetaInstructions(qRecord.question), store);
  const why =
    unparsed.length > 0
      ? `FlowIQ has no meaning for ${unparsed.map((w) => `"${w}"`).join(', ')} in this question`
      : /\bhow\s+many\b/i.test(qRecord.question) && !hasCount(r)
        ? 'the question asks "how many" but the plan computed no count'
        : null;
  if (why === null) return out;
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
