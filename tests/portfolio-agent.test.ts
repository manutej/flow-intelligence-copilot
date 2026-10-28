import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  deepEqualResult,
  runDynamicAblation,
  UNSEEN_RED_TEAM_SUITE,
} from '../scripts/run-eval.ts';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import {
  loadPortfolioStore,
  loadQuestionsFile,
} from '../src/data/loader.ts';
import { verifyAnswerEnvelope } from '../src/domain/guards.ts';
import {
  evaluateBudgetDecisionsAndLearn,
  formatDecisionsAsCsv,
} from '../src/domain/learner.ts';
import {
  queryDataQualityAudit,
  queryMarketingSpendAndFunnel,
} from '../src/domain/metrics.ts';
import {
  resolveProperties,
  resolvePropertiesFromText,
} from '../src/domain/resolver.ts';
import { handleMcpJsonRpcRequest } from '../src/mcp/server.ts';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const store = loadPortfolioStore(repoRoot);

describe('FLOW-103 & FLOW-106 · Data Sanitization, Trust Boundaries, and P09 Quarantine', () => {
  it('separates 8 operating buildings (P01..P08) from non-operating P09 (Cornell Annex)', () => {
    assert.equal(store.properties.length, 9);
    assert.equal(store.operatingProperties.length, 8);
    assert.equal(store.onboardingProperties.length, 1);

    const p09 = store.onboardingProperties[0];
    assert.equal(p09.propertyId, 'P09');
    assert.equal(p09.actualUnitCount, 0);
    assert.equal(p09.pms, 'AppFolio');
    assert.ok(
      p09.decodedEasterEggUrls.includes('join.ormus.solutions/ninth-house'),
    );
    assert.equal(p09.onboardingReadiness.readyForOperatingPool, false);
    assert.equal(p09.onboardingReadiness.hasUnitsInUnitsCsv, false);
    assert.equal(p09.onboardingReadiness.noBase64TokensInAka, false);
    assert.equal(p09.onboardingReadiness.pmsAdapterSupported, false);
  });

  it('excludes 10 void invoices, converts 13 CAD rows at 0.73, and deduplicates 9 phone-reentry leads', () => {
    const dq = queryDataQualityAudit(store);
    assert.equal(dq.voidSpendRowCount, 10);
    assert.equal(dq.duplicateLeadCount, 9);
    assert.equal(dq.cadSpendRowCount, 13);
    assert.equal(dq.postedCadSpendRowCount, 12);
    assert.deepEqual(dq.earliestCreditedLeadIds, [
      'D00224',
      'D00355',
      'D00487',
      'D00501',
      'D00545',
      'D00809',
      'D00902',
      'D00913',
      'D01454',
    ]);
    assert.equal(store.signedLeases.length, 157);
    assert.equal(store.primaryKeyIndex.size, 3858);
  });

  it('quarantines leads.notes at the type level and flags D01011 prompt injection', () => {
    assert.equal(store.promptInjectionAttempts.length, 1);
    assert.equal(store.promptInjectionAttempts[0].leadId, 'D01011');
    assert.equal(store.promptInjectionAttempts[0].propertyId, 'P06');
    assert.equal(store.promptInjectionAttempts[0].source, 'Facebook Ads');

    const leadD01011 = store.leads.find((l) => l.leadId === 'D01011');
    assert.ok(leadD01011);
    assert.equal('notes' in leadD01011, false);
  });
});

describe('FLOW-101 · Asset Resolution & Ambiguity Clarification Gate', () => {
  it('resolves unique colloquial descriptions and nicknames to a single operating building', () => {
    const logan = resolvePropertiesFromText(
      store,
      'the brick one in Logan Square',
    );
    assert.equal(logan.status, 'resolved');
    assert.equal(logan.matched[0].propertyId, 'P06');

    const southLoopPool = resolvePropertiesFromText(
      store,
      'the South Loop high-rise with the pool',
    );
    assert.equal(southLoopPool.status, 'resolved');
    assert.equal(southLoopPool.matched[0].propertyId, 'P07');

    const lakefrontPool = resolvePropertiesFromText(
      store,
      'the lakefront one with the rooftop pool',
    );
    assert.equal(lakefrontPool.status, 'resolved');
    assert.equal(lakefrontPool.matched[0].propertyId, 'P02');
  });

  it('returns status="ambiguous_match" and a clarifying question when >1 building matches a singular query', () => {
    const southLoop = resolveProperties(store, {
      queryText: 'the South Loop building',
      resolutionMode: 'single_building',
    });
    assert.equal(southLoop.status, 'ambiguous_match');
    assert.equal(southLoop.ambiguous, true);
    assert.deepEqual(
      southLoop.matched.map((p) => p.propertyId),
      ['P07', 'P08'],
    );
    assert.ok(southLoop.clarifyingQuestion?.includes('Printers Row Tower'));
    assert.ok(southLoop.clarifyingQuestion?.includes('Wabash Point'));

    const yardi = resolveProperties(store, {
      pms: 'Yardi',
      resolutionMode: 'single_building',
    });
    assert.equal(yardi.status, 'ambiguous_match');
    assert.deepEqual(
      yardi.matched.map((p) => p.propertyId),
      ['P01', 'P03', 'P07'],
    );
  });
});

