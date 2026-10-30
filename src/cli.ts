#!/usr/bin/env node
/**
 * flowiq: the portfolio copilot on the command line.
 *
 * Conventions (after CLI Printing Press, adapted to a local engine):
 * every command has real help; --json is machine output and is never
 * wrapped; colour and the banner appear only on a terminal that wants
 * them; human output stays within 80 columns; exit codes are typed
 * (see src/cli/commands.ts); and `flowiq agent-context` describes all
 * of it as JSON for an agent. The look is Ormus Chrome: gold is the
 * only accent, labels read "/ NAME", status is a word, no emoji.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readlinePromises from "node:readline/promises";
import { askFlowIqCopilot } from "./agent/copilot.ts";
import {
  MODEL_PROVIDER_PROFILES,
  type ModelProviderId,
  discoverAvailableModelProfiles,
  fetchLiveModelsForProvider,
  resolveModelHarnessConfig,
  runModelHarnessTurn,
} from "./agent/model-harness.ts";
import { MCP_TOOL_NAMES } from "./mcp/catalog.ts";
import {
  DISCOVERED_EASTER_EGGS,
  type LeaseBucketField,
  type PortfolioPolicyConfig,
  resolvePolicyConfig,
} from "./config/rules.ts";
import { loadPortfolioStore, loadQuestionsFile } from "./data/loader.ts";
import type { PortfolioStore, QuestionRecord } from "./data/schema.ts";
import { evaluateBudgetDecisionsAndLearn } from "./domain/learner.ts";
import { queryDataQualityAudit, queryMarketingSpendAndFunnel } from "./domain/metrics.ts";
import {
  FLOW_PORTFOLIO_INTEGRITY_EDGES,
  evaluateCrossTableIntegrity,
  getIntegrityEdgeSummary,
} from "./domain/sheaf.ts";
import { fmtUsd } from "./domain/format.ts";
import { UsageError, type ParsedArgs, parseArgs, positiveNumber, stringFlag } from "./cli/args.ts";
import {
  COMMANDS,
  EXIT,
  EXIT_CODE_DOCS,
  GLOBAL_FLAGS,
  KIT_ID_RE,
  KIT_ID_SHAPE_RE,
  findCommand,
} from "./cli/commands.ts";
import { renderCommandHelp, renderMainHelp } from "./cli/help.ts";
import { type Style, createStyle } from "./cli/style.ts";
import { FLOWIQ_VERSION } from "./version.ts";
import { didYouMean } from "./util/suggest.ts";
import {
  loadQuestion600Bank,
  runParallelTemporalLlmSwarm,
} from "./workflows/temporal-llm-swarm.ts";
import { runDurablePortfolioWorkflow } from "./workflows/temporal-worker.ts";

const LIVE_URL = "https://repo-sigma-one-80.vercel.app";

/** What every command needs: the style, the repo, and the global switches. */
interface Ctx {
  readonly s: Style;
  readonly repoRoot: string;
  readonly json: boolean;
  readonly quiet: boolean;
}

function out(...lines: readonly string[]): void {
  for (const line of lines) process.stdout.write(`${line}\n`);
}

/** Exit with a code after stdout drains, so piped output is never cut. */
class ExitSignal extends Error {
  readonly code: number;
  constructor(code: number) {
    super(`exit ${code}`);
    this.code = code;
  }
}

class NotFoundError extends Error {}

function loadStore(ctx: Ctx, overrides?: Partial<PortfolioPolicyConfig>): PortfolioStore {
  try {
    return loadPortfolioStore(ctx.repoRoot, overrides);
  } catch (err) {
    process.stderr.write(
      `flowiq: could not load the CSV exports: ${err instanceof Error ? err.message : String(err)}\n` +
        "Check FLOW_DATA_DIR or run from the repository.\n",
    );
    throw new ExitSignal(EXIT.config);
  }
}

function loadSavedCliConfig(repoRoot: string): {
  provider: ModelProviderId;
  model: string;
  baseUrl: string;
} {
  const cfgPath = path.join(repoRoot, ".toq", "flow-copilot", "cli-harness-config.json");
  if (fs.existsSync(cfgPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as {
        provider?: ModelProviderId;
        model?: string;
        baseUrl?: string;
      };
      const provider =
        parsed.provider && parsed.provider in MODEL_PROVIDER_PROFILES
          ? parsed.provider
          : "deterministic";
      const profile = MODEL_PROVIDER_PROFILES[provider];
      return {
        provider,
        model: parsed.model ?? profile.defaultModel,
        baseUrl: parsed.baseUrl ?? profile.baseUrl,
      };
    } catch {
      // A broken config file falls back to the environment.
    }
  }
  const resolved = resolveModelHarnessConfig();
  return { provider: resolved.provider, model: resolved.model, baseUrl: resolved.baseUrl };
}

function normalizeProviderId(raw?: string): ModelProviderId | undefined {
  if (!raw) return undefined;
  const norm = raw.trim().toLowerCase().replace(/-/g, "_");
  if (norm === "grok" || norm === "xai") return "xai";
  if (norm === "claude" || norm === "anthropic") return "anthropic";
  if (norm === "local" || norm === "local_openai" || norm === "vllm" || norm === "flint") {
    return "local_openai";
  }
  if (norm in MODEL_PROVIDER_PROFILES) return norm as ModelProviderId;
  return undefined;
}

function buildMcpConfigObject(repoRoot: string): Record<string, unknown> {
  return {
    mcpServers: {
      "flowiq-portfolio-copilot": {
        command: "node",
        args: ["--no-warnings", path.join(repoRoot, "src/mcp/server.ts")],
        env: {
          FLOW_CAD_RATE: "0.73",
          FLOW_OCCUPIED_INCLUDES_NOTICE: "true",
          FLOW_LEASE_BUCKET_BY: "lease_start_date",
          FLOW_PRIOR_BETA0: "3250",
        },
      },
    },
  };
}

