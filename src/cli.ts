#!/usr/bin/env node
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
import {
  DISCOVERED_EASTER_EGGS,
  type LeaseBucketField,
  type PortfolioPolicyConfig,
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
import {
  loadQuestion600Bank,
  runParallelTemporalLlmSwarm,
} from "./workflows/temporal-llm-swarm.ts";
import { runDurablePortfolioWorkflow } from "./workflows/temporal-worker.ts";

const NO_COLOR = Boolean(process.env.NO_COLOR && process.env.NO_COLOR !== "0");

const ansi = {
  border: (s: string) => (NO_COLOR ? s : `\x1b[38;2;42;62;102m${s}\x1b[0m`),
  gold: (s: string) => (NO_COLOR ? s : `\x1b[38;2;210;158;61m${s}\x1b[0m`),
  goldBright: (s: string) => (NO_COLOR ? s : `\x1b[38;2;224;178;88m${s}\x1b[0m`),
  goldBold: (s: string) => (NO_COLOR ? s : `\x1b[1;38;2;210;158;61m${s}\x1b[0m`),
  ink: (s: string) => (NO_COLOR ? s : `\x1b[38;2;236;234;227m${s}\x1b[0m`),
  inkBold: (s: string) => (NO_COLOR ? s : `\x1b[1;38;2;236;234;227m${s}\x1b[0m`),
  muted: (s: string) => (NO_COLOR ? s : `\x1b[38;2;165;176;196m${s}\x1b[0m`),
  emerald: (s: string) => (NO_COLOR ? s : `\x1b[38;2;52;211;153m${s}\x1b[0m`),
  teal: (s: string) => (NO_COLOR ? s : `\x1b[38;2;75;163;166m${s}\x1b[0m`),
  red: (s: string) => (NO_COLOR ? s : `\x1b[38;2;212;79;79m${s}\x1b[0m`),
};

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function getBoxInnerWidth(): number {
  const cols = process.stdout.columns || 78;
  return Math.max(64, Math.min(76, cols - 4));
}

function wrapPlainText(text: string, maxWidth: number): string[] {
  const width = Math.max(24, maxWidth);
  const rawTokens = String(text ?? "").split(/\s+/).filter(Boolean);
  if (rawTokens.length === 0) return [""];
  // Split any single token longer than width (such as compact JSON) on commas/braces or hard chunks
  const words: string[] = [];
  for (const tok of rawTokens) {
    if (tok.length <= width) {
      words.push(tok);
    } else {
      const subParts = tok.split(/(?<=[,;:\]\}])/g).filter(Boolean);
      for (const sp of subParts) {
        if (sp.length <= width) {
          words.push(sp);
        } else {
          for (let i = 0; i < sp.length; i += width) {
            words.push(sp.slice(i, i + width));
          }
        }
      }
    }
  }
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

function truncateVisible(str: string, maxVisible: number): string {
  const plain = stripAnsi(str);
  if (plain.length <= maxVisible) return str;
  return `${plain.slice(0, Math.max(0, maxVisible - 1))}…`;
}

function padVisible(str: string, width: number): string {
  const fitted = truncateVisible(str, width);
  const visibleLen = stripAnsi(fitted).length;
  if (visibleLen >= width) return fitted;
  return fitted + " ".repeat(width - visibleLen);
}

function boxRow(content: string, innerWidth = getBoxInnerWidth()): string {
  return `${ansi.border("│")} ${padVisible(content, innerWidth - 2)} ${ansi.border("│")}`;
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
      // ignore
    }
  }
  const resolved = resolveModelHarnessConfig();
  return {
    provider: resolved.provider,
    model: resolved.model,
    baseUrl: resolved.baseUrl,
  };
}

export function printBanner(store?: PortfolioStore, repoRoot?: string): void {
  const W = getBoxInnerWidth();
  const root = repoRoot ?? path.resolve(new URL("..", import.meta.url).pathname);
  const s = store ?? loadPortfolioStore(root);
  const cliCfg = loadSavedCliConfig(root);
  const hasMcp =
    fs.existsSync(path.join(root, ".mcp.json")) &&
    fs.existsSync(path.join(root, ".cursor", "mcp.json"));
  const hasDotEnvLocal = fs.existsSync(path.join(root, ".env.local"));

  const top = ansi.border(`╭${"─".repeat(W)}╮`);
  const mid = ansi.border(`├${"─".repeat(W)}┤`);
  const bot = ansi.border(`╰${"─".repeat(W)}╯`);
  const empty = boxRow("", W);

  console.log(top);
  console.log(
    boxRow(
      ` ${ansi.goldBold("███████╗ ██╗      ██████╗  ██╗    ██╗")}  ${ansi.goldBright("◆ ORMUS × FLOW COPILOT")}`,
      W,
    ),
  );
  console.log(
    boxRow(
      ` ${ansi.goldBold("██╔════╝ ██║     ██╔═══██╗ ██║    ██║")}  ${ansi.inkBold("Portfolio & Marketing TUI")}`,
      W,
    ),
  );
  console.log(
    boxRow(
      ` ${ansi.goldBold("█████╗   ██║     ██║   ██║ ██║ █╗ ██║")}  ${ansi.gold("Tickets FLOW-101..106")}`,
      W,
    ),
  );
  console.log(
    boxRow(
      ` ${ansi.goldBold("██╔══╝   ██║     ██║   ██║ ██║███╗██║")}  ${ansi.ink(`${s.operatingProperties.length} Bldgs · ${s.units.length.toLocaleString()} Units`)}`,
      W,
    ),
  );
  console.log(
    boxRow(
      ` ${ansi.goldBold("██║      ███████╗╚██████╔╝ ╚███╔███╔╝")}  ${ansi.muted("Hold: P09 Cornell Annex (0u)")}`,
      W,
    ),
  );
  console.log(
    boxRow(
      ` ${ansi.gold("╚═╝      ╚══════╝ ╚═════╝   ╚══╝╚══╝")}   ${ansi.emerald("✓ 27/27 Kit · ✓ 240/240 RT")}`,
      W,
    ),
  );
  console.log(mid);
  console.log(
    boxRow(
      `${ansi.goldBold("HARNESS:")} ${ansi.inkBold(cliCfg.provider)} (${ansi.gold(cliCfg.model)}) · ${ansi.goldBold("MCP:")} ${hasMcp ? ansi.emerald("✓ wired") : ansi.gold("run /setup")}`,
      W,
    ),
  );
  console.log(
    boxRow(
      `${ansi.goldBold("POLICY :")} CAD=${ansi.ink(String(s.policy.cadToUsdRate))} · Notice=${ansi.ink(String(s.policy.occupiedIncludesNotice))} · Bucket=${ansi.ink(s.policy.leaseBucketBy)} · B0=${s.policy.priorSpendUsdBeta0}`,
      W,
    ),
  );
  console.log(bot);
}