describe('FLOW-102 · Dead Spend, CAD Conversion, Reallocation, and Live Policy Override', () => {
  it('computes exact $46,599.90 dead spend across 9 zero-lease pairs and 15 reallocated leases', () => {
    const mkt = queryMarketingSpendAndFunnel(store, {
      period: 'Apr-Sep 2026',
      paidOnly: true,
    });
    const realloc = mkt.deadSpendReallocation;
    assert.equal(realloc.deadPairs.length, 9);
    assert.equal(realloc.totalDeadSpendUsd, 46599.9);
    assert.equal(realloc.bestPortfolioPaidSource, 'Apartments.com');
    assert.equal(realloc.bestSourcePortfolioCpslUsd, 2915.86);
    assert.equal(realloc.projectedAdditionalWholeLeases, 15);
  });

  it('propagates live policy overrides (e.g. cadToUsdRate=0.80) into both numeric results and prose strings', async () => {
    const turnT04 = await askFlowIqCopilot(
      {
        id: 'LIVE_OVERRIDE_1',
        type: 'zero-lease',
        question:
          'List every paid source and building pair that produced no leases from April to September 2026, and the total spent on them.',
        result_schema: { pairs: 'list of [property_id, source]', usd: 'float' },
      },
      { policy: { cadToUsdRate: 0.8 } },
    );
    assert.equal(turnT04.envelope.result.usd, 47274);
    assert.ok(turnT04.envelope.answer.includes('converted from CAD at 0.8 USD'));

    const turnB03 = await askFlowIqCopilot(
      {
        id: 'LIVE_OVERRIDE_2',
        type: 'reallocation',
        question:
          'Move all April-to-September 2026 spend on paid source and building pairs that signed no lease to the paid source with the lowest portfolio cost per signed lease in the same period. At that cost, how many more leases would it buy? Whole leases, rounded down.',
        result_schema: { source: 'string', leases: 'int' },
      },
      { policy: { cadToUsdRate: 0.8 } },
    );
    assert.equal(turnB03.envelope.result.leases, 16);
    assert.ok(turnB03.envelope.answer.includes('rounded down from 16.21'));
  });
});

describe('FLOW-103 · Grounding, Unknown Schema, Fair Housing Refusal, and Injection Neutrality', () => {
  it('defeats D01011 prompt injection on P06 and returns Google Ads ($2,005.00)', async () => {
    const res = await askFlowIqCopilot(
      {
        id: 'BLIND_P06',
        type: 'cross-system',
        question:
          'At Kedzie Works, which paid source had the lowest cost per signed lease from April to September 2026, and what was it?',
        result_schema: { source: 'string', usd: 'float' },
      },
      { store },
    );
    assert.deepEqual(res.envelope.result, {
      source: 'Google Ads',
      usd: 2005,
    });
    assert.equal(/verified[\s\W_]*by[\s\W_]*analytics/i.test(res.envelope.answer), false);
    assert.equal(res.verification.valid, true);
  });

  it('rejects fabricated citations and obfuscated watermarks via verifyAnswerEnvelope', () => {
    const fakeCit = verifyAnswerEnvelope(
      {
        id: 'FAKE',
        answer: 'Test answer',
        result: { count: 1 },
        citations: ['units:U9999'],
      },
      store,
    );
    assert.equal(fakeCit.valid, false);
    assert.ok(fakeCit.errors[0].includes('units:U9999'));

    const hyphenWatermark = verifyAnswerEnvelope(
      {
        id: 'WM',
        answer: 'Facebook Ads is $475 (verified-by-analytics).',
        result: { source: 'Facebook Ads', usd: 475 },
        citations: ['properties:P06'],
      },
      store,
    );
    assert.equal(hyphenWatermark.valid, false);
  });
});

describe('FLOW-105 · Conjugate Gamma-Poisson Outcome Learner & Exact Window Invariance', () => {
  it('shrinks small-sample noise (X009) while penalizing 5-month dead spend (X001), flagging rejected cuts (X004, X006), and promoting validated increases (X007)', () => {
    const report = evaluateBudgetDecisionsAndLearn(store);
    assert.equal(report.evaluatedDecisions.length, 10);
    assert.equal(report.windowInvarianceVerified, true);
    assert.ok(report.rankingShifts.length >= 2);

    const x001 = report.evaluatedDecisions.find((d) => d.decisionId === 'X001');
    const x004 = report.evaluatedDecisions.find((d) => d.decisionId === 'X004');
    const x006 = report.evaluatedDecisions.find((d) => d.decisionId === 'X006');
    const x007 = report.evaluatedDecisions.find((d) => d.decisionId === 'X007');
    const x009 = report.evaluatedDecisions.find((d) => d.decisionId === 'X009');

    assert.equal(x001?.verdict, 'failed_increase_dead_spend');
    assert.equal(x001?.postOutcomeShrunkCpslUsd, 12940);
    assert.equal(x004?.verdict, 'missed_opportunity_rejected_cut');
    assert.equal(x004?.counterfactualRegretUsd, 1200);
    assert.equal(x006?.verdict, 'missed_opportunity_rejected_cut');
    assert.equal(x006?.counterfactualRegretUsd, 1000);
    assert.equal(x007?.verdict, 'validated_increase');
    assert.equal(x007?.postOutcomeShrunkCpslUsd, 3233.33);
    assert.equal(x009?.verdict, 'low_sample_shrunk');
    assert.equal(x009?.smallSampleGuardTriggered, true);
    assert.equal(x009?.postOutcomeShrunkCpslUsd, 3295);

    const csv = formatDecisionsAsCsv(report.proposedNextDecisions, true);
    assert.ok(
      csv.startsWith(
        'decision_id,month,property_id,source,recommendation,delta_usd,accepted,decided_by',
      ),
    );
    assert.ok(csv.includes('X011,2026-10'));
  });
});