function mcpWired(repoRoot: string): boolean {
  return (
    fs.existsSync(path.join(repoRoot, ".mcp.json")) &&
    fs.existsSync(path.join(repoRoot, ".cursor", "mcp.json"))
  );
}

function allKitQuestions(repoRoot: string): QuestionRecord[] {
  return [
    ...loadQuestionsFile(path.join(repoRoot, "questions", "dev.jsonl")),
    ...loadQuestionsFile(path.join(repoRoot, "questions", "test.jsonl")),
    ...loadQuestionsFile(path.join(repoRoot, "questions", ".bonus.jsonl")).filter((q) => q.id !== "B00"),
  ];
}

type Turn = Awaited<ReturnType<typeof askFlowIqCopilot>>;
type Status = "answered" | "unknown" | "refused" | "needs_clarification";

function turnStatus(turn: Turn): Status {
  const result = turn.envelope.result as Record<string, unknown>;
  if (result.refused === true) return "refused";
  if (result.unknown === true) return "unknown";
  if (turn.clarificationNeeded || result.clarification_needed === true) return "needs_clarification";
  return "answered";
}

/** The one-line verdict: a word first, then what it means. */
function checkLine(turn: Turn): { text: string; failed: boolean } {
  if (!turn.verification.valid) {
    return { text: `FAIL. ${turn.verification.errors.join("; ")}`, failed: true };
  }
  const n = turn.envelope.citations.length;
  switch (turnStatus(turn)) {
    case "refused":
      return { text: "REFUSED. Nothing was computed.", failed: false };
    case "unknown":
      return { text: "NOT ANSWERED. The exports do not hold this.", failed: false };
    case "needs_clarification":
      return { text: "NEEDS CLARIFICATION. Say which building.", failed: false };
    default:
      return {
        text: `PASS. ${n} cited ${n === 1 ? "row exists" : "rows exist"} in the exports; this checks sources, not interpretation.`,
        failed: false,
      };
  }
}

interface HarnessMeta {
  readonly providerUsed: string;
  readonly modelUsed: string;
  readonly wireModeUsed: string;
  readonly latencyMs: number;
}

function renderTurn(
  ctx: Ctx,
  question: string,
  turn: Turn,
  opts: {
    verbose: boolean;
    kitId?: string;
    whatIf: Readonly<Record<string, unknown>>;
    harness?: HarnessMeta;
    asOf: string;
  },
): { lines: string[]; failed: boolean } {
  const { s } = ctx;
  const engine = opts.harness
    ? `${opts.harness.providerUsed} ${opts.harness.modelUsed} ${opts.harness.latencyMs}ms`
    : "deterministic engine";
  const head = [opts.kitId ? `kit ${opts.kitId}` : "", engine, `as of ${opts.asOf}`].filter(Boolean).join("  ");
  const lines = [`${s.label("FlowIQ ask")}  ${s.dim(head)}`, s.rule()];
  lines.push(...s.field("Question", question, s.strong));
  const changed = Object.entries(opts.whatIf);
  if (changed.length > 0) {
    const defaults = resolvePolicyConfig() as unknown as Record<string, unknown>;
    lines.push(
      ...s.field(
        "What-if",
        `${changed.map(([k, v]) => `${k} ${String(v)} (normally ${String(defaults[k])})`).join(", ")}; this answer only`,
        s.muted,
      ),
    );
  }
  const fallback =
    (turn as { llmFallbackReason?: string | null }).llmFallbackReason ??
    (turn as { fallbackReason?: string | null }).fallbackReason ??
    null;
  if (fallback) lines.push(...s.field("Fallback", fallback, s.muted));
  lines.push(...s.field("Answer", turn.envelope.answer, s.ink));
  lines.push(...s.field("Result", JSON.stringify(turn.envelope.result), s.gold));
  if (turn.envelope.citations.length > 0) {
    lines.push(...s.field("Sources", turn.envelope.citations.join(", "), s.muted));
  }
  const check = checkLine(turn);
  lines.push(...s.field("Check", check.text, check.failed ? s.danger : s.ink));
  if (opts.verbose) {
    lines.push(s.rule());
    for (const tc of turn.toolCalls) {
      lines.push(...s.field("Tool", `${tc.toolName} ${JSON.stringify(tc.args)}`, s.muted));
      lines.push(...s.field("", tc.outputSummary, s.dim));
    }
    const jsonl = {
      id: turn.envelope.id,
      answer: turn.envelope.answer,
      result: turn.envelope.result,
      citations: turn.envelope.citations,
    };
    lines.push(...s.field("JSONL", JSON.stringify(jsonl), s.muted));
    lines.push(...s.para("Wrapped for the terminal; use --json for a copy-safe line.", 12, s.dim));
  }
  lines.push(s.rule());
  return { lines, failed: check.failed };
}