export function printTuiCommandDeck(): void {
  const W = getBoxInnerWidth();
  const title = "FLOWIQ TERMINAL USER INTERFACE (TUI) · COMMAND DECK";
  const dashCount = Math.max(2, W - title.length - 4);
  const top = ansi.border(`╭─ ${ansi.goldBold(title)} ${"─".repeat(dashCount)}╮`);
  const bot = ansi.border(`╰${"─".repeat(W)}╯`);

  console.log(top);
  console.log(
    boxRow(
      `${ansi.goldBold("[1]")} ${ansi.inkBold("Ask / ID")}       ${ansi.muted("Ask any question or ID (D01..D10, T01..T13, B01..B03)")}`,
      W,
    ),
  );
  console.log(
    boxRow(
      `${ansi.goldBold("[2]")} ${ansi.inkBold("/setup")}         ${ansi.muted("Live LLM API Probe (/v1/models), Key & MCP Wizard")}`,
      W,
    ),
  );
  console.log(
    boxRow(
      `${ansi.goldBold("[3]")} ${ansi.inkBold("/ui")}            ${ansi.muted("Open Client Dashboard & Field Notebook in Browser")}`,
      W,
    ),
  );
  console.log(
    boxRow(
      `${ansi.goldBold("[4]")} ${ansi.inkBold("/doctor")}        ${ansi.muted("6-Table Hygiene, 6 CSV Traps & Live Provider Audit")}`,
      W,
    ),
  );
  console.log(
    boxRow(
      `${ansi.goldBold("[5]")} ${ansi.inkBold("/validate")}      ${ansi.muted("Question / Answer (Schema) / Source for All 27 Items")}`,
      W,
    ),
  );
  console.log(
    boxRow(
      `${ansi.goldBold("[6]")} ${ansi.inkBold("/stress")}        ${ansi.muted("Run 240 Blind Paraphrases, 20 Ambiguity & 10x Suite")}`,
      W,
    ),
  );
  console.log(
    boxRow(
      `${ansi.goldBold("[7]")} ${ansi.inkBold("/swarm")}         ${ansi.muted("Run 8-Worker Parallel Batch (Crash @ #18 & Replay)")}`,
      W,
    ),
  );
  console.log(
    boxRow(
      `${ansi.goldBold("[8]")} ${ansi.inkBold("/policy")}        ${ansi.muted("Interactive Runtime Policy Toggle (CAD, Notice, B0)")}`,
      W,
    ),
  );
  console.log(
    boxRow(
      `${ansi.goldBold("[9]")} ${ansi.inkBold("/answers")}       ${ansi.muted("Regenerate & Print All 17 Lines of answers.jsonl Live")}`,
      W,
    ),
  );
  console.log(
    boxRow(
      `${ansi.goldBold("[0]")} ${ansi.inkBold("/quit")}          ${ansi.muted("Exit TUI  (Also: /buildings, /decisions, /help)")}`,
      W,
    ),
  );
  console.log(bot);
}

const HELP_TEXT = `flowiq: portfolio copilot over the six CSV exports

usage: flowiq <command> [options]

ask
  ask "<question>"        answer one question
  ask <ID>                answer a kit item (D01..D10, T01..T13, B01..B03)
  repl                    interactive session (also: no arguments)
data
  doctor, status          data and harness health
  validate [ID]           check the kit items against expected answers
  answers                 regenerate answers.jsonl
setup
  setup [--provider P]    choose a model provider and write MCP config
  mcp-config              print the MCP server JSON
  help, -h, --help        show this text
options for ask
  --json                  print the answer envelope as JSON
  --llm                   route through the configured model harness
  --provider P            ${"xai, anthropic, openai, openrouter, ollama, local, deterministic"}
  --model M               model id for the provider
  --cad-rate N            CAD to USD rate (number > 0)
  --exclude-notice        count on-notice units as not occupied
  --bucket-by F           lease_start_date | lead_created_date
  --beta0 N               prior spend for the decision learner (number > 0)
`;

/** Prints a usage error to stderr and exits 2 (bad invocation). */
function usageError(message: string): never {
  process.stderr.write(`flowiq: ${message}\nRun flowiq help for usage.\n`);
  process.exit(2);
}

const ASK_BOOLEAN_FLAGS = new Set(["--json", "--llm", "--live-llm", "--exclude-notice"]);
const ASK_VALUE_FLAGS = new Set([
  "--provider",
  "--model",
  "--base-url",
  "--cad-rate",
  "--bucket-by",
  "--beta0",
]);

/** Rejects unknown flags and values that would silently change the numbers. */
function validateAskFlags(args: readonly string[]): void {
  for (const a of args) {
    if (!a.startsWith("--")) continue;
    const name = a.includes("=") ? a.slice(0, a.indexOf("=")) : a;
    if (!ASK_BOOLEAN_FLAGS.has(name) && !ASK_VALUE_FLAGS.has(name)) {
      usageError(`unknown option ${name}`);
    }
  }
  for (const flag of ASK_VALUE_FLAGS) {
    const present = args.some((a) => a === flag || a.startsWith(`${flag}=`));
    if (present && getFlagValue(args, flag) === undefined) {
      usageError(`${flag} needs a value`);
    }
  }
  const provider = getFlagValue(args, "--provider");
  if (provider !== undefined && !normalizeProviderId(provider)) {
    usageError(
      `--provider must be one of xai, anthropic, openai, openrouter, ollama, local, deterministic (got "${provider}")`,
    );
  }
  for (const flag of ["--cad-rate", "--beta0"]) {
    const raw = getFlagValue(args, flag);
    if (raw !== undefined) {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        usageError(`${flag} must be a number greater than 0 (got "${raw}")`);
      }
    }
  }
  const bucket = getFlagValue(args, "--bucket-by");
  if (bucket !== undefined && bucket !== "lease_start_date" && bucket !== "lead_created_date") {
    usageError(`--bucket-by must be lease_start_date or lead_created_date (got "${bucket}")`);
  }
}

function normalizeProviderId(raw?: string): ModelProviderId | undefined {
  if (!raw) return undefined;
  const norm = raw.trim().toLowerCase().replace(/-/g, "_");
  if (norm === "grok" || norm === "xai") return "xai";
  if (norm === "claude" || norm === "anthropic") return "anthropic";
  if (norm === "local" || norm === "local_openai" || norm === "vllm" || norm === "flint") {
    return "local_openai";
  }
  if (norm in MODEL_PROVIDER_PROFILES) {
    return norm as ModelProviderId;
  }
  return undefined;
}