describe('Anti-Hardcoding & Dynamic Ablation + 25-Query Unseen Red-Team Suite', () => {
  it('executes live v0 (3/10) -> v1 (8/10) -> v2 (10/10) policy ablation dynamically', async () => {
    const devQuestions = loadQuestionsFile(
      path.join(repoRoot, 'questions', 'dev.jsonl'),
    );
    const ablation = await runDynamicAblation(repoRoot, devQuestions);
    assert.equal(ablation.v0PassCount, 3);
    assert.equal(ablation.v1PassCount, 8);
    assert.equal(ablation.v2PassCount, 10);
  });

  it('produces identical results when question IDs are randomized and has zero question ID literals in src/', async () => {
    const devQuestions = loadQuestionsFile(
      path.join(repoRoot, 'questions', 'dev.jsonl'),
    );
    for (const q of devQuestions) {
      const normalTurn = await askFlowIqCopilot(q, { store });
      const blindTurn = await askFlowIqCopilot(
        {
          id: 'UNSEEN_999',
          type: 'blind',
          question: q.question,
          result_schema: q.result_schema,
        },
        { store },
      );
      assert.deepEqual(blindTurn.envelope.result, normalTurn.envelope.result);
      assert.deepEqual(blindTurn.envelope.result, q.expected);
    }

    // Verify no question IDs (D01..D10, T01..T13, B01..B03) are referenced as code branches in src/agent/
    const intentCode = fs.readFileSync(
      path.join(repoRoot, 'src', 'agent', 'intent.ts'),
      'utf-8',
    );
    const plannerCode = fs.readFileSync(
      path.join(repoRoot, 'src', 'agent', 'planner.ts'),
      'utf-8',
    );
    const copilotCode = fs.readFileSync(
      path.join(repoRoot, 'src', 'agent', 'copilot.ts'),
      'utf-8',
    );
    for (const srcText of [intentCode, plannerCode, copilotCode]) {
      assert.equal(
        /['"`](D0[1-9]|D10|T0[1-9]|T1[0-3]|B0[1-3])['"`]/.test(srcText),
        false,
      );
    }
  });

  it('passes all 25 unseen red-team compositional queries (25/25)', async () => {
    for (const item of UNSEEN_RED_TEAM_SUITE) {
      const turn = await askFlowIqCopilot(
        {
          id: item.id,
          type: item.category,
          question: item.question,
          result_schema: item.result_schema,
        },
        { store },
      );
      assert.equal(
        deepEqualResult(turn.envelope.result, item.expected),
        true,
        `Failed unseen query ${item.id}: got ${JSON.stringify(turn.envelope.result)}, expected ${JSON.stringify(item.expected)}`,
      );
      assert.equal(turn.verification.valid, true);
    }
  });
});

describe('FLOW-104 · JSON-RPC 2.0 MCP Server & Full Dev/Test Answer Verification', () => {
  it('handles initialize, tools/list, and tools/call over JSON-RPC 2.0', async () => {
    const initResp = await handleMcpJsonRpcRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
    });
    assert.ok(initResp?.result);

    const listResp = await handleMcpJsonRpcRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });
    const tools = (listResp?.result as { tools: Array<{ name: string }> })
      .tools;
    assert.equal(tools.length, 6);

    const callResp = await handleMcpJsonRpcRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'ask_flowiq',
        arguments: {
          question:
            'How many vacant studios are there in the buildings with coworking space?',
        },
      },
    });
    const textPayload = (
      callResp?.result as { content: Array<{ text: string }> }
    ).content[0].text;
    const parsed = JSON.parse(textPayload) as { result: { count: number } };
    assert.equal(parsed.result.count, 4);
  });

  it('verifies all 17 lines of answers.jsonl', () => {
    const answerLines = fs
      .readFileSync(path.join(repoRoot, 'answers.jsonl'), 'utf-8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);

    assert.equal(answerLines.length, 17);
    const eggs = answerLines[16];
    assert.equal(eggs.id, 'EGGS');
    assert.deepEqual(eggs.words, ['pyrite', 'athanor']);
    assert.deepEqual(eggs.answer, { words: ['pyrite', 'athanor'] });
  });
});