async function runAsk(ctx: Ctx, args: ParsedArgs): Promise<number> {
  const f = args.flags;
  const cad = positiveNumber(f, "--cad-rate");
  const beta0 = positiveNumber(f, "--beta0");
  const bucket = stringFlag(f, "--bucket-by") as LeaseBucketField | undefined;
  const whatIf: Partial<PortfolioPolicyConfig> = {
    ...(cad !== undefined ? { cadToUsdRate: cad } : {}),
    ...(f.has("--exclude-notice") ? { occupiedIncludesNotice: false } : {}),
    ...(bucket ? { leaseBucketBy: bucket } : {}),
    ...(beta0 !== undefined ? { priorSpendUsdBeta0: beta0 } : {}),
  };
  const rawInput = args.positionals.join(" ").trim();
  if (!rawInput) throw new UsageError('ask needs a question: flowiq ask "<question>" | <ID>', "ask");

  if (KIT_ID_SHAPE_RE.test(rawInput) && !KIT_ID_RE.test(rawInput)) {
    throw new NotFoundError(
      `no kit item ${rawInput.toUpperCase()} (kit items: D01..D10, T01..T13, B01..B03, EGGS)`,
    );
  }
  const store = loadStore(ctx, whatIf);
  if (/^eggs$/i.test(rawInput)) {
    return renderEggs(ctx);
  }
  const kitId = KIT_ID_RE.test(rawInput) ? rawInput.toUpperCase() : undefined;
  const kitRecord = kitId ? allKitQuestions(ctx.repoRoot).find((q) => q.id === kitId) : undefined;
  if (kitId && !kitRecord) throw new NotFoundError(`no kit item ${kitId}`);
  const question = kitRecord ? kitRecord.question : rawInput;

  const providerFlag = normalizeProviderId(stringFlag(f, "--provider"));
  let turn: Turn;
  let harness: HarnessMeta | undefined;
  if (providerFlag || f.has("--llm")) {
    const saved = loadSavedCliConfig(ctx.repoRoot);
    const model = stringFlag(f, "--model");
    const baseUrl = stringFlag(f, "--base-url");
    const harnessCfg = resolveModelHarnessConfig({
      provider: providerFlag ?? (saved.provider !== "deterministic" ? saved.provider : "xai"),
      ...(model ? { model } : !providerFlag && saved.model ? { model: saved.model } : {}),
      ...(baseUrl ? { baseUrl } : {}),
    });
    const llmTurn = await runModelHarnessTurn(question, { store, harness: harnessCfg });
    turn = llmTurn as unknown as Turn;
    harness = {
      providerUsed: llmTurn.providerUsed,
      modelUsed: llmTurn.modelUsed,
      wireModeUsed: llmTurn.wireModeUsed,
      latencyMs: llmTurn.latencyMs,
    };
  } else {
    turn = await askFlowIqCopilot(kitRecord ?? question, { store });
  }

  if (ctx.json) {
    out(JSON.stringify(turn.envelope));
    return turn.verification.valid ? EXIT.ok : EXIT.failed;
  }
  if (ctx.quiet) {
    out(turn.envelope.answer);
    return turn.verification.valid ? EXIT.ok : EXIT.failed;
  }
  const view = renderTurn(ctx, question, turn, {
    verbose: f.has("--verbose"),
    kitId,
    whatIf,
    harness,
    asOf: store.policy.asOfDate,
  });
  out(...view.lines);
  return view.failed ? EXIT.failed : EXIT.ok;
}

function renderEggs(ctx: Ctx): number {
  const { s } = ctx;
  const words = DISCOVERED_EASTER_EGGS.eggsTuple;
  if (ctx.json) {
    out(JSON.stringify({ id: "EGGS", words }));
    return EXIT.ok;
  }
  out(
    `${s.label("FlowIQ kit")}  ${s.dim("EGGS  bonus cipher")}`,
    s.rule(),
    ...s.field("Result", JSON.stringify({ id: "EGGS", words }), s.gold),
    ...s.field("Sources", 'archive comment ("pyrite"); properties:P09 aka, base64 -> join.ormus.solutions/ninth-house ("athanor")', s.muted),
    s.rule(),
  );
  return EXIT.ok;
}

/** Occupied share across operating units: (occupied + notice) / total. */
function occupiedShare(store: PortfolioStore): number {
  const units = store.units.filter((u) => store.operatingProperties.some((p) => p.propertyId === u.propertyId));
  if (units.length === 0) return 0;
  const occ = units.filter((u) => u.status === "occupied" || u.status === "notice").length;
  return occ / units.length;
}

function doctorReport(store: PortfolioStore) {
  const dq = queryDataQualityAudit(store);
  const integrity = evaluateCrossTableIntegrity(store, FLOW_PORTFOLIO_INTEGRITY_EDGES);
  const mkt = queryMarketingSpendAndFunnel(store, { period: "APR_SEP_2026", paidOnly: true });
  const learner = evaluateBudgetDecisionsAndLearn(store);
  const realloc = mkt.deadSpendReallocation;
  const operatingUnits = store.operatingProperties.reduce((n, p) => n + p.actualUnitCount, 0);
  const edges = FLOW_PORTFOLIO_INTEGRITY_EDGES.map((edge) => {
    const summary = getIntegrityEdgeSummary(edge);
    return {
      id: summary.displayId,
      tables: summary.tablePair,
      anomalies: (integrity.byEdge[edge.edgeId] ?? []).length,
      blocking: edge.blocking,
    };
  });
  return {
    schema_version: 1,
    dataStore: {
      rowsIndexed: store.primaryKeyIndex.size,
      asOfDate: store.policy.asOfDate,
      operating: {
        buildings: store.operatingProperties.map((p) => p.propertyId),
        units: operatingUnits,
        occupiedShare: Math.round(occupiedShare(store) * 1000) / 10,
      },
      onboardingHold: store.onboardingProperties.map((p) => ({ id: p.propertyId, name: p.name, units: p.actualUnitCount })),
      leases: { total: store.leases.length, attributed: store.signedLeases.length },
      leads: { total: store.leads.length, deduplicated: store.deduplicatedLeads.length },
      spend: { invoices: store.spend.length, posted: store.postedSpend.length },
    },
    integrity: { reconciled: integrity.isGlobalSection, edges },
    traps: {
      nonOperating: store.onboardingProperties.map((p) => `properties:${p.propertyId}`),
      promptInjection: dq.promptInjectionAttempts.map((p) => `leads:${p.leadId}`),
      voidInvoices: { rows: dq.voidSpendRowCount, usdEquivalent: dq.voidSpendUsdTotal },
      cadInvoices: { rows: dq.cadSpendRowCount, posted: dq.postedCadSpendRowCount, rate: store.policy.cadToUsdRate },
      duplicateLeads: { rows: dq.duplicateLeadCount },
      deadSpend: {
        usd: realloc.totalDeadSpendUsd,
        pairs: realloc.deadPairs.length,
        bestSource: realloc.bestPortfolioPaidSource,
        additionalLeases: realloc.projectedAdditionalWholeLeases,
      },
      smallSampleGuard: { windowInvariance: learner.windowInvarianceVerified },
    },
  };
}

