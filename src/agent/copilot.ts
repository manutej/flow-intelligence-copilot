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

  const fhCheck = checkFairHousingGuard(question, store);
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
        'No external LLM provider configured (set OLLAMA_HOST, LOCAL_LLM_BASE_URL, OPENROUTER_API_KEY, XAI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY); used local compositional planner',
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
      llmFallbackReason: harnessRes.fallbackReason,
      verification: harnessRes.verification,
    };
  }

  return runDeterministicToolRouter(qRecord, store, null);
}

export function runDeterministicToolRouter(
  qRecord: QuestionRecord,
  store: PortfolioStore,
  llmFallbackReason: string | null = null,
): CopilotTurnResult {
  const out = executeCompositionalPlan(qRecord, store);
  return {
    ...out,
    modeUsed: 'deterministic',
    providerUsed: 'deterministic',
    modelUsed: 'flowiq-deterministic-v2.0',
    llmFallbackReason,
  };
}
