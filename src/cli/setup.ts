/**
 * The setup wizard: choose a model provider, check its /v1/models
 * endpoint, save the choice, and write the MCP config. Moved out of the
 * old single-file CLI with its behaviour unchanged; the output now uses
 * the shared Ormus style.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readlinePromises, { type Interface as ReadlineInterface } from "node:readline/promises";
import {
  MODEL_PROVIDER_PROFILES,
  type ModelProviderId,
  discoverAvailableModelProfiles,
  fetchLiveModelsForProvider,
  resolveModelHarnessConfig,
} from "../agent/model-harness.ts";
import { FLOWIQ_VERSION } from "../version.ts";
import { createStyle } from "./style.ts";

const style = createStyle();

/** Ormus palette: gold is the only accent; status is a word, never a colour. */
const ansi = {
  gold: style.gold,
  goldBright: style.goldBright,
  goldBold: style.gold,
  ink: style.ink,
  inkBold: style.strong,
  muted: style.muted,
  emerald: style.ink,
};

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

function printBanner(): void {
  for (const line of style.banner(FLOWIQ_VERSION)) console.log(line);
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

  console.log(`\n${ansi.goldBold("/ DASHBOARDS")}`);
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
        `\n${ansi.emerald("Opened public/index.html and public/field-notebook.html in your browser.")}`,
      );
    }
  }
}

async function runInteractiveSetupWizard(
  repoRoot: string,
  existingRl?: ReadlineInterface,
): Promise<void> {
  const ownRl =
    existingRl ??
    readlinePromises.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

  try {
    console.log(`
${style.label("Setup")}  ${style.dim("model provider, /v1/models probe, MCP config")}`);
    console.log(style.rule());

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
        ? ansi.emerald("READY             ")
        : status.configured
          ? ansi.gold("KEY SET           ")
          : ansi.muted("NOT CONFIGURED    ");
      console.log(
        `  ${ansi.goldBold(`[${c.key}]`)} ${ansi.inkBold(c.id.padEnd(14))} ${badge}  ${ansi.ink(status.profile.label)} (${ansi.muted(status.statusDetail)})`,
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
          `  ${ansi.emerald(`Connected: ${liveProbe.models.length} live models:`)} ${ansi.ink(liveProbe.models.slice(0, 8).join(", "))}`,
        );
      } else {
        console.log(`  ${ansi.gold(`Probe:`)} ${ansi.muted(liveProbe.statusDetail)}`);
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
      console.log(`  ${ansi.emerald(`Saved ${profile.envKeyName} to .env.local (gitignored)`)}`);
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

    console.log(`\n${ansi.emerald("FlowIQ Agent & Harness Configuration Saved:")}`);
    console.log(`  Provider   : ${ansi.inkBold(provider)} (${profile.label})`);
    console.log(`  Model      : ${ansi.inkBold(model)}`);
    console.log(`  Base URL   : ${ansi.inkBold(baseUrl)}`);
    console.log(`  Wire Mode  : ${ansi.inkBold(profile.wireMode)}`);
    console.log(`  Config File: ${ansi.muted(path.relative(repoRoot, configPath))}`);
    if (writeMcp) {
      console.log(
        `  Agent MCP  : ${ansi.emerald(".mcp.json & .cursor/mcp.json wired")}`,
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

export async function runSetupCommand(repoRoot: string, args: readonly string[]): Promise<void> {
  const isNonInteractive =
    args.includes("--non-interactive") ||
    args.includes("--provider") ||
    args.some((a) => a.startsWith("--provider=")) ||
    !process.stdin.isTTY;

  if (!isNonInteractive) {
    printBanner();
    await runInteractiveSetupWizard(repoRoot);
    return;
  }

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
    const mcpJson = `${JSON.stringify(buildMcpConfigObject(repoRoot), null, 2)}\n`;
    fs.writeFileSync(path.join(repoRoot, ".mcp.json"), mcpJson, "utf-8");
    const cursorDir = path.join(repoRoot, ".cursor");
    fs.mkdirSync(cursorDir, { recursive: true });
    fs.writeFileSync(path.join(cursorDir, "mcp.json"), mcpJson, "utf-8");
  }

  console.log(`\n${ansi.emerald("FlowIQ Harness & MCP Configuration Saved")}`);
  console.log(`  Provider   : ${ansi.inkBold(provider)} (${profile.label})`);
  console.log(`  Model      : ${ansi.inkBold(model)}`);
  console.log(`  Base URL   : ${ansi.inkBold(baseUrl)}`);
  console.log(`  Config File: ${ansi.muted(path.relative(repoRoot, configPath))}`);
  if (writeMcp) {
    console.log(`  MCP Configs: ${ansi.muted(".mcp.json & .cursor/mcp.json updated")}`);
  }
}