async function runDoctor(ctx: Ctx): Promise<number> {
  const { s } = ctx;
  const store = loadStore(ctx);
  const report = doctorReport(store);
  const profiles = await discoverAvailableModelProfiles();
  const harness = profiles.map((p) => ({
    provider: p.profile.provider === "local_openai" ? "local" : p.profile.provider,
    state: p.reachable ? "ready" : p.configured ? "key set" : "not configured",
    detail: p.statusDetail,
  }));
  const blocking = report.integrity.edges.some((e) => e.blocking && e.anomalies > 0);
  const code = blocking ? EXIT.failed : EXIT.ok;
  if (ctx.json) {
    out(JSON.stringify({ ...report, harness, ok: !blocking }));
    return code;
  }
  const d = report.dataStore;
  const t = report.traps;
  const lines: string[] = [];
  if (s.tty && !ctx.quiet) lines.push(...s.banner(FLOWIQ_VERSION));
  lines.push(`${s.label("Doctor")}  ${s.dim(`as of ${d.asOfDate}`)}`);
  lines.push("", s.label("Data store"));
  lines.push(...s.row("rows indexed", `${d.rowsIndexed.toLocaleString("en-US")} primary keys across 6 CSV exports`));
  lines.push(...s.row("operating", `${d.operating.buildings.length} buildings, ${d.operating.buildings[0]}..${d.operating.buildings[d.operating.buildings.length - 1]}, ${d.operating.units.toLocaleString("en-US")} units, ${d.operating.occupiedShare}% occupied`));
  for (const h of d.onboardingHold) {
    lines.push(...s.row("onboarding hold", `${h.id} ${h.name}, ${h.units} units; left out of every number`));
  }
  lines.push(...s.row("leases", `${d.leases.total.toLocaleString("en-US")} (${d.leases.attributed} attributed to a lead)`));
  lines.push(...s.row("leads", `${d.leads.total.toLocaleString("en-US")} (${d.leads.deduplicated.toLocaleString("en-US")} after dedup)`));
  lines.push(...s.row("spend", `${d.spend.invoices} invoices (${d.spend.posted} posted)`));

  lines.push("", `${s.label("Cross-table checks")}  ${s.dim(report.integrity.reconciled ? "reconciled" : "NOT RECONCILED")}`);
  for (const e of report.integrity.edges) {
    const id = e.id.replace(/^(E\d)_.*$/, "$1");
    const word = e.anomalies === 0 ? "clean" : `${e.anomalies} ${e.anomalies === 1 ? "anomaly" : "anomalies"}`;
    const paint = e.blocking && e.anomalies > 0 ? s.danger : s.ink;
    lines.push(...s.row(`${id} ${e.tables}`, `${word}${e.blocking ? ", blocking" : ""}`, 26, paint));
  }

  lines.push("", s.label("Data traps handled"));
  lines.push(...s.row("non-operating", `${t.nonOperating.join(", ")} held out (0 units)`));
  lines.push(...s.row("prompt injection", `${t.promptInjection.join(", ")} note quarantined; never changes a number`));
  lines.push(...s.row("void invoices", `${t.voidInvoices.rows} rows counted at $0.00 (${fmtUsd(t.voidInvoices.usdEquivalent)} USD on paper)`));
  lines.push(...s.row("CAD invoices", `${t.cadInvoices.rows} rows (${t.cadInvoices.posted} posted) at 1 CAD = ${t.cadInvoices.rate} USD`));
  lines.push(...s.row("duplicate leads", `${t.duplicateLeads.rows} rows credited to the earliest lead`));
  lines.push(...s.row("dead spend", `${fmtUsd(t.deadSpend.usd)} across ${t.deadSpend.pairs} pairs; +${t.deadSpend.additionalLeases} leases on ${t.deadSpend.bestSource}`));
  lines.push(...s.row("small samples", `shrunk toward the portfolio prior; window invariance ${t.smallSampleGuard.windowInvariance ? "holds" : "FAILS"}`));

  lines.push("", `${s.label("Model harness")}  ${s.dim("probes /v1/models")}`);
  for (const h of harness) {
    const detail = h.detail
      .replace(/ in \/setup/g, " via flowiq setup")
      .replace(/ or configure via flowiq setup/, "")
      .replace(/^Not configured \((.*)\)$/, "$1")
      .replace(/^set /, "Set ");
    lines.push(...s.row(h.provider, `${h.state.toUpperCase()}. ${detail}`, 16, h.state === "ready" ? s.ink : s.muted));
  }

  lines.push("", `${s.label("Not run by doctor")}`);
  lines.push(...s.row("npm run eval", "kit, probes, red team, consistency, Fair Housing", 26, s.muted));
  lines.push(...s.row("npm run eval:cleanroom", "Python verifier with no dependency on src/", 26, s.muted));
  lines.push(...s.row("npm run bank:600", `drift check over ${loadQuestion600Bank().length} stored questions`, 26, s.muted));
  lines.push(...s.row("npm run mcp:smoke", "MCP checks over stdio", 26, s.muted));
  lines.push(s.rule());
  out(...lines);
  return code;
}

