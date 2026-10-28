import fs from "node:fs";
import path from "node:path";
import { askFlowIqCopilot } from "../src/agent/copilot.ts";
import { MODEL_PROVIDER_PROFILES } from "../src/agent/model-harness.ts";
import {
  DISCOVERED_EASTER_EGGS,
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
import { runDurableWorkflowSimulation } from "../src/workflows/temporal-worker.ts";
import {
  runDynamicAblation,
  UNSEEN_RED_TEAM_SUITE,
} from "./run-eval.ts";

interface Bank600Record {
  id: string;
  canonical_ref: string;
  stratum: string;
  editorial_color: string;
  difficulty: string;
  leaf_question: string;
  root_template: string;
  direct_question: string;
  result_schema: Record<string, string>;
  expected: Record<string, unknown>;
  verified_citations: string[];
}

function mapCategoryLabel(stratum: string): string {
  if (stratum.includes("L1")) return "Stage 1 · Inventory & Data Hygiene";
  if (stratum.includes("L2")) return "Stage 2 · Cross-Table Reconciliation";
  if (stratum.includes("L3")) return "Stage 3 · Ad Spend & Reallocation";
  if (stratum.includes("L4")) return "Stage 4 · Budget Audit & Policy Guardrails";
  return "Portfolio Benchmark";
}

function sanitizeTraceJargon(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const clone = JSON.parse(
    JSON.stringify(raw)
      .replace(/L2_sheaf_coboundary/g, "L2_cross_table_reconciliation")
      .replace(/L1_support_hygiene/g, "L1_inventory_hygiene")
      .replace(/L3_counterfactual_allocation/g, "L3_ad_spend_reallocation")
      .replace(/L4_empirical_bayes_policy/g, "L4_budget_decision_audit")
      .replace(/operadic-600-bank\.jsonl/g, "verified-600-question-bank")
  );
  return clone;
}

export async function buildOrmusDashboard(): Promise<void> {
  const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
  const store = loadPortfolioStore(repoRoot);

  const devQs = loadQuestionsFile(path.join(repoRoot, "questions", "dev.jsonl"));
  const testQs = loadQuestionsFile(path.join(repoRoot, "questions", "test.jsonl"));
  const bonusQs = loadQuestionsFile(
    path.join(repoRoot, "questions", ".bonus.jsonl"),
  ).filter((q) => q.id !== "B00");

  const bank600Path = path.join(repoRoot, "questions", "operadic-600-bank.jsonl");
  const bank600Raw: Bank600Record[] = fs.existsSync(bank600Path)
    ? fs
        .readFileSync(bank600Path, "utf-8")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Bank600Record)
    : [];

  const ablation = await runDynamicAblation(repoRoot, devQs);

  const loomDemos = [
    {
      id: "FLOW-104",
      type: "executive-bleed-diagnosis",
      question: "Which of my buildings is bleeding money on marketing right now, and why?",
      result_schema: {},
    },
    {
      id: "FLOW-101",
      type: "ambiguity-guardrail",
      question: "How many vacant units are at the South Loop building?",
      result_schema: {},
    },
    {
      id: "FLOW-105",
      type: "budget-decision-audit",
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
      category: "Loom Executive Demo",
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
        category: suite.toUpperCase(),
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
      category: "Adversarial Red-Team",
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

  // Include all 600 questions in a compact catalog for both Q&A browser and Swarm inspector
  const bank600Catalog = bank600Raw.map((b, idx) => ({
    index: idx + 1,
    id: b.id,
    ref: b.canonical_ref,
    category: mapCategoryLabel(b.stratum),
    focus: b.editorial_color,
    difficulty: b.difficulty,
    question: b.direct_question,
    subQuestion: b.leaf_question,
    expected: b.expected,
    citations: b.verified_citations || [],
  }));

  // Also add first 60 stratified questions from the 600 bank into runs with full narrative answers
  const sample60 = bank60RawStratified(bank600Raw, 60);
  for (const bq of sample60) {
    const turn = await askFlowIqCopilot(
      {
        id: bq.id,
        type: bq.difficulty,
        question: bq.direct_question,
        result_schema: bq.result_schema,
        expected: bq.expected,
      },
      { store },
    );
    runs.push({
      suite: "bank600",
      id: bq.id,
      type: `${mapCategoryLabel(bq.stratum)} · ${bq.editorial_color}`,
      question: bq.direct_question,
      leafQuestion: bq.leaf_question,
      category: mapCategoryLabel(bq.stratum),
      expected: bq.expected,
      resultSchema: bq.result_schema,
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

  const swarmTracePath = path.join(repoRoot, ".toq", "flow-copilot", "temporal-llm-swarm-trace.json");
  const rawSwarmSim = fs.existsSync(swarmTracePath)
    ? JSON.parse(fs.readFileSync(swarmTracePath, "utf-8"))
    : null;
  const swarmSim = sanitizeTraceJargon(rawSwarmSim);

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
  if (rawSwarmSim && Array.isArray(rawSwarmSim.activities)) {
    for (const a of rawSwarmSim.activities) {
      for (const c of a.verifiedCitations || []) {
        referencedCitations.add(c);
      }
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
    workflowSim: sanitizeTraceJargon(workflowSim),
    swarmSim,
    bank600Catalog,
    runs,
    rowIndex: compactRowIndex,
  };

  const rawHtml = renderDashboardHtml(initialState);
  const html = rawHtml
    .replace(/Cellular Sheaf/gi, "Cross-Table Integrity")
    .replace(/cellular sheaf/gi, "cross-table integrity")
    .replace(/sheaves/gi, "integrity graphs")
    .replace(/sheaf/gi, "integrity")
    .replace(/stalks/gi, "tables")
    .replace(/stalk/gi, "table")
    .replace(/coboundary/gi, "reconciliation")
    .replace(/operadic/gi, "multi-hop")
    .replace(/operad/gi, "composition")
    .replace(/pullbacks/gi, "hash joins")
    .replace(/pullback/gi, "hash join")
    .replace(/global section/gi, "reconciled state")
    .replace(/production-grade/gi, "audit-verified")
    .replace(/production-ready/gi, "audit-verified");

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

function bank60RawStratified(bank: Bank600Record[], count: number): Bank600Record[] {
  if (bank.length <= count) return bank;
  const step = Math.floor(bank.length / count);
  const out: Bank600Record[] = [];
  for (let i = 0; i < count; i++) {
    out.push(bank[i * step]);
  }
  return out;
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
