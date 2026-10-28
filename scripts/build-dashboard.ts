import fs from "node:fs";
import path from "node:path";
import { askFlowIqCopilot } from "../src/agent/copilot.ts";
import { MODEL_PROVIDER_PROFILES } from "../src/agent/model-harness.ts";
import {
  CURRENCY_RATES_TO_USD,
  DISCOVERED_EASTER_EGGS,
  LEASE_ATTRIBUTION_BUCKET_BY,
  OCCUPIED_INCLUDES_NOTICE,
  OUTCOME_LEARNER_CONFIG,
  PORTFOLIO_TODAY,
} from "../src/config/rules.ts";
import {
  loadPortfolioStore,
  loadQuestionsFile,
} from "../src/data/loader.ts";
import { evaluateBudgetDecisionsAndLearn } from "../src/domain/learner.ts";
import {
  queryDataQualityAudit,
  queryLeasesAndRenewals,
  queryMarketingSpendAndFunnel,
  queryUnitsAndOccupancy,
} from "../src/domain/metrics.ts";
import {
  evaluateSheafCoboundary,
  FLOW_PORTFOLIO_SHEAF_EDGES,
} from "../src/domain/sheaf.ts";
import { runDurableWorkflowSimulation } from "../src/workflows/temporal-worker.ts";
import {
  runDynamicAblation,
  UNSEEN_RED_TEAM_SUITE,
} from "./run-eval.ts";

interface OperadicBankRecord {
  id: string;
  stratum: string;
  editorial_color: string;
  leaf_question: string;
  root_template: string;
  direct_question: string;
  result_schema: Record<string, string>;
  expected: Record<string, unknown>;
}