function runStatus(ctx: Ctx): number {
  const { s } = ctx;
  const store = loadStore(ctx);
  const cfg = loadSavedCliConfig(ctx.repoRoot);
  const units = store.operatingProperties.reduce((n, p) => n + p.actualUnitCount, 0);
  const status = {
    schema_version: 1,
    version: FLOWIQ_VERSION,
    data: {
      buildings: store.operatingProperties.length,
      units,
      onHold: store.onboardingProperties.map((p) => p.propertyId),
      rowsIndexed: store.primaryKeyIndex.size,
      asOfDate: store.policy.asOfDate,
    },
    policy: {
      cadToUsdRate: store.policy.cadToUsdRate,
      occupiedIncludesNotice: store.policy.occupiedIncludesNotice,
      leaseBucketBy: store.policy.leaseBucketBy,
      priorSpendUsdBeta0: store.policy.priorSpendUsdBeta0,
    },
    harness: { provider: cfg.provider, model: cfg.model },
    mcp: { wired: mcpWired(ctx.repoRoot), http: `${LIVE_URL}/api/mcp` },
  };
  if (ctx.json) {
    out(JSON.stringify(status));
    return EXIT.ok;
  }
  out(
    `${s.label("Status")}  ${s.dim(`v${FLOWIQ_VERSION}`)}`,
    s.rule(),
    ...s.row("data", `${status.data.buildings} buildings, ${units.toLocaleString("en-US")} units, ${status.data.rowsIndexed.toLocaleString("en-US")} rows, as of ${status.data.asOfDate}`),
    ...s.row("on hold", status.data.onHold.join(", ") || "none"),
    ...s.row("policy", `CAD ${status.policy.cadToUsdRate}, notice ${status.policy.occupiedIncludesNotice ? "counted" : "not counted"} as occupied, bucket ${status.policy.leaseBucketBy}, beta0 ${status.policy.priorSpendUsdBeta0}`),
    ...s.row("harness", `${cfg.provider} (${cfg.model})`),
    ...s.row("MCP", status.mcp.wired ? "wired in .mcp.json and .cursor/mcp.json" : "not wired here; run flowiq setup --write-mcp"),
    ...s.row("MCP over HTTP", status.mcp.http),
    s.rule(),
  );
  return EXIT.ok;
}

function expectedMatches(q: QuestionRecord, result: unknown): boolean | null {
  if (!q.expected) return null;
  const got = result as Record<string, unknown>;
  return Object.entries(q.expected).every(([k, v]) => JSON.stringify(got[k]) === JSON.stringify(v));
}

async function runValidate(ctx: Ctx, args: ParsedArgs): Promise<number> {
  const { s } = ctx;
  const filter = args.positionals[0]?.toUpperCase();
  if (filter === "EGGS") return renderEggs(ctx);
  const store = loadStore(ctx);
  const all = allKitQuestions(ctx.repoRoot);
  const items = filter ? all.filter((q) => q.id.toUpperCase() === filter) : all;
  if (filter && items.length === 0) {
    throw new NotFoundError(`no kit item ${filter}${didYouMean(filter, all.map((q) => q.id))}`);
  }
  const rows = [];
  for (const q of items) {
    const turn = await askFlowIqCopilot(q, { store });
    rows.push({
      id: q.id,
      type: q.type,
      question: q.question,
      valid: turn.verification.valid,
      expectedMatch: expectedMatches(q, turn.envelope.result),
      result: turn.envelope.result,
      citations: turn.envelope.citations,
      answer: turn.envelope.answer,
      errors: turn.verification.errors,
    });
  }
  const failed = rows.filter((r) => !r.valid || r.expectedMatch === false);
  const withExpected = rows.filter((r) => r.expectedMatch !== null);
  const code = failed.length > 0 ? EXIT.failed : EXIT.ok;
  if (ctx.json) {
    out(JSON.stringify({
      schema_version: 1,
      items: rows.map(({ answer: _a, question: _q, ...r }) => r),
      summary: {
        total: rows.length,
        valid: rows.filter((r) => r.valid).length,
        expectedTotal: withExpected.length,
        expectedMatched: withExpected.filter((r) => r.expectedMatch).length,
      },
    }));
    return code;
  }
  const lines = [`${s.label("Validate")}  ${s.dim(`${rows.length} kit ${rows.length === 1 ? "item" : "items"}`)}`, s.rule()];
  for (const r of rows) {
    const verdict = !r.valid ? "FAIL" : r.expectedMatch === false ? "MISMATCH" : r.expectedMatch ? "MATCH" : "PASS";
    const paint = verdict === "FAIL" || verdict === "MISMATCH" ? s.danger : s.ink;
    lines.push(`${s.strong(r.id.padEnd(5))}${paint(verdict.padEnd(9))}${s.dim(r.type)}`);
    if (rows.length === 1) {
      lines.push(...s.field("Question", r.question, s.ink));
      lines.push(...s.field("Answer", r.answer, s.ink));
    }
    lines.push(...s.field("Result", JSON.stringify(r.result), s.gold));
    lines.push(...s.field("Sources", r.citations.join(", ") || "none", s.muted));
    if (r.errors.length > 0) lines.push(...s.field("Errors", r.errors.join("; "), s.danger));
  }
  lines.push(s.rule());
  lines.push(...s.para(
    `${rows.filter((r) => r.valid).length}/${rows.length} passed schema and citation checks; ${withExpected.filter((r) => r.expectedMatch).length}/${withExpected.length} matched the kit's published expected values (test items have none).`,
    0,
    failed.length > 0 ? s.danger : s.ink,
  ));
  out(...lines);
  return code;
}

async function runAnswers(ctx: Ctx): Promise<number> {
  const { s } = ctx;
  const { generateAnswersJsonl } = await import("../scripts/generate-answers.ts");
  const lines = await generateAnswersJsonl();
  const outPath = path.join(ctx.repoRoot, "answers.jsonl");
  fs.writeFileSync(outPath, `${lines.join("\n")}\n`, "utf-8");
  if (ctx.json) {
    out(JSON.stringify({ schema_version: 1, path: outPath, lines: lines.length }));
    return EXIT.ok;
  }
  const view = [`${s.label("Answers")}  ${s.dim(`${lines.length} lines written to answers.jsonl`)}`, s.rule()];
  for (const raw of lines) {
    const parsed = JSON.parse(raw) as { id: string; answer?: string; result?: unknown; words?: string[] };
    view.push(...s.field(parsed.id, JSON.stringify(parsed.result ?? { words: parsed.words }), s.gold, 8));
  }
  view.push(s.rule(), ...s.para(`Full lines with answers and citations: ${outPath}`, 0, s.dim));
  out(...view);
  return EXIT.ok;
}

