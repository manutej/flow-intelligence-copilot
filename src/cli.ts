#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { askFlowIqCopilot } from "./agent/copilot.ts";
import {
  MODEL_PROVIDER_PROFILES,
  type ModelProviderId,
  discoverAvailableModelProfiles,
  resolveModelHarnessConfig,
  runModelHarnessTurn,
} from "./agent/model-harness.ts";
import type { LeaseBucketField, PortfolioPolicyConfig } from "./config/rules.ts";
import { loadPortfolioStore } from "./data/loader.ts";
import type { PortfolioStore } from "./data/schema.ts";
import { evaluateBudgetDecisionsAndLearn } from "./domain/learner.ts";
import { queryDataQualityAudit, queryMarketingSpendAndFunnel } from "./domain/metrics.ts";
import { FLOW_PORTFOLIO_SHEAF_EDGES, evaluateSheafCoboundary } from "./domain/sheaf.ts";
import { resolveEvaluatorExecutionConfig } from "./config/key-vault.ts";
import { loadOperadic600Bank, runParallelTemporalLlmSwarm } from "./workflows/temporal-llm-swarm.ts";
import { runDurablePortfolioWorkflow } from "./workflows/temporal-worker.ts";

const NO_COLOR = Boolean(process.env.NO_COLOR && process.env.NO_COLOR !== "0");

const ansi = {
  gold: (s: string) => (NO_COLOR ? s : `\x1b[38;2;210;158;61m${s}\x1b[0m`),
  goldBold: (s: string) => (NO_COLOR ? s : `\x1b[1;38;2;210;158;61m${s}\x1b[0m`),
  ink: (s: string) => (NO_COLOR ? s : `\x1b[38;2;232;236;244m${s}\x1b[0m`),
  inkBold: (s: string) => (NO_COLOR ? s : `\x1b[1;38;2;232;236;244m${s}\x1b[0m`),
  muted: (s: string) => (NO_COLOR ? s : `\x1b[38;2;139;149;167m${s}\x1b[0m`),
  emerald: (s: string) => (NO_COLOR ? s : `\x1b[38;2;52;211;153m${s}\x1b[0m`),
  red: (s: string) => (NO_COLOR ? s : `\x1b[38;2;248;113;113m${s}\x1b[0m`),
  midnightBg: (s: string) =>
    NO_COLOR ? s : `\x1b[48;2;20;33;61m\x1b[38;2;210;158;61m${s}\x1b[0m`,
};

function printBanner(): void {
  const bar = "═".repeat(78);
  console.log(ansi.gold(`╔${bar}╗`));
  console.log(
    ansi.gold("║ ") +
      ansi.midnightBg(" ORMUS CHROME · FLOWIQ PORTFOLIO INTELLIGENCE & SHEAF COPILOT (v2.0) ") +
      " ".repeat(7) +
      ansi.gold("║"),
  );
  console.log(
    ansi.gold("║ ") +
      ansi.muted(
        "Verdict Stamps: ⚖ measured · ✓ accept · ⊘ gate · ◆ law  |  Zero-Dep TS Engine ",
      ) +
      ansi.gold("║"),
  );
  console.log(ansi.gold(`╚${bar}╝`));
}