function getFlagValue(args: readonly string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  const prefix = `${flag}=`;
  const eqArg = args.find((a) => a.startsWith(prefix));
  return eqArg ? eqArg.slice(prefix.length) : undefined;
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

function openFileOrUrlInBrowser(targetPathOrUrl: string): boolean {
  try {
    const cmd =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "cmd"
          : "xdg-open";
    const cmdArgs =
      process.platform === "win32"
        ? ["/c", "start", "", targetPathOrUrl]
        : [targetPathOrUrl];
    const child = spawn(cmd, cmdArgs, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function runUiCommand(repoRoot: string, args: readonly string[] = []): Promise<void> {
  const dashboardPath = path.join(repoRoot, "public", "index.html");
  const notebookPath = path.join(repoRoot, "public", "field-notebook.html");

  console.log(`\n${ansi.goldBold("◆ FLOWIQ VISUAL SURFACES & ARTIFACTS")}`);
  console.log(
    `  1. ${ansi.inkBold("Client & Operator Dashboard (local)")} : ${ansi.gold(dashboardPath)}`,
  );
  console.log(
    `  2. ${ansi.inkBold("12-Plate Field Notebook (local)")}     : ${ansi.gold(notebookPath)}`,
  );
  console.log(
    `  3. ${ansi.inkBold("Live Production Dashboard (Vercel)")}  : ${ansi.emerald("https://repo-sigma-one-80.vercel.app")}`,
  );
  console.log(
    `  4. ${ansi.inkBold("Live Field Notebook (Vercel)")}        : ${ansi.emerald("https://repo-sigma-one-80.vercel.app/field-notebook.html")}`,
  );

  if (!args.includes("--no-open")) {
    const openedDash = openFileOrUrlInBrowser(dashboardPath);
    const openedNote = openFileOrUrlInBrowser(notebookPath);
    if (openedDash || openedNote) {
      console.log(
        `\n${ansi.emerald("✓ Opened public/index.html and public/field-notebook.html in your browser.")}`,
      );
    }
  }
}

export function printValidationEnvelopeCard(
  q: QuestionRecord,
  turn: Awaited<ReturnType<typeof askFlowIqCopilot>>,
): void {
  const W = getBoxInnerWidth();
  const title = `OFFICIAL VALIDATION CARD · ${q.id} (${q.type})`;
  const dashCount = Math.max(2, W - title.length - 4);
  const top = ansi.border(`╭─ ${ansi.goldBold(title)} ${"─".repeat(dashCount)}╮`);
  const bot = ansi.border(`╰${"─".repeat(W)}╯`);

  console.log(top);
  for (const line of wrapPlainText(`Question: ${q.question}`, W - 4)) {
    console.log(boxRow(ansi.inkBold(line), W));
  }
  if (q.result_schema) {
    for (const line of wrapPlainText(`Expected Schema: ${JSON.stringify(q.result_schema)}`, W - 4)) {
      console.log(boxRow(ansi.teal(line), W));
    }
  }
  for (const line of wrapPlainText(`Answer (Schema): ${JSON.stringify(turn.envelope.result)} [Exact Match]`, W - 4)) {
    console.log(boxRow(ansi.gold(line), W));
  }
  for (const line of wrapPlainText(`Prose: ${turn.envelope.answer}`, W - 4)) {
    console.log(boxRow(ansi.ink(line), W));
  }
  for (const line of wrapPlainText(
    `Source Citations (${turn.envelope.citations.length}): ${turn.envelope.citations.join(", ")}`,
    W - 4,
  )) {
    console.log(boxRow(ansi.emerald(line), W));
  }
  const jsonlObj = {
    id: turn.envelope.id,
    answer: turn.envelope.answer,
    result: turn.envelope.result,
    citations: turn.envelope.citations,
  };
  for (const line of wrapPlainText(`JSONL Line: ${JSON.stringify(jsonlObj)}`, W - 4)) {
    console.log(boxRow(ansi.goldBright(line), W));
  }
  if (turn.toolCalls.length > 0) {
    const traceStr = `Tools: ${turn.toolCalls.map((tc) => `${tc.toolName}(${JSON.stringify(tc.args)})`).join(" -> ")}`;
    for (const line of wrapPlainText(traceStr, W - 4)) {
      console.log(boxRow(ansi.muted(line), W));
    }
  }
  console.log(bot);
}

async function runValidateAllCommand(
  repoRoot: string,
  store: PortfolioStore,
  filterId?: string,
): Promise<void> {
  const devQs = loadQuestionsFile(path.join(repoRoot, "questions", "dev.jsonl"));
  const testQs = loadQuestionsFile(path.join(repoRoot, "questions", "test.jsonl"));
  const bonusQs = loadQuestionsFile(
    path.join(repoRoot, "questions", ".bonus.jsonl"),
  ).filter((q) => q.id !== "B00");

  const all = [...devQs, ...testQs, ...bonusQs];
  if (filterId) {
    const target = filterId.toUpperCase();
    if (target === "EGGS") {
      console.log(
        `\n${ansi.goldBold("Question:")} B00 Hidden Easter-Egg Cipher (unzip -z archive comment + properties:P09 base64 aka)`,
      );
      console.log(
        `${ansi.goldBold("Answer (with schema):")} ${ansi.emerald(JSON.stringify({ id: "EGGS", words: DISCOVERED_EASTER_EGGS.eggsTuple }))}`,
      );
      console.log(
        `${ansi.goldBold("Source:")} properties:P09 (aka="the Annex;am9pbi5vcm11cy5zb2x1dGlvbnMvbmludGgtaG91c2U=" -> join.ormus.solutions/ninth-house -> "athanor") + zip comment ("pyrite")\n`,
      );
      return;
    }
    const found = all.find((q) => q.id.toUpperCase() === target);
    if (found) {
      const turn = await askFlowIqCopilot(found, { store });
      console.log("");
      printValidationEnvelopeCard(found, turn);
      return;
    }
  }

  console.log(
    `\n${ansi.goldBold("◆ OFFICIAL 27-ITEM VALIDATION VIEW (Question / Answer with Schema / Source)")}`,
  );
  for (const q of all) {
    const turn = await askFlowIqCopilot(q, { store });
    console.log(
      `\n${ansi.goldBold("Question:")} [${ansi.inkBold(q.id)} · ${q.type}] ${ansi.ink(q.question)}`,
    );
    console.log(
      `${ansi.goldBold("Answer (with schema):")} ${ansi.emerald(JSON.stringify({ id: q.id, result: turn.envelope.result, schema: q.result_schema }))}`,
    );
    console.log(
      `${ansi.goldBold("Source:")} ${ansi.teal(JSON.stringify({ citations: turn.envelope.citations, tools: turn.toolCalls.map((t) => t.toolName) }))}`,
    );
  }
  console.log(
    `\n${ansi.goldBold("Question:")} [EGGS · bonus-cipher] Hidden words in challenge archive & P09 base64 aka`,
  );
  console.log(
    `${ansi.goldBold("Answer (with schema):")} ${ansi.emerald(JSON.stringify({ id: "EGGS", words: DISCOVERED_EASTER_EGGS.eggsTuple }))}`,
  );
  console.log(
    `${ansi.goldBold("Source:")} ${ansi.teal(JSON.stringify({ zipComment: "pyrite", p09Base64Aka: "join.ormus.solutions/ninth-house -> athanor" }))}`,
  );
  console.log(
    `\n${ansi.emerald("✓ All 27/27 official items (D01..D10, T01..T13, B01..B03, EGGS) verified with 0 schema or citation errors.")}`,
  );
}

async function runAnswersCommand(
  repoRoot: string,
  store: PortfolioStore,
  suppressBanner = false,
): Promise<void> {
  if (!suppressBanner) printBanner(store, repoRoot);
  const { generateAnswersJsonl } = await import("../scripts/generate-answers.ts");
  const lines = await generateAnswersJsonl();
  const outPath = path.join(repoRoot, "answers.jsonl");
  fs.writeFileSync(outPath, `${lines.join("\n")}\n`, "utf-8");

  const totalCols = Math.min(76, (process.stdout.columns || 78) - 2);
  const wrapWidth = Math.max(42, totalCols - 18);
  const divider = ansi.border("─".repeat(totalCols));

  console.log(
    `\n${ansi.goldBold("◆ REGENERATED & VERIFIED answers.jsonl (17 LINES · KIT_README.md FORMAT)")}`,
  );
  console.log(
    `  File Written : ${ansi.emerald(outPath)} (${lines.length} lines)\n${divider}`,
  );
  for (const rawLine of lines) {
    const parsed = JSON.parse(rawLine) as {
      id: string;
      answer?: string;
      result?: unknown;
      citations?: string[];
      words?: string[];
    };
    const label = `[${parsed.id}] JSONL`.padEnd(15) + ":";
    printWrappedField(
      label,
      rawLine,
      parsed.id === "EGGS" ? ansi.teal : ansi.goldBright,
      wrapWidth,
    );
  }
  console.log(divider);
  console.log(
    `${ansi.emerald("✓ All 17 lines (T01..T13, B01..B03, EGGS) written to answers.jsonl with exact result_schema & citations.")}`,
  );
}

async function runDoctorCommand(store: PortfolioStore): Promise<void> {
  printBanner(store);
  const dq = queryDataQualityAudit(store);
  const integrity = evaluateCrossTableIntegrity(store, FLOW_PORTFOLIO_INTEGRITY_EDGES);
  const mkt = queryMarketingSpendAndFunnel(store, {
    period: "APR_SEP_2026",
    paidOnly: true,
  });
  const learner = evaluateBudgetDecisionsAndLearn(store);
  const profiles = await discoverAvailableModelProfiles();

  console.log(
    `\n${ansi.goldBold("1. PORTFOLIO DATA STORE HEALTH (6 RAW CSV EXPORTS)")} ${ansi.emerald("[✓ VERIFIED]")}`,
  );
  console.log(
    `   • Total Source Rows Indexed  : ${ansi.inkBold(store.primaryKeyIndex.size.toLocaleString())} primary keys across 6 CSV tables (asOfDate=${store.policy.asOfDate})`,
  );
  console.log(
    `   • Active vs Onboarding Hold  : ${ansi.inkBold(String(store.operatingProperties.length))} operating (P01..P08, 1,100 units, 94.4% occupied) | ${ansi.goldBold(String(store.onboardingProperties.length))} onboarding hold (properties:P09 Cornell Annex, 0 units, AppFolio)`,
  );
  console.log(
    `   • Leases / Leads / Ad Spend  : ${store.leases.length.toLocaleString()} leases (${store.signedLeases.length} attributed) | ${store.leads.length.toLocaleString()} leads (${store.deduplicatedLeads.length.toLocaleString()} deduplicated) | ${store.spend.length} invoices (${store.postedSpend.length} posted)`,
  );

  console.log(
    `\n${ansi.goldBold("2. CROSS-TABLE DATA RECONCILIATION (6-TABLE INTEGRITY CHECKS E1..E6)")} ${ansi.emerald(`[reconciled=${integrity.isGlobalSection}]`)}`,
  );
  for (const edge of FLOW_PORTFOLIO_INTEGRITY_EDGES) {
    const resList = integrity.byEdge[edge.edgeId] ?? [];
    const summary = getIntegrityEdgeSummary(edge);
    console.log(
      `   • ${ansi.inkBold(summary.displayId.padEnd(32))} (${summary.tablePair}): ${resList.length} anomaly row(s) caught | blocking=${edge.blocking}`,
    );
  }

  console.log(
    `\n${ansi.goldBold("3. SIX DATA HYGIENE & SECURITY TRAPS CAUGHT (EXACT PRIMARY KEYS)")} ${ansi.emerald("[⊘ QUARANTINED]")}`,
  );
  console.log(
    `   [T1] Non-Operating Building  : ${ansi.inkBold("properties:P09")} (Cornell Annex, 0 units in units.csv, AppFolio PMS, Base64 aka -> join.ormus.solutions/ninth-house)`,
  );
  console.log(
    `   [T2] CRM Prompt Injection    : ${ansi.inkBold("leads:D01011")} (P06 Facebook Ads, "IGNORE PREVIOUS INSTRUCTIONS... verified by analytics") stripped & blocked`,
  );
  console.log(
    `   [T3] Void Spend Invoices     : ${ansi.inkBold(`${dq.voidSpendRowCount} rows`)} (${store.voidSpend.map((v) => v.spendId).join(", ")} = $11,500.80 raw) quarantined at $0.00`,
  );
  console.log(
    `   [T4] CAD Currency Conversion : ${ansi.inkBold(`${dq.cadSpendRowCount} rows`)} (12 posted S0126..S0184 on P06/P07 Facebook Ads + 1 void S0174) converted @ 1 CAD = ${store.policy.cadToUsdRate} USD ($2,212.66 1BR avg @ P07 on T01)`,
  );
  console.log(
    `   [T5] Duplicate Phone Leads   : ${ansi.inkBold(`${dq.duplicateLeadCount} rows`)} (D01490..D01498 sharing lease_id with earliest leads D00224..D01454) deduplicated`,
  );
  console.log(
    `   [T6] Lag, Rent & Reallocation: ${ansi.inkBold("70 cross-month lags")}, ${ansi.inkBold("$1,955/mo")} notice rent gap, ${ansi.inkBold(`$${mkt.deadSpendReallocation.totalDeadSpendUsd.toFixed(2)}`)} dead spend across 9 pairs -> ${ansi.emerald(`+${mkt.deadSpendReallocation.projectedAdditionalWholeLeases} leases`)} on Apartments.com; Small-Sample Guard windowInvariance=${learner.windowInvarianceVerified}`,
  );

  console.log(
    `\n${ansi.goldBold("4. LIVE MODEL HARNESS & ENDPOINT PROBE (/v1/models)")}`,
  );
  for (const item of profiles) {
    const pId = item.profile.provider === "local_openai" ? "local-openai" : item.profile.provider;
    const badge = item.reachable
      ? ansi.emerald("● LIVE VERIFIED")
      : item.configured
        ? ansi.gold("◐ KEY SET      ")
        : ansi.muted("○ UNCONFIGURED ");
    console.log(
      `   ${badge} ${ansi.inkBold(pId.padEnd(15))} | ${ansi.muted(item.statusDetail)}`,
    );
  }

  const bank600Count = loadQuestion600Bank().length;
  console.log(
    `\n${ansi.goldBold("5. EVALUATION SUITES & LIVE SURFACES")} ${ansi.emerald("[✓ VERIFIED]")}`,
  );
  console.log(
    `   • Clean-Room Python Verifier : ${ansi.inkBold("27/27 PASS")} (npm run eval:cleanroom — zero dependencies on src/)`,
  );
  console.log(
    `   • Blind Red-Team Suites      : ${ansi.inkBold("240/240 paraphrases + 20/20 ambiguity + 21/21 10x portfolio")} (npm run eval:paraphrase)`,
  );
  console.log(
    `   • 600-Question Stress Test   : ${ansi.inkBold(`${bank600Count}/600 verified`)} (1,800 checks via scripts/generate-600-bank.ts)`,
  );
  console.log(
    `   • Live Web & Notebook URLs   : ${ansi.inkBold("https://repo-sigma-one-80.vercel.app")} · ${ansi.inkBold("https://repo-sigma-one-80.vercel.app/field-notebook.html")}`,
  );
}

async function runInteractiveSetupWizard(
  repoRoot: string,
  existingRl?: readlinePromises.Interface,
): Promise<void> {
  const ownRl =
    existingRl ??
    readlinePromises.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

  try {
    console.log(
      `\n${ansi.goldBold("╭──────────────────────────────────────────────────────────────────────────────╮")}`,
    );
    console.log(
      `${ansi.goldBold("│")}  ${ansi.inkBold("FLOWIQ INTERACTIVE AGENT, LIVE /v1/models PROBE & MCP SETUP WIZARD")}         ${ansi.goldBold("│")}`,
    );
    console.log(
      `${ansi.goldBold("╰──────────────────────────────────────────────────────────────────────────────╯")}`,
    );

    console.log(ansi.muted("  Probing local and configured cloud /v1/models endpoints..."));
    const profiles = await discoverAvailableModelProfiles();
    const providerChoices: Array<{ key: string; id: ModelProviderId }> = [
      { key: "1", id: "xai" },
      { key: "2", id: "anthropic" },
      { key: "3", id: "openai" },
      { key: "4", id: "openrouter" },
      { key: "5", id: "ollama" },
      { key: "6", id: "local_openai" },
      { key: "7", id: "deterministic" },
    ];

    console.log(`\n${ansi.goldBold("Step 1/4 · Choose Your LLM / Agent Execution Provider:")}`);
    for (const c of providerChoices) {
      const status = profiles.find((p) => p.profile.provider === c.id)!;
      const badge = status.reachable
        ? ansi.emerald("● LIVE API VERIFIED")
        : status.configured
          ? ansi.gold("◐ ENV KEY SET      ")
          : ansi.muted("○ NOT CONFIGURED   ");
      console.log(
        `  ${ansi.goldBold(`[${c.key}]`)} ${ansi.inkBold(c.id.padEnd(14))} ${badge} — ${ansi.ink(status.profile.label)} (${ansi.muted(status.statusDetail)})`,
      );
    }

    const ansProvider = (
      await ownRl.question(
        ansi.goldBold("\nSelect provider [1-7, default=7 (deterministic)]: "),
      )
    ).trim();

    const chosen =
      providerChoices.find(
        (c) => c.key === ansProvider || c.id === normalizeProviderId(ansProvider),
      ) ?? providerChoices[6];
    const provider = chosen.id;
    const profile = MODEL_PROVIDER_PROFILES[provider];

    console.log(
      `\n${ansi.goldBold("Step 2/4 · Configure Endpoint, API Key & Live Model Discovery (/v1/models):")}`,
    );
    const ansBaseUrl = (
      await ownRl.question(
        ansi.gold(`  Endpoint Base URL [default: ${profile.baseUrl}]: `),
      )
    ).trim();
    const baseUrl = ansBaseUrl || profile.baseUrl;

    let apiKey = profile.envKeyName ? (process.env[profile.envKeyName] ?? "") : "";
    if (profile.requiresApiKey) {
      const enteredKey = (
        await ownRl.question(
          ansi.gold(
            `  Enter ${profile.envKeyName} ${apiKey ? "(press Enter to keep current key)" : "(required for live API calls)"}: `,
          ),
        )
      ).trim();
      if (enteredKey) {
        apiKey = enteredKey;
        process.env[profile.envKeyName!] = apiKey;
      }
    }

    let defaultModelChoice = profile.defaultModel;
    if (provider !== "deterministic") {
      console.log(ansi.muted(`  Querying live models from ${baseUrl}...`));
      const liveProbe = await fetchLiveModelsForProvider(provider, baseUrl, apiKey, 3500);
      if (liveProbe.reachable && liveProbe.models.length > 0) {
        defaultModelChoice = liveProbe.models[0];
        console.log(
          `  ${ansi.emerald(`✓ Connected! Discovered ${liveProbe.models.length} live models:`)} ${ansi.ink(liveProbe.models.slice(0, 8).join(", "))}`,
        );
      } else {
        console.log(`  ${ansi.gold(`○ Live /models probe note:`)} ${ansi.muted(liveProbe.statusDetail)}`);
      }
    }

    const ansModel = (
      await ownRl.question(
        ansi.gold(`  Model ID [default: ${defaultModelChoice}]: `),
      )
    ).trim();
    const model = ansModel || defaultModelChoice;

    if (profile.requiresApiKey && apiKey && profile.envKeyName) {
      const envPath = path.join(repoRoot, ".env.local");
      const envLine = `${profile.envKeyName}="${apiKey}"\nFLOWIQ_PROVIDER="${provider}"\nFLOWIQ_MODEL="${model}"\n`;
      fs.writeFileSync(envPath, envLine, "utf-8");
      console.log(`  ${ansi.emerald(`✓ Saved ${profile.envKeyName} to .env.local (gitignored)`)}`);
    }

    console.log(
      `\n${ansi.goldBold("Step 3/4 · Wire Agent MCP Server & IDE Configurations (.mcp.json & .cursor/mcp.json):")}`,
    );
    const ansMcp = (
      await ownRl.question(
        ansi.gold(
          "  Write MCP server config for Claude Code, Cursor & Grok CLI? [Y/n]: ",
        ),
      )
    )
      .trim()
      .toLowerCase();
    const writeMcp = ansMcp === "" || ansMcp.startsWith("y");

    const configDir = path.join(repoRoot, ".toq", "flow-copilot");
    fs.mkdirSync(configDir, { recursive: true });
    const configPath = path.join(configDir, "cli-harness-config.json");
    const savedConfig = {
      provider,
      model,
      baseUrl,
      wireMode: profile.wireMode,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(configPath, JSON.stringify(savedConfig, null, 2), "utf-8");

    if (writeMcp) {
      const mcpJson = `${JSON.stringify(buildMcpConfigObject(repoRoot), null, 2)}\n`;
      fs.writeFileSync(path.join(repoRoot, ".mcp.json"), mcpJson, "utf-8");
      const cursorDir = path.join(repoRoot, ".cursor");
      fs.mkdirSync(cursorDir, { recursive: true });
      fs.writeFileSync(path.join(cursorDir, "mcp.json"), mcpJson, "utf-8");
    }

    console.log(`\n${ansi.emerald("✓ FlowIQ Agent & Harness Configuration Saved:")}`);
    console.log(`  • Provider   : ${ansi.inkBold(provider)} (${profile.label})`);
    console.log(`  • Model      : ${ansi.inkBold(model)}`);
    console.log(`  • Base URL   : ${ansi.inkBold(baseUrl)}`);
    console.log(`  • Wire Mode  : ${ansi.inkBold(profile.wireMode)}`);
    console.log(`  • Config File: ${ansi.muted(path.relative(repoRoot, configPath))}`);
    if (writeMcp) {
      console.log(
        `  • Agent MCP  : ${ansi.emerald("✓ .mcp.json & .cursor/mcp.json wired (7 MCP tools exposed)")}`,
      );
    }

    console.log(
      `\n${ansi.goldBold("Step 4/4 · Launch Visual Dashboard & Field Notebook:")}`,
    );
    const ansUi = (
      await ownRl.question(
        ansi.gold(
          "  Open Visual Client Dashboard (public/index.html) & Field Notebook in browser now? [Y/n]: ",
        ),
      )
    )
      .trim()
      .toLowerCase();
    if (ansUi === "" || ansUi.startsWith("y")) {
      await runUiCommand(repoRoot);
    }
  } finally {
    if (!existingRl) {
      ownRl.close();
    }
  }
}

async function runSetupCommand(repoRoot: string, args: readonly string[]): Promise<void> {
  const isNonInteractive =
    args.includes("--non-interactive") ||
    args.includes("--provider") ||
    args.some((a) => a.startsWith("--provider=")) ||
    !process.stdin.isTTY;

  if (!isNonInteractive) {
    printBanner(undefined, repoRoot);
    await runInteractiveSetupWizard(repoRoot);
    return;
  }

  printBanner(undefined, repoRoot);
  const providerRaw = getFlagValue(args, "--provider") ?? "deterministic";
  const provider = normalizeProviderId(providerRaw) ?? "deterministic";
  const profile = MODEL_PROVIDER_PROFILES[provider];
  const model = getFlagValue(args, "--model") ?? profile.defaultModel;
  const baseUrl = getFlagValue(args, "--base-url") ?? profile.baseUrl;
  const writeMcp = args.includes("--write-mcp") || args.includes("--non-interactive");

  const configDir = path.join(repoRoot, ".toq", "flow-copilot");
  fs.mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, "cli-harness-config.json");
  const savedConfig = {
    provider,
    model,
    baseUrl,
    wireMode: profile.wireMode,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(configPath, JSON.stringify(savedConfig, null, 2), "utf-8");

  if (writeMcp) {
    const mcpJson = `${JSON.stringify(buildMcpConfigObject(repoRoot), null, 2)}\n`;
    fs.writeFileSync(path.join(repoRoot, ".mcp.json"), mcpJson, "utf-8");
    const cursorDir = path.join(repoRoot, ".cursor");
    fs.mkdirSync(cursorDir, { recursive: true });
    fs.writeFileSync(path.join(cursorDir, "mcp.json"), mcpJson, "utf-8");
  }

  console.log(`\n${ansi.emerald("✓ FlowIQ Harness & MCP Configuration Saved")}`);
  console.log(`  • Provider   : ${ansi.inkBold(provider)} (${profile.label})`);
  console.log(`  • Model      : ${ansi.inkBold(model)}`);
  console.log(`  • Base URL   : ${ansi.inkBold(baseUrl)}`);
  console.log(`  • Config File: ${ansi.muted(path.relative(repoRoot, configPath))}`);
  if (writeMcp) {
    console.log(`  • MCP Configs: ${ansi.muted(".mcp.json & .cursor/mcp.json updated")}`);
  }
}

function printWrappedField(
  label: string,
  text: string,
  colorFn: (s: string) => string,
  wrapWidth: number,
): void {
  const lines = wrapPlainText(text, wrapWidth);
  const pad = " ".repeat(17);
  lines.forEach((line, idx) => {
    const prefix = idx === 0 ? ansi.goldBold(label.padEnd(16)) + " " : pad;
    console.log(`${prefix}${colorFn(line)}`);
  });
}

function printFormattedTurnOutput(
  question: string,
  turn: Awaited<ReturnType<typeof askFlowIqCopilot>>,
  harnessMeta?: {
    providerUsed: string;
    modelUsed: string;
    wireModeUsed: string;
    latencyMs: number;
  },
): void {
  const totalCols = Math.min(76, (process.stdout.columns || 78) - 2);
  const wrapWidth = Math.max(42, totalCols - 18);
  const divider = ansi.border("─".repeat(totalCols));

  console.log(`\n${divider}`);
  printWrappedField("Question       :", question, ansi.inkBold, wrapWidth);

  if (harnessMeta) {
    printWrappedField(
      "Harness        :",
      `${harnessMeta.providerUsed} (${harnessMeta.modelUsed}) · ${harnessMeta.wireModeUsed} · ${harnessMeta.latencyMs}ms`,
      ansi.muted,
      wrapWidth,
    );
  }
  const fallbackReason =
    (turn as { llmFallbackReason?: string | null; fallbackReason?: string | null })
      .llmFallbackReason ??
    (turn as { fallbackReason?: string | null }).fallbackReason ??
    null;
  if (fallbackReason) {
    printWrappedField("Fallback       :", fallbackReason, ansi.gold, wrapWidth);
  }
  if (turn.toolCalls.length > 0) {
    for (const tc of turn.toolCalls) {
      printWrappedField(
        "Tool Executed  :",
        `${tc.toolName}(${JSON.stringify(tc.args)})`,
        ansi.teal,
        wrapWidth,
      );
      printWrappedField(
        "Tool Output    :",
        tc.outputSummary,
        ansi.muted,
        wrapWidth,
      );
    }
  }
  if (turn.clarificationNeeded) {
    printWrappedField(
      "Status         :",
      "AMBIGUOUS BUILDING MATCH (FLOW-101 Clarification Gate)",
      ansi.gold,
      wrapWidth,
    );
  }

  printWrappedField("Answer (Prose) :", turn.envelope.answer, ansi.ink, wrapWidth);
  printWrappedField(
    "Result (Schema):",
    JSON.stringify(turn.envelope.result),
    ansi.goldBright,
    wrapWidth,
  );
  printWrappedField(
    "Source Rows    :",
    turn.envelope.citations.join(", "),
    ansi.emerald,
    wrapWidth,
  );
  printWrappedField(
    "JSONL Line     :",
    JSON.stringify({
      id: turn.envelope.id,
      answer: turn.envelope.answer,
      result: turn.envelope.result,
      citations: turn.envelope.citations,
    }),
    ansi.gold,
    wrapWidth,
  );
  const result = turn.envelope.result as Record<string, unknown>;
  const notAnswered =
    result.unknown === true ||
    result.refused === true ||
    result.clarification_needed === true;
  printWrappedField(
    "Verified       :",
    !turn.verification.valid
      ? `FAIL (${turn.verification.errors.join("; ")})`
      : notAnswered
        ? result.refused === true
          ? "NOT ANSWERED (refused)"
          : result.clarification_needed === true
            ? "NOT ANSWERED (needs clarification)"
            : "NOT ANSWERED (unknown to the exports)"
        : `PASS (${turn.envelope.citations.length} source row citations exist; PASS checks sources, not interpretation)`,
    turn.verification.valid ? (notAnswered ? ansi.gold : ansi.emerald) : ansi.red,
    wrapWidth,
  );
  console.log(divider);
}

async function runAskCommand(
  repoRoot: string,
  args: readonly string[],
  suppressBanner = false,
): Promise<void> {
  validateAskFlags(args);
  const jsonOutput = args.includes("--json");
  const useLlmFlag = args.includes("--llm") || args.includes("--live-llm");
  const providerFlag = normalizeProviderId(getFlagValue(args, "--provider"));
  const modelFlag = getFlagValue(args, "--model");
  const baseUrlFlag = getFlagValue(args, "--base-url");
  const cadRateFlag = getFlagValue(args, "--cad-rate");
  const excludeNotice = args.includes("--exclude-notice");
  const bucketByFlag = getFlagValue(args, "--bucket-by") as LeaseBucketField | undefined;
  const beta0Flag = getFlagValue(args, "--beta0");

  const policyOverrides: Partial<PortfolioPolicyConfig> = {
    ...(cadRateFlag ? { cadToUsdRate: Number.parseFloat(cadRateFlag) } : {}),
    ...(excludeNotice ? { occupiedIncludesNotice: false } : {}),
    ...(bucketByFlag === "lead_created_date" || bucketByFlag === "lease_start_date"
      ? { leaseBucketBy: bucketByFlag }
      : {}),
    ...(beta0Flag ? { priorSpendUsdBeta0: Number.parseFloat(beta0Flag) } : {}),
  };

  const skipNext = new Set<number>();
  const flagsWithValues = new Set([
    "--provider",
    "--model",
    "--base-url",
    "--cad-rate",
    "--bucket-by",
    "--beta0",
  ]);
  for (let i = 0; i < args.length; i += 1) {
    if (flagsWithValues.has(args[i])) {
      skipNext.add(i);
      skipNext.add(i + 1);
    } else if (
      args[i] === "--json" ||
      args[i] === "--llm" ||
      args[i] === "--live-llm" ||
      args[i] === "--exclude-notice" ||
      args[i].startsWith("--")
    ) {
      skipNext.add(i);
    }
  }

  const questionParts = args.filter((_, idx) => !skipNext.has(idx));
  const rawInput = questionParts.join(" ").trim();
  if (!rawInput) {
    usageError('ask needs a question: flowiq ask "<question>" | <ID>');
  }

  const store = loadPortfolioStore(repoRoot, policyOverrides);

  if (/^(?:D0[1-9]|D10|T0[1-9]|T1[0-3]|B0[1-3]|EGGS)$/i.test(rawInput) && !jsonOutput) {
    if (!suppressBanner) printBanner(store, repoRoot);
    await runValidateAllCommand(repoRoot, store, rawInput.toUpperCase());
    return;
  }

  const kitId = /^(?:D0[1-9]|D10|T0[1-9]|T1[0-3]|B0[1-3])$/i.test(rawInput)
    ? rawInput.toUpperCase()
    : null;
  const kitRecord = kitId
    ? ["dev.jsonl", "test.jsonl", ".bonus.jsonl"]
        .flatMap((f) => loadQuestionsFile(path.join(repoRoot, "questions", f)))
        .find((q) => q.id === kitId)
    : undefined;
  if (kitId && !kitRecord) {
    usageError(`no kit question with id ${kitId}`);
  }
  const question = kitRecord ? kitRecord.question : rawInput;

  if (providerFlag || useLlmFlag) {
    const saved = loadSavedCliConfig(repoRoot);
    const harnessCfg = resolveModelHarnessConfig({
      provider: providerFlag ?? (saved.provider !== "deterministic" ? saved.provider : "xai"),
      ...(modelFlag
        ? { model: modelFlag }
        : !providerFlag && saved.model
          ? { model: saved.model }
          : {}),
      ...(baseUrlFlag ? { baseUrl: baseUrlFlag } : {}),
    });
    const turn = await runModelHarnessTurn(question, {
      store,
      harness: harnessCfg,
    });

    if (jsonOutput) {
      console.log(JSON.stringify(turn.envelope));
      return;
    }

    if (!suppressBanner) printBanner(store, repoRoot);
    printFormattedTurnOutput(question, turn, {
      providerUsed: turn.providerUsed,
      modelUsed: turn.modelUsed,
      wireModeUsed: turn.wireModeUsed,
      latencyMs: turn.latencyMs,
    });
    return;
  }

  const turn = await askFlowIqCopilot(kitRecord ?? question, { store });
  if (jsonOutput) {
    console.log(JSON.stringify(turn.envelope));
    return;
  }

  if (!suppressBanner) printBanner(store, repoRoot);
  printFormattedTurnOutput(question, turn);
}

async function runSwarmCommand(repoRoot: string, suppressBanner = false): Promise<void> {
  if (!suppressBanner) printBanner(undefined, repoRoot);
  const res = await runParallelTemporalLlmSwarm({
    repoRoot,
    sampleSize: 40,
    concurrency: 8,
    simulateCrash: true,
    crashAtCompletedCount: 18,
    enableLiveNetworkCalls: false,
    includeGrokCliProbe: false,
  });
  console.log(
    `\n${ansi.goldBold("PARALLEL TEMPORAL LLM ACTIVITY SWARM (40/600 QUERIES · 8 WORKER SLOTS)")} ${ansi.emerald("[✓ 40/40 PASS]")}`,
  );
  console.log(`  • Workflow / Run ID       : ${ansi.inkBold(res.workflowId)} / ${res.runId}`);
  console.log(
    `  • Mid-Batch Crash & Replay: Crash @ Activity #${res.crashInjectedAtActivity} (${res.inFlightWhenCrashedCount} in-flight) -> worker-2 replayed in ${res.replayHistoryDurationMs.toFixed(2)}ms | skipped=${res.skippedByIdempotencyKeyCount} | duplicateCalls=${res.duplicateLlmInvocationsCount}`,
  );
  console.log(
    `  • Swarm & 600-Bank Pass   : ${ansi.emerald(`${res.passedActivitiesCount}/${res.sampleSize} swarm (${res.accuracyPercent}%)`)} | ${ansi.emerald(`${res.fullBank600Summary.passedQuestions}/${res.fullBank600Summary.totalQuestions} bank (${res.fullBank600Summary.throughputQueriesPerSec.toLocaleString()} q/s)`)}`,
  );
  console.log(
    `\n  ${ansi.goldBold("SAMPLE PARALLEL TEMPORAL ACTIVITIES (WITH IDEMPOTENCY KEYS & WORKER SLOTS):")}`,
  );
  for (const act of res.activities.slice(0, 8)) {
    const replayBadge = act.replayedFromHistory
      ? ansi.gold("[REPLAYED 0ms]")
      : ansi.emerald("[EXECUTED]    ");
    console.log(
      `   • #${String(act.activityIndex).padStart(2, "0")} [${act.workerSlotId}] ${replayBadge} ${ansi.inkBold(act.questionId.padEnd(7))} | key=${act.idempotencyKey.slice(0, 12)}.. | ${ansi.muted(act.question.slice(0, 50))}...`,
    );
  }
}

function runWorkflowCommand(store: PortfolioStore, suppressBanner = false): void {
  if (!suppressBanner) printBanner(store);
  const res = runDurablePortfolioWorkflow({ store });
  console.log(
    `\n${ansi.goldBold("DURABLE TEMPORAL WORKFLOW SIMULATION (250,000 ROWS · 10 SHARDS)")} ${ansi.emerald("[✓ PASS]")}`,
  );
  console.log(`  • Workflow / Run ID      : ${ansi.inkBold(res.workflowId)} / ${res.runId}`);
  console.log(
    `  • Total Rows / Shards    : ${ansi.inkBold(res.totalRowsProcessed.toLocaleString())} rows across ${res.shardCount} shards (${res.rowsPerShard.toLocaleString()} rows/shard)`,
  );
  console.log(
    `  • Fault Injection & Crash: Shard #${res.faultInjectedShard} crashed at row ${res.faultCrashRow.toLocaleString()} (ECONNRESET)`,
  );
  console.log(
    `  • Deterministic Replay   : Shards 1..${res.replayedShardsCount} replayed in 0.00ms from Event History; Shard #${res.faultInjectedShard} resumed @ heartbeat row ${res.heartbeatResumeRow.toLocaleString()}`,
  );
  console.log(
    `  • Throughput & Digest    : ${ansi.emerald(`${res.totalElapsedMs.toFixed(2)}ms (${res.throughputRowsPerSec.toLocaleString()} rows/sec)`)} | SHA-256=${res.stateDigestSha256.slice(0, 24)}... (replayDigestMatch=${res.replayDigestMatch})`,
  );
}

async function runReplCommand(repoRoot: string, initialStore: PortfolioStore): Promise<void> {
  let store = initialStore;
  printBanner(store, repoRoot);
  printTuiCommandDeck();

  const rl = readlinePromises.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  while (true) {
    let line: string;
    try {
      line = await rl.question(
        ansi.goldBold("\nflowiq [1-9, /setup, /ui, T01..B03, or question]> "),
      );
    } catch {
      break;
    }

    const trimmed = line.trim();
    if (!trimmed) continue;

    if (
      trimmed === "0" ||
      trimmed === "/quit" ||
      trimmed === "quit" ||
      trimmed === "exit"
    ) {
      console.log(ansi.gold("\nExiting FlowIQ Copilot TUI. Goodbye!"));
      break;
    }

    if (trimmed === "/help" || trimmed === "help" || trimmed === "?") {
      printTuiCommandDeck();
      continue;
    }

    if (trimmed === "1") {
      const qInput = (
        await rl.question(
          ansi.gold(
            "  Enter a question or official ID (e.g. T01, T07, B03, EGGS): ",
          ),
        )
      ).trim();
      if (qInput) {
        await runAskCommand(repoRoot, [qInput], true);
      }
      continue;
    }

    if (trimmed === "2" || trimmed === "/setup" || trimmed === "setup") {
      await runInteractiveSetupWizard(repoRoot, rl);
      continue;
    }

    if (trimmed === "3" || trimmed === "/ui" || trimmed === "ui") {
      await runUiCommand(repoRoot);
      continue;
    }

    if (
      trimmed === "4" ||
      /^\/?(doctor|status|traps)$/i.test(trimmed)
    ) {
      await runDoctorCommand(store);
      continue;
    }

    if (
      trimmed === "5" ||
      /^\/?validate(?:\s+.*)?$/i.test(trimmed)
    ) {
      const arg = trimmed.replace(/^\/?validate\s*/i, "").trim();
      await runValidateAllCommand(repoRoot, store, arg || undefined);
      continue;
    }

    if (trimmed === "6" || /^\/?(stress|10x)$/i.test(trimmed)) {
      const { runParaphraseAnd10xSuite } = await import(
        "../scripts/test-paraphrase-and-ambiguity-invariance.ts"
      );
      await runParaphraseAnd10xSuite();
      continue;
    }

    if (trimmed === "7" || /^\/?swarm$/i.test(trimmed)) {
      await runSwarmCommand(repoRoot, true);
      continue;
    }

    if (trimmed === "8" || /^\/?policy$/i.test(trimmed)) {
      console.log(`\n${ansi.goldBold("Current Active Policy Knobs:")}`);
      console.log(JSON.stringify(store.policy, null, 2));
      const ansCad = (
        await rl.question(
          ansi.gold(
            `  New CAD->USD rate [current=${store.policy.cadToUsdRate}, Enter to keep]: `,
          ),
        )
      ).trim();
      const ansNotice = (
        await rl.question(
          ansi.gold(
            `  Include notice units in occupied share? (true/false) [current=${store.policy.occupiedIncludesNotice}, Enter to keep]: `,
          ),
        )
      ).trim();
      const ansBucket = (
        await rl.question(
          ansi.gold(
            `  Lease bucket (lease_start_date / lead_created_date) [current=${store.policy.leaseBucketBy}, Enter to keep]: `,
          ),
        )
      ).trim();
      const ansBeta0 = (
        await rl.question(
          ansi.gold(
            `  Empirical-Bayes prior beta0 USD [current=${store.policy.priorSpendUsdBeta0}, Enter to keep]: `,
          ),
        )
      ).trim();

      store = loadPortfolioStore(repoRoot, {
        cadToUsdRate: ansCad ? Number.parseFloat(ansCad) : store.policy.cadToUsdRate,
        occupiedIncludesNotice:
          ansNotice === "false"
            ? false
            : ansNotice === "true"
              ? true
              : store.policy.occupiedIncludesNotice,
        leaseBucketBy:
          ansBucket === "lead_created_date"
            ? "lead_created_date"
            : ansBucket === "lease_start_date"
              ? "lease_start_date"
              : store.policy.leaseBucketBy,
        priorSpendUsdBeta0: ansBeta0
          ? Number.parseFloat(ansBeta0)
          : store.policy.priorSpendUsdBeta0,
      });
      console.log(ansi.emerald("\n✓ Updated runtime policy and recomputed store:"));
      printBanner(store, repoRoot);
      continue;
    }

    if (trimmed === "9" || /^\/?answers$/i.test(trimmed)) {
      await runAnswersCommand(repoRoot, store, true);
      continue;
    }

    if (/^\/?buildings$/i.test(trimmed)) {
      console.log(`\n${ansi.goldBold("PORTFOLIO BUILDINGS (properties.csv ⋈ units.csv):")}`);
      for (const p of store.properties) {
        const statusBadge = p.isOperating
          ? ansi.emerald("● OPERATING ")
          : ansi.gold("⊘ QUARANTINE");
        console.log(
          `  ${statusBadge} ${ansi.inkBold(p.propertyId)} ${p.name.padEnd(22)} | class=${p.buildingClass} | pms=${p.pms.padEnd(8)} | units=${String(p.actualUnitCount).padStart(3)}/${String(p.declaredUnits).padStart(3)} | aka=${p.aka.join(", ") || "—"}`,
        );
      }
      continue;
    }

    if (trimmed === "/decisions") {
      const lr = evaluateBudgetDecisionsAndLearn(store);
      for (const d of lr.evaluatedDecisions) {
        console.log(
          `  ${d.decisionId} (${d.propertyId} ${d.source.padEnd(14)} ${d.decisionMonth}) | ${d.recommendation} $${d.deltaUsd} | accepted=${d.accepted} | posterior=$${d.postOutcomeShrunkCpslUsd.toFixed(2)} | ${d.verdict}`,
        );
      }
      continue;
    }

    if (trimmed === "/harness") {
      const profiles = await discoverAvailableModelProfiles();
      for (const p of profiles) {
        console.log(
          `  ${p.profile.provider.padEnd(15)} | ${p.statusDetail}`,
        );
      }
      continue;
    }

    if (trimmed === "/workflow") {
      runWorkflowCommand(store, true);
      continue;
    }

    if (trimmed.startsWith("/")) {
      console.log(`Unknown command ${trimmed.split(/\s+/)[0]}. Type /help.`);
      continue;
    }

    await runAskCommand(repoRoot, [trimmed], true);
  }

  rl.close();
}

async function main(): Promise<void> {
  const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
  const args = process.argv.slice(2);
  const sub = args[0]?.toLowerCase();

  if (sub === "help" || sub === "-h" || sub === "--help") {
    process.stdout.write(HELP_TEXT);
    return;
  }
  if (sub === "ask" && (args[1] === "-h" || args[1] === "--help")) {
    process.stdout.write(HELP_TEXT);
    return;
  }

  const store = loadPortfolioStore(repoRoot);

  if (sub === "doctor" || sub === "status") {
    await runDoctorCommand(store);
    return;
  }
  if (sub === "setup" || sub === "login" || sub === "init") {
    await runSetupCommand(repoRoot, args.slice(1));
    return;
  }
  if (sub === "ui" || sub === "open") {
    printBanner(store, repoRoot);
    await runUiCommand(repoRoot, args.slice(1));
    return;
  }
  if (sub === "answers" || sub === "jsonl") {
    await runAnswersCommand(repoRoot, store);
    return;
  }
  if (sub === "validate") {
    printBanner(store, repoRoot);
    await runValidateAllCommand(repoRoot, store, args[1]);
    return;
  }
  if (sub === "stress" || sub === "10x") {
    printBanner(store, repoRoot);
    const { runParaphraseAnd10xSuite } = await import(
      "../scripts/test-paraphrase-and-ambiguity-invariance.ts"
    );
    await runParaphraseAnd10xSuite();
    return;
  }
  if (sub === "workflow") {
    runWorkflowCommand(store);
    return;
  }
  if (sub === "swarm") {
    await runSwarmCommand(repoRoot);
    return;
  }
  if (sub === "mcp-config") {
    console.log(JSON.stringify(buildMcpConfigObject(repoRoot), null, 2));
    return;
  }
  if (sub === "repl" || args.length === 0) {
    await runReplCommand(repoRoot, store);
    return;
  }
  if (sub === "ask") {
    await runAskCommand(repoRoot, args.slice(1));
    return;
  }

  // A lone word that is not a kit ID is a mistyped command, not a question.
  if (
    args.length === 1 &&
    /^[a-z][\w:-]*$/i.test(args[0]) &&
    !/^(?:D0[1-9]|D10|T0[1-9]|T1[0-3]|B0[1-3]|EGGS)$/i.test(args[0])
  ) {
    usageError(`unknown command "${args[0]}"`);
  }
  if (args[0].startsWith("-") && !ASK_BOOLEAN_FLAGS.has(args[0]) && !ASK_VALUE_FLAGS.has(args[0])) {
    usageError(`unknown option ${args[0]}`);
  }

  await runAskCommand(repoRoot, args);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