function agentContext(repoRoot: string): Record<string, unknown> {
  const mcpTools = [...MCP_TOOL_NAMES];
  return {
    schema_version: 1,
    name: "flowiq",
    version: FLOWIQ_VERSION,
    description:
      "Deterministic answers about one apartment portfolio from six CSV exports, with a source row for every number. Read-only; no network unless --llm.",
    output: {
      json: "--json prints one JSON document on stdout and is never wrapped",
      human: "at most 80 columns; colour and banner only on a terminal",
      color: "off with --no-color, NO_COLOR (non-empty), TERM=dumb, or a pipe; FORCE_COLOR forces it on",
      errors: "usage errors go to stderr with the fix and exit 2",
    },
    ask: {
      envelope: "ask --json prints {id, answer, result, citations}",
      statuses: {
        answered: "result holds the value; citations are table:primary_key",
        unknown: "result.unknown is true; the exports do not hold this",
        refused: "result.refused is true; a Fair Housing refusal",
        needs_clarification: "result.clarification_needed is true; name the building",
      },
      kit_ids: "D01..D10, T01..T13, B01..B03, EGGS",
    },
    commands: COMMANDS.map((c) => ({
      name: c.name,
      aliases: c.aliases ?? [],
      summary: c.summary,
      usage: c.usage,
      description: c.description,
      json: c.json === true,
      hidden: c.hidden === true,
      flags: (c.flags ?? []).map((f) => ({
        name: f.name,
        ...(f.value ? { value: f.value } : { boolean: true }),
        ...(f.enum ? { enum: f.enum } : {}),
        summary: f.summary,
      })),
      examples: c.examples ?? [],
    })),
    global_flags: GLOBAL_FLAGS.map((f) => ({ name: f.name, ...(f.alias ? { alias: f.alias } : {}), summary: f.summary })),
    exit_codes: EXIT_CODE_DOCS,
    env: {
      NO_COLOR: "disable colour",
      FORCE_COLOR: "force colour",
      FLOW_DATA_DIR: "directory holding the six CSV exports",
      FLOW_CAD_RATE: "default USD per CAD (0.73)",
      XAI_API_KEY: "only for --llm with provider xai",
    },
    mcp: {
      tools: mcpTools,
      stdio: { command: "node", args: ["--no-warnings", path.join(repoRoot, "src/mcp/server.ts")] },
      http: { url: `${LIVE_URL}/api/mcp`, auth: "none", readOnly: true },
    },
  };
}