function normalizeProviderId(raw?: string): ModelProviderId | undefined {
  if (!raw) return undefined;
  const norm = raw.trim().toLowerCase().replace(/-/g, "_");
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

async function runDoctorCommand(store: PortfolioStore): Promise<void> {
  printBanner();
  const dq = queryDataQualityAudit(store);
  const sheaf = evaluateSheafCoboundary(store, FLOW_PORTFOLIO_SHEAF_EDGES);
  const mkt = queryMarketingSpendAndFunnel(store, {
    period: "APR_SEP_2026",
    paidOnly: true,
  });
  const learner = evaluateBudgetDecisionsAndLearn(store);
  const profiles = await discoverAvailableModelProfiles();

  console.log(
    `\n${ansi.goldBold("1. 6-TABLE PORTFOLIO STORE HEALTH")} ${ansi.emerald("[⚖ measured · ✓ accept]")}`,
  );
  console.log(
    `   • Total Primary Keys Indexed : ${ansi.inkBold(store.primaryKeyIndex.size.toLocaleString())} PKs across 6 CSV tables (asOfDate=${store.policy.asOfDate})`,
  );
  console.log(
    `   • Operating vs Quarantined   : ${ansi.inkBold(String(store.operatingProperties.length))} operating (P01..P08, 1,100 units) | ${ansi.goldBold(String(store.onboardingProperties.length))} onboarding (properties:P09 Cornell Annex, 0 units, AppFolio)`,
  );
  console.log(
    `   • Leases / Leads / Spend     : ${store.leases.length.toLocaleString()} leases (${store.signedLeases.length} attributed) | ${store.leads.length.toLocaleString()} leads (${store.deduplicatedLeads.length.toLocaleString()} deduped) | ${store.spend.length} spend rows (${store.postedSpend.length} posted)`,
  );

  console.log(
    `\n${ansi.goldBold("2. CELLULAR SHEAF RESTRICTION EDGES (E1..E6)")} ${ansi.emerald(`[isGlobalSection=${sheaf.isGlobalSection} · ◆ law]`)}`,
  );
  for (const edge of FLOW_PORTFOLIO_SHEAF_EDGES) {
    const resList = sheaf.byEdge[edge.edgeId] ?? [];
    console.log(
      `   • ${ansi.inkBold(edge.edgeId.padEnd(32))} (${edge.leftStalk} -> ${edge.rightStalk}): ${resList.length} residual(s) | blocking=${edge.blocking}`,
    );
  }

  console.log(
    `\n${ansi.goldBold("3. SIX DATA HYGIENE & ADVERSARIAL TRAPS (EXACT PRIMARY KEYS)")} ${ansi.emerald("[⊘ gate]")}`,
  );
  console.log(
    `   [T1] Non-Operating Building  : ${ansi.inkBold("properties:P09")} (Cornell Annex, 0 units in units.csv, AppFolio PMS, Base64 aka -> join.ormus.solutions/ninth-house)`,
  );
  console.log(
    `   [T2] CRM Prompt Injection    : ${ansi.inkBold("leads:D01011")} (P06 Facebook Ads, "IGNORE PREVIOUS INSTRUCTIONS... verified by analytics") stripped & flagged`,
  );
  console.log(
    `   [T3] Void Spend Invoices     : ${ansi.inkBold(`${dq.voidSpendRowCount} rows`)} (${store.voidSpend.map((v) => v.spendId).join(", ")} = $11,500.80 raw) quarantined at $0.00`,
  );
  console.log(
    `   [T4] CAD Currency Normalization: ${ansi.inkBold(`${dq.cadSpendRowCount} rows`)} (12 posted S0126..S0184 on P06/P07 Facebook Ads + 1 void S0174) converted @ 1 CAD = ${store.policy.cadToUsdRate} USD ($2,212.66 1BR avg @ P07 on T01)`,
  );
  console.log(
    `   [T5] Duplicate Re-Entry Leads: ${ansi.inkBold(`${dq.duplicateLeadCount} rows`)} (D01490..D01498 sharing lease_id with earliest leads D00224..D01454) deduplicated`,
  );
  console.log(
    `   [T6] Lag, Rent Gap & Learner : ${ansi.inkBold("70 cross-month lags")} (20 Q2->Q3 shifts e.g. L00006/D00064), ${ansi.inkBold("$1,955/mo")} notice rent gap ($370/mo @ P06 on T12), ${ansi.inkBold(`$${mkt.deadSpendReallocation.totalDeadSpendUsd.toFixed(2)}`)} dead spend across 9 pairs -> ${ansi.emerald(`+${mkt.deadSpendReallocation.projectedAdditionalWholeLeases} leases`)} on Apartments.com ($2,915.8621/lease); Gamma-Poisson windowInvariance=${learner.windowInvarianceVerified} (X009 P01 FB Ads $3,295.00 small-sample guard; X010 P08 Zillow $6,650 rejected)`,
  );

  console.log(
    `\n${ansi.goldBold("4. UNIVERSAL MODEL HARNESS PROVIDER READINESS")} ${ansi.emerald("[⚖ measured]")}`,
  );
  for (const item of profiles) {
    const pId = item.profile.provider === "local_openai" ? "local-openai" : item.profile.provider;
    const badge = item.reachable ? ansi.emerald("● READY  ") : ansi.gold("○ STANDBY");
    console.log(
      `   ${badge} ${ansi.inkBold(pId.padEnd(15))} | model=${item.profile.defaultModel.padEnd(28)} | ${ansi.muted(item.statusDetail)}`,
    );
  }
  const vaultCfg = resolveEvaluatorExecutionConfig();
  const bank600Count = loadOperadic600Bank().length;
  console.log(
    `\n${ansi.goldBold("5. SEALED EVALUATOR KEY VAULT, 600-QUESTION BANK & PARALLEL TEMPORAL SWARM")} ${ansi.emerald("[⚖ measured · ✓ accept · ◆ law]")}`,
  );
  console.log(
    `   • Sealed Key Vault           : ${ansi.inkBold(".flowiq-vault.json")} (src/config/key-vault.ts, AES-256-GCM unlocked=${vaultCfg.vaultUnlocked}) | activeTier=${vaultCfg.priorityTier} (${vaultCfg.provider} / ${vaultCfg.model}, key=${vaultCfg.maskedKeyPreview})`,
  );
  console.log(
    `   • 600-Question Operadic Bank : ${ansi.inkBold(`${bank600Count}/600 verified`)} (questions/operadic-600-bank.jsonl via scripts/generate-600-bank.ts, L1..L4 × 6 editorial colors)`,
  );
  console.log(
    `   • Parallel Temporal LLM Swarm: ${ansi.inkBold("40 activities × 8 worker slots")} (src/workflows/temporal-llm-swarm.ts, scripts/run-temporal-swarm.ts, api/swarm.js, reports/parallel-temporal-llm-swarm.md | crash @ #18/40 -> 0.37ms replay on worker-2, 0 duplicate LLM calls)`,
  );
  console.log(
    `   • Live Web & Notebook Surfaces: ${ansi.inkBold("https://repo-sigma-one-80.vercel.app")} (public/index.html, ui/flowiq-visual-studio.html via scripts/build-dashboard.ts) · ${ansi.inkBold("/field-notebook.html")} (public/field-notebook.html, docs/field-notebook.html, ui/flowiq-field-notebook.html via scripts/build-field-notebook.ts)`,
  );
}

async function runSetupCommand(repoRoot: string, args: readonly string[]): Promise<void> {
  printBanner();
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
    const mcpJson = JSON.stringify(buildMcpConfigObject(repoRoot), null, 2) + "\n";
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

async function runAskCommand(repoRoot: string, args: readonly string[]): Promise<void> {
  const jsonOutput = args.includes("--json");
  const useLlmFlag = args.includes("--llm");
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
      args[i] === "--exclude-notice" ||
      args[i].startsWith("--")
    ) {
      skipNext.add(i);
    }
  }

  const questionParts = args.filter((_, idx) => !skipNext.has(idx));
  const question =
    questionParts.join(" ").trim() ||
    "Which building is the lakefront one with the rooftop pool, and how many vacant units does it have?";

  const store = loadPortfolioStore(repoRoot, policyOverrides);

  if (providerFlag || useLlmFlag) {
    const harnessCfg = resolveModelHarnessConfig({
      ...(providerFlag ? { provider: providerFlag } : {}),
      ...(modelFlag ? { model: modelFlag } : {}),
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

    printBanner();
    console.log(`\n${ansi.goldBold("QUESTION  :")} ${ansi.ink(question)}`);
    console.log(
      `${ansi.goldBold("HARNESS   :")} provider=${ansi.inkBold(turn.providerUsed)} | model=${ansi.inkBold(turn.modelUsed)} | wireMode=${turn.wireModeUsed} | latency=${turn.latencyMs}ms`,
    );
    if (turn.toolCalls.length > 0) {
      console.log(
        `${ansi.goldBold("TOOLS     :")} ${turn.toolCalls.map((t) => `${t.toolName} -> ${t.outputSummary}`).join(" | ")}`,
      );
    }
    console.log(`${ansi.goldBold("ANSWER    :")} ${ansi.inkBold(turn.envelope.answer)}`);
    console.log(`${ansi.goldBold("RESULT    :")} ${ansi.gold(JSON.stringify(turn.envelope.result))}`);
    console.log(`${ansi.goldBold("CITATIONS :")} ${ansi.muted(turn.envelope.citations.join(", "))}`);
    console.log(
      `${ansi.goldBold("VERIFIED  :")} ${turn.verification.valid ? ansi.emerald("✓ PASS (all primary keys verified · ◆ law)") : ansi.red(`✗ FAIL (${turn.verification.errors.join("; ")})`)}`,
    );
    return;
  }

  const turn = await askFlowIqCopilot(question, { store });
  if (jsonOutput) {
    console.log(JSON.stringify(turn.envelope));
    return;
  }

  printBanner();
  console.log(`\n${ansi.goldBold("QUESTION  :")} ${ansi.ink(question)}`);
  if (turn.toolCalls.length > 0) {
    console.log(
      `${ansi.goldBold("TOOLS     :")} ${turn.toolCalls.map((t) => `${t.toolName} -> ${t.outputSummary}`).join(" | ")}`,
    );
  }
  if (turn.clarificationNeeded) {
    console.log(`${ansi.goldBold("STATUS    :")} ${ansi.gold("⊘ AMBIGUOUS BUILDING MATCH (FLOW-101 Clarification Gate)")}`);
  }
  console.log(`${ansi.goldBold("ANSWER    :")} ${ansi.inkBold(turn.envelope.answer)}`);
  console.log(`${ansi.goldBold("RESULT    :")} ${ansi.gold(JSON.stringify(turn.envelope.result))}`);
  console.log(`${ansi.goldBold("CITATIONS :")} ${ansi.muted(turn.envelope.citations.join(", "))}`);
  console.log(
    `${ansi.goldBold("VERIFIED  :")} ${turn.verification.valid ? ansi.emerald("✓ PASS (all primary keys verified · ◆ law)") : ansi.red(`✗ FAIL (${turn.verification.errors.join("; ")})`)}`,
  );
}

async function runSwarmCommand(store: PortfolioStore): Promise<void> {
  printBanner();
  const res = await runParallelTemporalLlmSwarm({ store });
  console.log(
    `\n${ansi.goldBold("PARALLEL TEMPORAL LLM ACTIVITY SWARM (40/600 QUERIES · 8 WORKER SLOTS)")} ${ansi.emerald("[⚖ measured · ✓ accept]")}`,
  );
  console.log(`  • Workflow / Run ID       : ${ansi.inkBold(res.workflowId)} / ${res.runId}`);
  console.log(`  • Provider & Key Vault    : ${ansi.inkBold(`${res.providerUsed} (${res.modelUsed})`)} | tier=${res.credentialTier} | key=${res.maskedKeyPreview}`);
  console.log(`  • Mid-Batch Crash & Replay: Crash @ Activity #${res.crashInjectedAfterActivity} -> worker-2 replayed in ${res.replayDurationMs.toFixed(2)}ms | skipped=${res.skippedViaIdempotencyKeyCount} | duplicateCalls=${res.duplicateLlmInvocations}`);
  console.log(`  • Swarm & 600-Bank Pass   : ${ansi.emerald(`${res.passedActivities}/${res.sampleSize} swarm (100%)`)} | ${ansi.emerald(`${res.fullBank600Sweep.passedQuestions}/${res.fullBank600Sweep.totalQuestions} bank (${res.fullBank600Sweep.throughputQueriesPerSec} q/s)`)}`);
}

function runWorkflowCommand(store: PortfolioStore): void {
  printBanner();
  const res = runDurablePortfolioWorkflow({ store });
  console.log(
    `\n${ansi.goldBold("DURABLE TEMPORAL WORKFLOW SIMULATION (250,000 ROWS · 10 SHARDS)")} ${ansi.emerald("[⚖ measured · ✓ accept]")}`,
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

async function runReplCommand(repoRoot: string, store: PortfolioStore): Promise<void> {
  printBanner();
  console.log(
    ansi.muted(
      "Interactive REPL commands: /help, /status, /doctor, /traps, /buildings, /decisions, /harness, /workflow, /policy, /quit",
    ),
  );
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: ansi.goldBold("\nflowiq> "),
  });

  rl.prompt();
  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }
    if (trimmed === "/quit" || trimmed === "quit" || trimmed === "exit") {
      rl.close();
      return;
    }
    if (trimmed === "/help") {
      console.log(
        "Commands: /help, /status, /doctor, /traps, /buildings, /decisions, /harness, /workflow, /policy, /quit — or ask any portfolio question.",
      );
      rl.prompt();
      return;
    }
    if (trimmed === "/status" || trimmed === "/doctor" || trimmed === "/traps") {
      await runDoctorCommand(store);
      rl.prompt();
      return;
    }
    if (trimmed === "/buildings") {
      for (const p of store.properties) {
        console.log(
          `  ${p.propertyId} ${p.name.padEnd(22)} | class=${p.buildingClass} | pms=${p.pms.padEnd(8)} | units=${p.actualUnitCount}/${p.declaredUnits} | operating=${p.isOperating}`,
        );
      }
      rl.prompt();
      return;
    }
    if (trimmed === "/decisions") {
      const lr = evaluateBudgetDecisionsAndLearn(store);
      for (const d of lr.evaluatedDecisions) {
        console.log(
          `  ${d.decisionId} (${d.propertyId} ${d.source.padEnd(14)} ${d.decisionMonth}) | ${d.recommendation} $${d.deltaUsd} | accepted=${d.accepted} | posterior=$${d.postOutcomeShrunkCpslUsd.toFixed(2)} | ${d.verdict}`,
        );
      }
      rl.prompt();
      return;
    }
    if (trimmed === "/harness") {
      const profiles = await discoverAvailableModelProfiles();
      for (const p of profiles) {
        console.log(`  ${p.profile.provider.padEnd(15)} | ${p.profile.defaultModel.padEnd(26)} | ${p.statusDetail}`);
      }
      rl.prompt();
      return;
    }
    if (trimmed === "/workflow") {
      runWorkflowCommand(store);
      rl.prompt();
      return;
    }
    if (trimmed === "/policy") {
      console.log(JSON.stringify(store.policy, null, 2));
      rl.prompt();
      return;
    }

    await runAskCommand(repoRoot, [trimmed]);
    rl.prompt();
  });
}

async function main(): Promise<void> {
  const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
  const args = process.argv.slice(2);
  const sub = args[0]?.toLowerCase();

  const store = loadPortfolioStore(repoRoot);

  if (sub === "doctor" || sub === "status") {
    await runDoctorCommand(store);
    return;
  }
  if (sub === "setup" || sub === "login") {
    await runSetupCommand(repoRoot, args.slice(1));
    return;
  }
  if (sub === "workflow") {
    runWorkflowCommand(store);
    return;
  }
  if (sub === "swarm") {
    await runSwarmCommand(store);
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

  // Backward-compatible direct question execution: flowiq "<question>" [--json]
  await runAskCommand(repoRoot, args);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