export async function buildOrmusDashboard(): Promise<void> {
  const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
  const store = loadPortfolioStore(repoRoot);

  const devQs = loadQuestionsFile(path.join(repoRoot, "questions", "dev.jsonl"));
  const testQs = loadQuestionsFile(path.join(repoRoot, "questions", "test.jsonl"));
  const bonusQs = loadQuestionsFile(
    path.join(repoRoot, "questions", ".bonus.jsonl"),
  ).filter((q) => q.id !== "B00");

  const operadicPath = path.join(repoRoot, "questions", "operadic-interview-bank.jsonl");
  const operadicRaw: OperadicBankRecord[] = fs.existsSync(operadicPath)
    ? fs
        .readFileSync(operadicPath, "utf-8")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => JSON.parse(l) as OperadicBankRecord)
    : [];

  const ablation = await runDynamicAblation(repoRoot, devQs);

  const loomDemos = [
    {
      id: "LOOM-104",
      type: "dead-spend-bleed",
      question: "Which of my buildings is bleeding money on marketing right now, and why?",
      result_schema: {},
    },
    {
      id: "LOOM-101",
      type: "colloquial-ambiguity",
      question: "How many vacant units are at the South Loop building?",
      result_schema: {},
    },
    {
      id: "LOOM-105",
      type: "closed-loop-learner",
      question: "Evaluate our past budget decisions in decisions.csv and recommend next month budget moves.",
      result_schema: {},
    },
  ];

  const runs: Array<Record<string, unknown>> = [];

  for (const lq of loomDemos) {
    const turn = await askFlowIqCopilot(lq, { store });
    runs.push({
      suite: "loom",
      id: lq.id,
      type: lq.type,
      question: lq.question,
      leafQuestion: null,
      stratum: "Loom Executive Demo",
      expected: null,
      resultSchema: lq.result_schema,
      answer: turn.envelope.answer,
      result: turn.envelope.result,
      citations: turn.envelope.citations,
      toolCalls: turn.toolCalls,
      valid: turn.verification.valid,
      clarificationNeeded: turn.clarificationNeeded,
    });
  }

  for (const [suite, list] of [
    ["dev", devQs],
    ["test", testQs],
    ["bonus", bonusQs],
  ] as const) {
    for (const q of list) {
      const turn = await askFlowIqCopilot(q, { store });
      runs.push({
        suite,
        id: q.id,
        type: q.type,
        question: q.question,
        leafQuestion: null,
        stratum: suite.toUpperCase(),
        expected: q.expected ?? null,
        resultSchema: q.result_schema,
        answer: turn.envelope.answer,
        result: turn.envelope.result,
        citations: turn.envelope.citations,
        toolCalls: turn.toolCalls,
        valid: turn.verification.valid,
        clarificationNeeded: turn.clarificationNeeded,
      });
    }
  }

  for (const rt of UNSEEN_RED_TEAM_SUITE) {
    const turn = await askFlowIqCopilot(
      {
        id: rt.id,
        type: rt.category,
        question: rt.question,
        result_schema: rt.result_schema,
      },
      { store },
    );
    runs.push({
      suite: "redteam",
      id: rt.id,
      type: rt.category,
      question: rt.question,
      leafQuestion: null,
      stratum: "Unseen Red-Team",
      expected: rt.expected,
      resultSchema: rt.result_schema ?? {},
      answer: turn.envelope.answer,
      result: turn.envelope.result,
      citations: turn.envelope.citations,
      toolCalls: turn.toolCalls,
      valid: turn.verification.valid,
      clarificationNeeded: turn.clarificationNeeded,
    });
  }

  for (const oi of operadicRaw) {
    const turn = await askFlowIqCopilot(
      {
        id: oi.id,
        type: oi.stratum,
        question: oi.direct_question,
        result_schema: oi.result_schema,
        expected: oi.expected,
      },
      { store },
    );
    runs.push({
      suite: "operadic",
      id: oi.id,
      type: `${oi.stratum} · ${oi.editorial_color}`,
      question: oi.direct_question,
      leafQuestion: oi.leaf_question,
      stratum: oi.stratum,
      expected: oi.expected,
      resultSchema: oi.result_schema,
      answer: turn.envelope.answer,
      result: turn.envelope.result,
      citations: turn.envelope.citations,
      toolCalls: turn.toolCalls,
      valid: turn.verification.valid,
      clarificationNeeded: turn.clarificationNeeded,
    });
  }

  const units = queryUnitsAndOccupancy(store);
  const leases = queryLeasesAndRenewals(store);
  const marketing = queryMarketingSpendAndFunnel(store, {
    period: "APR_SEP_2026",
    paidOnly: false,
  });
  const learner = evaluateBudgetDecisionsAndLearn(store);
  const dataQuality = queryDataQualityAudit(store);
  const sheaf = evaluateSheafCoboundary(store, FLOW_PORTFOLIO_SHEAF_EDGES);
  const swarmTracePath = path.join(repoRoot, ".toq", "flow-copilot", "temporal-llm-swarm-trace.json");
  const swarmSim = fs.existsSync(swarmTracePath)
    ? JSON.parse(fs.readFileSync(swarmTracePath, "utf-8"))
    : null;
  const workflowSim = runDurableWorkflowSimulation({
    totalRows: 250_000,
    shardCount: 10,
    injectFaultAtShard: 6,
    store,
  });

  const citedRowLookup: Record<string, unknown> = {};
  for (const p of store.properties) citedRowLookup[p.citationId] = p;
  for (const u of store.units) citedRowLookup[u.citationId] = u;
  for (const l of store.leases) citedRowLookup[l.citationId] = l;
  for (const d of store.leads) citedRowLookup[d.citationId] = d;
  for (const s of store.spend) citedRowLookup[s.citationId] = s;
  for (const x of store.decisions) citedRowLookup[x.citationId] = x;

  const referencedCitations = new Set<string>();
  for (const r of runs) {
    for (const c of (r.citations as string[]) || []) {
      referencedCitations.add(c);
    }
  }
  for (const s of store.voidSpend) referencedCitations.add(s.citationId);
  for (const d of store.duplicateLeads) referencedCitations.add(d.citationId);
  for (const p of store.properties) referencedCitations.add(p.citationId);
  for (const x of store.decisions) referencedCitations.add(x.citationId);
  referencedCitations.add("leads:D01011");

  const compactRowIndex: Record<string, unknown> = {};
  for (const cid of referencedCitations) {
    if (citedRowLookup[cid]) compactRowIndex[cid] = citedRowLookup[cid];
  }

  const initialState = {
    ok: true,
    generatedAt: PORTFOLIO_TODAY,
    policy: store.policy,
    primaryKeyCount: store.primaryKeyIndex.size,
    unitsSummary: {
      portfolioTotalUnits: units.portfolioTotalUnits,
      portfolioOccupiedUnits: units.portfolioOccupiedUnits,
      portfolioNoticeUnits: units.portfolioNoticeUnits,
      portfolioVacantUnits: units.portfolioVacantUnits,
      portfolioOccupiedSharePercent: units.portfolioOccupiedSharePercent,
      portfolioVacancyRatePercent: units.portfolioVacancyRatePercent,
      byProperty: units.byProperty,
    },
    leasesSummary: {
      totalMatchingLeases: leases.totalMatchingLeases,
      renewalRatePercent: leases.renewalRatePercent,
      averageConcessionUsd: leases.averageConcessionUsd,
      noticeGivenCount: leases.noticeGivenCount,
    },
    marketingSummary: {
      totalSpendUsd: marketing.totalSpendUsd,
      totalSignedLeases: marketing.totalSignedLeases,
      bySource: marketing.bySource,
      deadSpendReallocation: marketing.deadSpendReallocation,
    },
    learnerSummary: {
      priorAlpha0: learner.priorAlpha0,
      priorBeta0Usd: learner.priorBeta0Usd,
      windowInvarianceVerified: learner.windowInvarianceVerified,
      evaluatedDecisions: learner.evaluatedDecisions,
      proposedNextDecisions: learner.proposedNextDecisions,
    },
    dataQuality,
    sheafSummary: {
      isGlobalSection: sheaf.isGlobalSection,
      blockingResidualCount: sheaf.blockingResidualCount,
      totalResidualCount: sheaf.totalResidualCount,
      edges: sheaf.edgeReports,
    },
    properties: store.properties,
    voidSpend: store.voidSpend,
    duplicateLeads: store.duplicateLeads,
    promptInjectionAttempts: store.promptInjectionAttempts,
    ablationRows: ablation.rows,
    easterEggs: {
      zipCommentRiddle:
        "fool's gold — a mineral that glitters like the real thing. One word, lowercase.",
      p09Base64AkaToken: "am9pbi5vcm11cy5zb2x1dGlvbnMvbmludGgtaG91c2U=",
      p09DecodedUrl: "join.ormus.solutions/ninth-house",
      words: DISCOVERED_EASTER_EGGS.eggsTuple,
    },
    modelProfiles: Object.values(MODEL_PROVIDER_PROFILES),
    workflowSim,
    swarmSim,
    runs,
    rowIndex: compactRowIndex,
  };

  const html = renderDashboardHtml(initialState);

  const publicDir = path.join(repoRoot, "public");
  const uiDir = path.join(repoRoot, "ui");
  fs.mkdirSync(publicDir, { recursive: true });
  fs.mkdirSync(uiDir, { recursive: true });

  const publicIndexPath = path.join(publicDir, "index.html");
  const uiStudioPath = path.join(uiDir, "flowiq-visual-studio.html");

  fs.writeFileSync(publicIndexPath, html, "utf-8");
  fs.writeFileSync(uiStudioPath, html, "utf-8");

  console.log(`Built Ormus Chrome Client Dashboard -> ${publicIndexPath} (${(html.length / 1024).toFixed(1)} KB)`);
  console.log(`Synced Visual Studio -> ${uiStudioPath}`);
}

function renderDashboardHtml(initialState: Record<string, unknown>): string {
  const safeJson = JSON.stringify(initialState).replace(/</g, "\\u003c");
  const tplPath = path.resolve(new URL("./dashboard-template.html", import.meta.url).pathname);
  const tpl = fs.readFileSync(tplPath, "utf-8");
  return tpl.replace("__INITIAL_STATE_JSON__", safeJson);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(new URL(import.meta.url).pathname);

if (isMain) {
  buildOrmusDashboard().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