function openInBrowser(target: string): boolean {
  try {
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
    const cmdArgs = process.platform === "win32" ? ["/c", "start", "", target] : [target];
    const child = spawn(cmd, cmdArgs, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function runUi(ctx: Ctx, open: boolean): number {
  const { s } = ctx;
  const dashboard = path.join(ctx.repoRoot, "public", "index.html");
  const notebook = path.join(ctx.repoRoot, "public", "field-notebook.html");
  out(
    s.label("Dashboards"),
    s.rule(),
    ...s.row("dashboard", path.relative(ctx.repoRoot, dashboard), 14),
    ...s.row("notebook", path.relative(ctx.repoRoot, notebook), 14),
    ...s.row("live", LIVE_URL, 14),
    ...s.row("live notebook", `${LIVE_URL}/field-notebook.html`, 14),
  );
  if (open && openInBrowser(dashboard) && openInBrowser(notebook)) {
    out(...s.para("Opened the dashboard and the field notebook in your browser.", 0, s.muted));
  }
  return EXIT.ok;
}

async function runSwarm(ctx: Ctx): Promise<number> {
  const { s } = ctx;
  const res = await runParallelTemporalLlmSwarm({
    repoRoot: ctx.repoRoot,
    sampleSize: 40,
    concurrency: 8,
    simulateCrash: true,
    crashAtCompletedCount: 18,
    enableLiveNetworkCalls: false,
    includeGrokCliProbe: false,
  });
  out(
    `${s.label("Swarm")}  ${s.dim("40 of 600 stored questions, 8 simulated workers")}`,
    s.rule(),
    ...s.row("run", `${res.workflowId} / ${res.runId}`),
    ...s.row("crash and replay", `crash at activity ${res.crashInjectedAtActivity} with ${res.inFlightWhenCrashedCount} in flight; replayed in ${res.replayHistoryDurationMs.toFixed(2)}ms; ${res.skippedByIdempotencyKeyCount} skipped by key; ${res.duplicateLlmInvocationsCount} duplicate calls`),
    ...s.row("swarm", `${res.passedActivitiesCount}/${res.sampleSize} passed (${res.accuracyPercent}%)`),
    ...s.row("600 bank", `${res.fullBank600Summary.passedQuestions}/${res.fullBank600Summary.totalQuestions} match this engine's stored outputs`),
  );
  for (const act of res.activities.slice(0, 8)) {
    out(...s.row(`#${String(act.activityIndex).padStart(2, "0")} ${act.workerSlotId}`, `${act.replayedFromHistory ? "REPLAYED" : "EXECUTED"}  ${act.questionId}  ${act.question}`, 18, s.muted));
  }
  out(s.rule());
  return EXIT.ok;
}

function runWorkflow(ctx: Ctx): number {
  const { s } = ctx;
  const store = loadStore(ctx);
  const res = runDurablePortfolioWorkflow({ store });
  out(
    `${s.label("Workflow")}  ${s.dim("durable workflow simulation")}`,
    s.rule(),
    ...s.row("run", `${res.workflowId} / ${res.runId}`),
    ...s.row("rows", `${res.totalRowsProcessed.toLocaleString("en-US")} across ${res.shardCount} shards`),
    ...s.row("fault", `shard ${res.faultInjectedShard} crashed at row ${res.faultCrashRow.toLocaleString("en-US")}`),
    ...s.row("replay", `shards 1..${res.replayedShardsCount} replayed from history; shard ${res.faultInjectedShard} resumed at row ${res.heartbeatResumeRow.toLocaleString("en-US")}`),
    ...s.row("digest", `${res.stateDigestSha256.slice(0, 24)}... replay match ${res.replayDigestMatch ? "yes" : "NO"}`),
    s.rule(),
  );
  return EXIT.ok;
}

const REPL_COMMANDS: ReadonlyArray<readonly [string, string]> = [
  ["<question>", "ask anything, or a kit ID such as T13"],
  ["/doctor", "data, traps and model harness health"],
  ["/status", "one-screen summary"],
  ["/validate [ID]", "kit items against expected answers"],
  ["/answers", "regenerate answers.jsonl"],
  ["/buildings", "the nine buildings"],
  ["/decisions", "past budget decisions and how they did"],
  ["/policy", "change CAD, notice, bucket or beta0 for this session"],
  ["/harness", "model providers"],
  ["/setup", "model provider and MCP config"],
  ["/ui", "open the dashboard and field notebook"],
  ["/stress  /swarm  /workflow", "demo suites"],
  ["/help  /quit", ""],
];

function replDeck(s: Style): string[] {
  return [s.label("Commands"), ...REPL_COMMANDS.flatMap(([k, v]) => s.row(k, v, 28, s.muted))];
}

async function runRepl(ctx: Ctx): Promise<number> {
  const { s } = ctx;
  const interactive = process.stdin.isTTY === true;
  let store = loadStore(ctx);
  const replCtx: Ctx = { ...ctx, json: false, quiet: false };
  if (interactive) {
    out(...s.banner(FLOWIQ_VERSION), ...replDeck(s), "");
  }
  const rl = readlinePromises.createInterface({ input: process.stdin, output: process.stdout, terminal: interactive });

  const askLine = async (q: string, overrides: Partial<PortfolioPolicyConfig>): Promise<void> => {
    const policyFlags = [
      ...(overrides.cadToUsdRate !== undefined ? ["--cad-rate", String(overrides.cadToUsdRate)] : []),
      ...(overrides.occupiedIncludesNotice === false ? ["--exclude-notice"] : []),
      ...(overrides.leaseBucketBy ? ["--bucket-by", overrides.leaseBucketBy] : []),
      ...(overrides.priorSpendUsdBeta0 !== undefined ? ["--beta0", String(overrides.priorSpendUsdBeta0)] : []),
    ];
    const args = parseArgs(["ask", ...policyFlags, "--", q]);
    try {
      await runAsk(replCtx, args);
    } catch (err) {
      if (err instanceof UsageError || err instanceof NotFoundError) out(s.danger(err.message));
      else throw err;
    }
  };

  const policy: { -readonly [K in keyof PortfolioPolicyConfig]?: PortfolioPolicyConfig[K] } = {};
  const handle = async (raw: string): Promise<boolean> => {
    const line = raw.trim();
    if (!line) return true;
    const [head, ...restWords] = line.split(/\s+/);
    const cmd = head.toLowerCase().replace(/^\//, "");
    const slash = head.startsWith("/");
    if (["quit", "exit", "q", "0"].includes(cmd) && (slash || restWords.length === 0)) return false;
    if (slash || restWords.length === 0) {
      switch (cmd) {
        case "help":
        case "?":
          out(...replDeck(s));
          return true;
        case "doctor":
          await runDoctor(replCtx);
          return true;
        case "status":
          runStatus(replCtx);
          return true;
        case "validate":
          await runValidate(replCtx, parseArgs(["validate", ...restWords])).catch((err) => {
            if (err instanceof NotFoundError) out(s.danger(err.message));
            else throw err;
          });
          return true;
        case "answers":
          await runAnswers(replCtx);
          return true;
        case "buildings":
          out(s.label("Buildings"));
          for (const p of store.properties) {
            out(...s.row(`${p.propertyId} ${p.name}`, `${p.isOperating ? "Operating" : "On hold"}, class ${p.buildingClass}, ${p.pms}, ${p.actualUnitCount} of ${p.declaredUnits} units`, 26, p.isOperating ? s.ink : s.muted));
          }
          return true;
        case "decisions": {
          out(s.label("Decisions"));
          for (const d of evaluateBudgetDecisionsAndLearn(store).evaluatedDecisions) {
            out(...s.row(`${d.decisionId} ${d.propertyId}`, `${d.source} ${d.decisionMonth}: ${d.recommendation} ${fmtUsd(d.deltaUsd)}, accepted ${d.accepted}, posterior ${fmtUsd(d.postOutcomeShrunkCpslUsd)}; ${d.verdict}`, 14, s.ink));
          }
          return true;
        }
        case "harness":
          for (const p of await discoverAvailableModelProfiles()) {
            out(...s.row(p.profile.provider, p.statusDetail, 16, s.muted));
          }
          return true;
        case "policy": {
          if (!interactive) {
            out(s.muted("/policy needs a terminal; use ask flags such as --cad-rate instead."));
            return true;
          }
          out(s.label("Policy"), ...s.para(JSON.stringify(store.policy), 2, s.muted));
          const cad = (await rl.question(s.muted(`  CAD to USD [${store.policy.cadToUsdRate}]: `))).trim();
          const notice = (await rl.question(s.muted(`  Notice counts as occupied, true/false [${store.policy.occupiedIncludesNotice}]: `))).trim();
          const bucket = (await rl.question(s.muted(`  Bucket by lease_start_date/lead_created_date [${store.policy.leaseBucketBy}]: `))).trim();
          const beta0 = (await rl.question(s.muted(`  Prior beta0 USD [${store.policy.priorSpendUsdBeta0}]: `))).trim();
          const n = (v: string): number | undefined => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : undefined);
          if (n(cad) !== undefined) policy.cadToUsdRate = n(cad);
          if (notice === "true" || notice === "false") policy.occupiedIncludesNotice = notice === "true";
          if (bucket === "lease_start_date" || bucket === "lead_created_date") policy.leaseBucketBy = bucket;
          if (n(beta0) !== undefined) policy.priorSpendUsdBeta0 = n(beta0);
          store = loadStore(ctx, policy);
          out(...s.para(`Policy for this session: ${JSON.stringify(policy)}`, 2, s.ink));
          return true;
        }
        case "setup":
          if (!interactive) {
            out(s.muted("/setup needs a terminal; run flowiq setup --provider P instead."));
            return true;
          }
          rl.pause();
          await runLegacySetup(ctx, []);
          rl.resume();
          return true;
        case "ui":
          runUi(replCtx, true);
          return true;
        case "stress":
        case "10x": {
          const { runParaphraseAnd10xSuite } = await import("../scripts/test-paraphrase-and-ambiguity-invariance.ts");
          await runParaphraseAnd10xSuite();
          return true;
        }
        case "swarm":
          await runSwarm(replCtx);
          return true;
        case "workflow":
          runWorkflow(replCtx);
          return true;
        default:
          if (slash) {
            out(s.muted(`Unknown command ${head}${didYouMean(head, REPL_COMMANDS.map(([k]) => k.split(" ")[0]))}. Type /help.`));
            return true;
          }
      }
    }
    await askLine(line, policy);
    return true;
  };

  try {
    if (interactive) {
      while (true) {
        let line: string;
        try {
          line = await rl.question(s.gold("flowiq> "));
        } catch (err) {
          if (isAbort(err)) break;
          throw err;
        }
        if (!(await handle(line))) break;
      }
    } else {
      for await (const line of rl) {
        if (!(await handle(line))) break;
      }
    }
  } finally {
    rl.close();
  }
  return EXIT.ok;
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || (err as { code?: string }).code === "ABORT_ERR");
}

/** The setup wizard lives in src/cli/setup.ts, unchanged in behaviour. */
async function runLegacySetup(ctx: Ctx, argv: readonly string[]): Promise<number> {
  const { runSetupCommand } = await import("./cli/setup.ts");
  try {
    await runSetupCommand(ctx.repoRoot, argv);
  } catch (err) {
    if (isAbort(err)) {
      process.stderr.write("\nSetup cancelled.\n");
      return EXIT.cancelled;
    }
    throw err;
  }
  return EXIT.ok;
}

async function dispatch(ctx: Ctx, args: ParsedArgs, argv: readonly string[]): Promise<number> {
  const c = args.command;
  if (!c) {
    return runRepl(ctx);
  }
  switch (c.name) {
    case "help": {
      const topic = args.positionals[0];
      if (!topic) {
        out(...renderMainHelp(ctx.s, { banner: ctx.s.tty && !ctx.quiet }));
        return EXIT.ok;
      }
      const spec = findCommand(topic);
      if (!spec) {
        throw new UsageError(`no help for "${topic}"${didYouMean(topic, COMMANDS.map((x) => x.name))}`);
      }
      out(...renderCommandHelp(ctx.s, spec));
      return EXIT.ok;
    }
    case "version":
      out(ctx.json ? JSON.stringify({ name: "flowiq", version: FLOWIQ_VERSION }) : `flowiq ${FLOWIQ_VERSION}`);
      return EXIT.ok;
    case "ask":
      return runAsk(ctx, args);
    case "repl":
      return runRepl(ctx);
    case "doctor":
      return runDoctor(ctx);
    case "status":
      return runStatus(ctx);
    case "validate":
      return runValidate(ctx, args);
    case "answers":
      return runAnswers(ctx);
    case "agent-context":
      out(JSON.stringify(agentContext(ctx.repoRoot), null, 2));
      return EXIT.ok;
    case "mcp-config":
      out(JSON.stringify(buildMcpConfigObject(ctx.repoRoot), null, 2));
      return EXIT.ok;
    case "setup": {
      const hasFlags = args.flags.has("--provider") || args.flags.has("--non-interactive");
      if (!hasFlags && !process.stdin.isTTY) {
        throw new UsageError(
          "setup needs a terminal; without one, pass flags: flowiq setup --provider xai --model grok-4 [--write-mcp]. Nothing was written.",
          "setup",
        );
      }
      const rest = argv.filter((a) => a !== c.name && !(c.aliases ?? []).includes(a.toLowerCase()));
      return runLegacySetup(ctx, rest);
    }
    case "ui":
      return runUi(ctx, !args.flags.has("--no-open"));
    case "stress": {
      const { runParaphraseAnd10xSuite } = await import("../scripts/test-paraphrase-and-ambiguity-invariance.ts");
      await runParaphraseAnd10xSuite();
      return EXIT.ok;
    }
    case "workflow":
      return runWorkflow(ctx);
    case "swarm":
      return runSwarm(ctx);
    default:
      throw new UsageError(`unknown command "${c.name}"`);
  }
}

async function main(): Promise<number> {
  const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
  const argv = process.argv.slice(2);
  let args: ParsedArgs;
  const noColorEarly = argv.includes("--no-color");
  try {
    args = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      const hint = err.command ? `flowiq help ${err.command}` : "flowiq help";
      process.stderr.write(`flowiq: ${err.message}\nRun ${hint} for usage.\n`);
      return EXIT.usage;
    }
    throw err;
  }
  const s = createStyle({ noColor: noColorEarly });
  const ctx: Ctx = {
    s,
    repoRoot,
    json: args.flags.has("--json"),
    quiet: args.flags.has("--quiet"),
  };
  if (args.flags.has("--help")) {
    if (args.command && args.command.name !== "help" && !args.implicitAsk) {
      out(...renderCommandHelp(s, args.command));
    } else if (args.implicitAsk) {
      out(...renderCommandHelp(s, findCommand("ask")!));
    } else {
      out(...renderMainHelp(s, { banner: s.tty && !ctx.quiet && !ctx.json }));
    }
    return EXIT.ok;
  }
  try {
    return await dispatch(ctx, args, argv);
  } catch (err) {
    if (err instanceof UsageError) {
      const hint = err.command ? `flowiq help ${err.command}` : "flowiq help";
      process.stderr.write(`flowiq: ${err.message}\nRun ${hint} for usage.\n`);
      return EXIT.usage;
    }
    if (err instanceof NotFoundError) {
      process.stderr.write(`flowiq: ${err.message}\n`);
      return EXIT.notFound;
    }
    if (err instanceof ExitSignal) return err.code;
    throw err;
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    process.stderr.write(`flowiq: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exitCode = EXIT.failed;
  },
);
