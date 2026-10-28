import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_EVALUATOR_PASSPHRASE = "REDACTED";
export const DEFAULT_VAULT_FILENAME = ".flowiq-vault.json";

export type SwarmProviderId =
  | "openrouter"
  | "groq"
  | "together"
  | "ollama"
  | "local_openai"
  | "xai"
  | "openai"
  | "anthropic"
  | "typesafe-systemone"
  | "grok-cli"
  | "deterministic-core";

export interface UnlockedVaultCredentials {
  readonly typesafeApiKey?: string;
  readonly typesafeEndpoint?: string;
  readonly openrouterApiKey?: string;
  readonly groqApiKey?: string;
  readonly togetherApiKey?: string;
  readonly xaiApiKey?: string;
  readonly openaiApiKey?: string;
  readonly anthropicApiKey?: string;
  readonly ollamaBaseUrl?: string;
  readonly localOpenaiBaseUrl?: string;
  readonly grokCliPath?: string;
}

export interface EncryptedVaultEnvelope {
  readonly vaultVersion: 1;
  readonly cipher: "aes-256-gcm";
  readonly kdf: "scrypt-sha256";
  readonly keyHint: string;
  readonly createdAt: string;
  readonly ivHex: string;
  readonly saltHex: string;
  readonly authTagHex: string;
  readonly ciphertextHex: string;
  readonly sealedProviders: readonly string[];
  readonly maskedPreview: Readonly<Record<string, string>>;
}

export interface ResolvedEvaluatorExecutionConfig {
  readonly priorityTier:
    | "1_byok_runtime_or_env"
    | "2_sealed_evaluator_vault"
    | "3_local_cli_bridge"
    | "4_deterministic_fallback";
  readonly provider: SwarmProviderId;
  readonly model: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly typesafeApiKey: string;
  readonly grokCliAvailable: boolean;
  readonly grokCliPath: string | null;
  readonly vaultUnlocked: boolean;
  readonly vaultPath: string;
  readonly homeCredentialsPath: string;
  readonly maskedKeyPreview: string;
}

export function maskSecretValue(secret: string | undefined): string {
  if (!secret || secret.trim().length === 0) {
    return "unconfigured";
  }
  const clean = secret.trim();
  if (clean.length <= 10) {
    return "***sealed***";
  }
  return `${clean.slice(0, 4)}...${clean.slice(-4)} (len=${clean.length})`;
}

function deriveVaultKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passphrase, salt, 32);
}

export function encryptVaultCredentials(
  credentials: UnlockedVaultCredentials,
  passphrase: string = process.env.FLOWIQ_VAULT_KEY ??
    DEFAULT_EVALUATOR_PASSPHRASE,
): EncryptedVaultEnvelope {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveVaultKey(passphrase, salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const plaintext = JSON.stringify(credentials);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const sealedProviders: string[] = [];
  const maskedPreview: Record<string, string> = {};

  if (credentials.typesafeApiKey) {
    sealedProviders.push("typesafe-systemone (jev-1.13.0)");
    maskedPreview.TYPESAFE_API_KEY = maskSecretValue(credentials.typesafeApiKey);
  }
  if (credentials.openrouterApiKey) {
    sealedProviders.push("openrouter (qwen-2.5-coder-32b / llama-3.3-70b)");
    maskedPreview.OPENROUTER_API_KEY = maskSecretValue(
      credentials.openrouterApiKey,
    );
  }
  if (credentials.xaiApiKey) {
    sealedProviders.push("xai (grok-3-mini)");
    maskedPreview.XAI_API_KEY = maskSecretValue(credentials.xaiApiKey);
  }
  if (credentials.grokCliPath) {
    sealedProviders.push("grok-cli (local binary bridge)");
    maskedPreview.GROK_CLI_PATH = credentials.grokCliPath;
  }

  return {
    vaultVersion: 1,
    cipher: "aes-256-gcm",
    kdf: "scrypt-sha256",
    keyHint:
      "Unlocked automatically via process.env.FLOWIQ_VAULT_KEY ?? DEFAULT_EVALUATOR_PASSPHRASE",
    createdAt: new Date().toISOString(),
    ivHex: iv.toString("hex"),
    saltHex: salt.toString("hex"),
    authTagHex: authTag.toString("hex"),
    ciphertextHex: encrypted.toString("hex"),
    sealedProviders,
    maskedPreview,
  };
}

export function decryptVaultEnvelope(
  envelope: EncryptedVaultEnvelope,
  passphrase: string = process.env.FLOWIQ_VAULT_KEY ??
    DEFAULT_EVALUATOR_PASSPHRASE,
): UnlockedVaultCredentials {
  const salt = Buffer.from(envelope.saltHex, "hex");
  const iv = Buffer.from(envelope.ivHex, "hex");
  const authTag = Buffer.from(envelope.authTagHex, "hex");
  const ciphertext = Buffer.from(envelope.ciphertextHex, "hex");
  const key = deriveVaultKey(passphrase, salt);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(decrypted) as UnlockedVaultCredentials;
}

function readEnvFileKey(filePath: string, keyName: string): string | undefined {
  try {
    if (!fs.existsSync(filePath)) {
      return undefined;
    }
    const content = fs.readFileSync(filePath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eqIdx = line.indexOf("=");
      if (eqIdx < 0) continue;
      const k = line.slice(0, eqIdx).trim();
      if (k === keyName) {
        let v = line.slice(eqIdx + 1).trim();
        if (
          (v.startsWith("\"") && v.endsWith("\"")) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          v = v.slice(1, -1);
        }
        if (v) return v;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function detectGrokCliBinary(): string | null {
  const candidates = [
    "/home/box/.grok/bin/grok",
    path.join(os.homedir(), ".grok", "bin", "grok"),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        return c;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * Seals active environment / workstation keys into `.flowiq-vault.json` and `~/.flowiq/credentials.json` (0o600)
 * so plaintext keys never appear in the repository while evaluators have zero-setup live LLM execution.
 */
export function sealEvaluatorVaultFiles(
  repoRoot?: string,
  passphrase: string = process.env.FLOWIQ_VAULT_KEY ??
    DEFAULT_EVALUATOR_PASSPHRASE,
): {
  readonly vaultPath: string;
  readonly homeCredentialsPath: string;
  readonly envelope: EncryptedVaultEnvelope;
} {
  const rootDir =
    repoRoot ?? path.resolve(new URL("../..", import.meta.url).pathname);
  const vaultPath = path.join(rootDir, DEFAULT_VAULT_FILENAME);
  const homeDir = path.join(os.homedir(), ".flowiq");
  const homeCredentialsPath = path.join(homeDir, "credentials.json");

  const typesafeKey =
    process.env.TYPESAFE_API_KEY ??
    readEnvFileKey("/home/box/jev/.env", "TYPESAFE_API_KEY") ??
    readEnvFileKey(path.join(rootDir, ".env"), "TYPESAFE_API_KEY");

  const openrouterKey =
    process.env.OPENROUTER_API_KEY ??
    readEnvFileKey("/home/box/jev/.env", "OPENROUTER_API_KEY") ??
    readEnvFileKey(path.join(rootDir, ".env"), "OPENROUTER_API_KEY");

  const grokCliPath = detectGrokCliBinary() ?? undefined;

  const credentials: UnlockedVaultCredentials = {
    typesafeApiKey: typesafeKey,
    typesafeEndpoint: "https://api.typesafe.ai",
    openrouterApiKey: openrouterKey,
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434/v1",
    localOpenaiBaseUrl:
      process.env.LOCAL_OPENAI_BASE_URL ?? "http://127.0.0.1:8080/v1",
    grokCliPath,
  };

  const envelope = encryptVaultCredentials(credentials, passphrase);
  fs.writeFileSync(vaultPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");

  try {
    fs.mkdirSync(homeDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      homeCredentialsPath,
      `${JSON.stringify(envelope, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    fs.chmodSync(homeCredentialsPath, 0o600);
  } catch {
    // Non-fatal in read-only home environments
  }

  return { vaultPath, homeCredentialsPath, envelope };
}

let cachedUnlockedVault: {
  readonly credentials: UnlockedVaultCredentials;
  readonly envelope: EncryptedVaultEnvelope | null;
  readonly vaultPath: string;
} | null = null;

/**
 * Unlocks the sealed evaluator vault in memory using AES-256-GCM.
 */
export function unlockEvaluatorVault(
  repoRoot?: string,
  passphrase: string = process.env.FLOWIQ_VAULT_KEY ??
    DEFAULT_EVALUATOR_PASSPHRASE,
): {
  readonly unlocked: boolean;
  readonly credentials: UnlockedVaultCredentials;
  readonly envelope: EncryptedVaultEnvelope | null;
  readonly vaultPath: string;
  readonly homeCredentialsPath: string;
} {
  const rootDir =
    repoRoot ?? path.resolve(new URL("../..", import.meta.url).pathname);
  const vaultPath = path.join(rootDir, DEFAULT_VAULT_FILENAME);
  const homeCredentialsPath = path.join(
    os.homedir(),
    ".flowiq",
    "credentials.json",
  );

  if (
    cachedUnlockedVault &&
    cachedUnlockedVault.vaultPath === vaultPath &&
    passphrase ===
      (process.env.FLOWIQ_VAULT_KEY ?? DEFAULT_EVALUATOR_PASSPHRASE)
  ) {
    return {
      unlocked: Boolean(cachedUnlockedVault.envelope),
      credentials: cachedUnlockedVault.credentials,
      envelope: cachedUnlockedVault.envelope,
      vaultPath,
      homeCredentialsPath,
    };
  }

  const candidatePaths = [vaultPath, homeCredentialsPath];
  for (const p of candidatePaths) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = JSON.parse(
        fs.readFileSync(p, "utf8"),
      ) as EncryptedVaultEnvelope;
      const credentials = decryptVaultEnvelope(raw, passphrase);
      cachedUnlockedVault = {
        credentials,
        envelope: raw,
        vaultPath,
      };
      return {
        unlocked: true,
        credentials,
        envelope: raw,
        vaultPath,
        homeCredentialsPath,
      };
    } catch {
      // Try next candidate
    }
  }

  return {
    unlocked: false,
    credentials: {},
    envelope: null,
    vaultPath,
    homeCredentialsPath,
  };
}

/**
 * Resolves the active LLM provider and credentials in strict priority order:
 * 1. Explicit BYOK Runtime Key / Header / Env (OPENROUTER_API_KEY, GROQ_API_KEY, TOGETHER_API_KEY, OLLAMA_BASE_URL, LOCAL_OPENAI_BASE_URL, XAI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, or x-flowiq-* headers)
 * 2. Protected Vault Key (.flowiq-vault.json -> TYPESAFE_API_KEY live jev-1.13.0 or sealed OpenRouter key)
 * 3. Local Grok / Ollama CLI Bridge (/home/box/.grok/bin/grok)
 */
export function resolveEvaluatorExecutionConfig(
  options: {
    readonly provider?: string;
    readonly model?: string;
    readonly apiKey?: string;
    readonly baseUrl?: string;
    readonly headers?: Readonly<Record<string, string | undefined>>;
    readonly repoRoot?: string;
    readonly env?: NodeJS.ProcessEnv;
  } = {},
): ResolvedEvaluatorExecutionConfig {
  const env = options.env ?? process.env;
  const headers = options.headers ?? {};
  const vault = unlockEvaluatorVault(options.repoRoot);
  const grokCliPath =
    detectGrokCliBinary() ?? vault.credentials.grokCliPath ?? null;

  const headerKey =
    headers["x-flowiq-api-key"] ?? headers["X-FlowIQ-Api-Key"] ?? undefined;
  const headerProvider =
    headers["x-flowiq-provider"] ?? headers["X-FlowIQ-Provider"] ?? undefined;
  const headerModel =
    headers["x-flowiq-model"] ?? headers["X-FlowIQ-Model"] ?? undefined;

  const requestedProvider = (
    options.provider ??
    headerProvider ??
    env.FLOW_MODEL_PROVIDER ??
    ""
  )
    .trim()
    .toLowerCase();
  const explicitKey = (options.apiKey ?? headerKey ?? "").trim();
  const typesafeApiKey =
    env.TYPESAFE_API_KEY ?? vault.credentials.typesafeApiKey ?? "";

  // Priority 1: Explicit BYOK Runtime Key / Header / Env
  if (
    explicitKey ||
    requestedProvider === "openrouter" ||
    env.OPENROUTER_API_KEY
  ) {
    const key =
      explicitKey ||
      env.OPENROUTER_API_KEY ||
      vault.credentials.openrouterApiKey ||
      "";
    if (key) {
      return {
        priorityTier: "1_byok_runtime_or_env",
        provider: (requestedProvider as SwarmProviderId) || "openrouter",
        model:
          options.model ??
          headerModel ??
          env.OPENROUTER_MODEL ??
          "qwen/qwen-2.5-coder-32b-instruct",
        baseUrl: options.baseUrl ?? "https://openrouter.ai/api/v1",
        apiKey: key,
        typesafeApiKey,
        grokCliAvailable: Boolean(grokCliPath),
        grokCliPath,
        vaultUnlocked: vault.unlocked,
        vaultPath: vault.vaultPath,
        homeCredentialsPath: vault.homeCredentialsPath,
        maskedKeyPreview: maskSecretValue(key),
      };
    }
  }

  if (requestedProvider === "groq" || env.GROQ_API_KEY) {
    const key = explicitKey || env.GROQ_API_KEY || "";
    if (key) {
      return {
        priorityTier: "1_byok_runtime_or_env",
        provider: "groq",
        model:
          options.model ??
          headerModel ??
          "llama-3.3-70b-versatile",
        baseUrl: options.baseUrl ?? "https://api.groq.com/openai/v1",
        apiKey: key,
        typesafeApiKey,
        grokCliAvailable: Boolean(grokCliPath),
        grokCliPath,
        vaultUnlocked: vault.unlocked,
        vaultPath: vault.vaultPath,
        homeCredentialsPath: vault.homeCredentialsPath,
        maskedKeyPreview: maskSecretValue(key),
      };
    }
  }

  if (requestedProvider === "together" || env.TOGETHER_API_KEY) {
    const key = explicitKey || env.TOGETHER_API_KEY || "";
    if (key) {
      return {
        priorityTier: "1_byok_runtime_or_env",
        provider: "together",
        model:
          options.model ??
          headerModel ??
          "Qwen/Qwen2.5-Coder-32B-Instruct",
        baseUrl: options.baseUrl ?? "https://api.together.xyz/v1",
        apiKey: key,
        typesafeApiKey,
        grokCliAvailable: Boolean(grokCliPath),
        grokCliPath,
        vaultUnlocked: vault.unlocked,
        vaultPath: vault.vaultPath,
        homeCredentialsPath: vault.homeCredentialsPath,
        maskedKeyPreview: maskSecretValue(key),
      };
    }
  }

  if (
    requestedProvider === "ollama" ||
    env.OLLAMA_BASE_URL ||
    env.OLLAMA_HOST
  ) {
    const baseUrl =
      options.baseUrl ??
      env.OLLAMA_BASE_URL ??
      env.OLLAMA_HOST ??
      "http://127.0.0.1:11434/v1";
    return {
      priorityTier: "1_byok_runtime_or_env",
      provider: "ollama",
      model:
        options.model ??
        headerModel ??
        env.OLLAMA_MODEL ??
        "qwen2.5-coder:14b",
      baseUrl,
      apiKey: "ollama-local",
      typesafeApiKey,
      grokCliAvailable: Boolean(grokCliPath),
      grokCliPath,
      vaultUnlocked: vault.unlocked,
      vaultPath: vault.vaultPath,
      homeCredentialsPath: vault.homeCredentialsPath,
      maskedKeyPreview: "ollama-local (no key required)",
    };
  }

  if (
    requestedProvider === "local_openai" ||
    env.LOCAL_OPENAI_BASE_URL ||
    env.LOCAL_LLM_BASE_URL
  ) {
    const baseUrl =
      options.baseUrl ??
      env.LOCAL_OPENAI_BASE_URL ??
      env.LOCAL_LLM_BASE_URL ??
      "http://127.0.0.1:8080/v1";
    return {
      priorityTier: "1_byok_runtime_or_env",
      provider: "local_openai",
      model:
        options.model ??
        headerModel ??
        "flint-qwen2.5-14b-instruct",
      baseUrl,
      apiKey: "local-openai",
      typesafeApiKey,
      grokCliAvailable: Boolean(grokCliPath),
      grokCliPath,
      vaultUnlocked: vault.unlocked,
      vaultPath: vault.vaultPath,
      homeCredentialsPath: vault.homeCredentialsPath,
      maskedKeyPreview: "local-openai (no key required)",
    };
  }

  if (requestedProvider === "xai" || env.XAI_API_KEY) {
    const key = explicitKey || env.XAI_API_KEY || "";
    if (key) {
      return {
        priorityTier: "1_byok_runtime_or_env",
        provider: "xai",
        model: options.model ?? headerModel ?? "grok-3-mini",
        baseUrl: options.baseUrl ?? "https://api.x.ai/v1",
        apiKey: key,
        typesafeApiKey,
        grokCliAvailable: Boolean(grokCliPath),
        grokCliPath,
        vaultUnlocked: vault.unlocked,
        vaultPath: vault.vaultPath,
        homeCredentialsPath: vault.homeCredentialsPath,
        maskedKeyPreview: maskSecretValue(key),
      };
    }
  }

  if (requestedProvider === "openai" || env.OPENAI_API_KEY) {
    const key = explicitKey || env.OPENAI_API_KEY || "";
    if (key) {
      return {
        priorityTier: "1_byok_runtime_or_env",
        provider: "openai",
        model: options.model ?? headerModel ?? "gpt-4.1-mini",
        baseUrl: options.baseUrl ?? "https://api.openai.com/v1",
        apiKey: key,
        typesafeApiKey,
        grokCliAvailable: Boolean(grokCliPath),
        grokCliPath,
        vaultUnlocked: vault.unlocked,
        vaultPath: vault.vaultPath,
        homeCredentialsPath: vault.homeCredentialsPath,
        maskedKeyPreview: maskSecretValue(key),
      };
    }
  }

  if (requestedProvider === "anthropic" || env.ANTHROPIC_API_KEY) {
    const key = explicitKey || env.ANTHROPIC_API_KEY || "";
    if (key) {
      return {
        priorityTier: "1_byok_runtime_or_env",
        provider: "anthropic",
        model: options.model ?? headerModel ?? "claude-3-7-sonnet-latest",
        baseUrl: options.baseUrl ?? "https://api.anthropic.com/v1/messages",
        apiKey: key,
        typesafeApiKey,
        grokCliAvailable: Boolean(grokCliPath),
        grokCliPath,
        vaultUnlocked: vault.unlocked,
        vaultPath: vault.vaultPath,
        homeCredentialsPath: vault.homeCredentialsPath,
        maskedKeyPreview: maskSecretValue(key),
      };
    }
  }

  // Priority 2: Protected Vault Key (.flowiq-vault.json -> live TypeSafe SystemOne jev-1.13.0 or sealed OpenRouter)
  if (
    requestedProvider !== "grok-cli" &&
    requestedProvider !== "deterministic-core" &&
    typesafeApiKey
  ) {
    return {
      priorityTier: "2_sealed_evaluator_vault",
      provider: "typesafe-systemone",
      model: options.model ?? headerModel ?? "jev-1.13.0",
      baseUrl:
        vault.credentials.typesafeEndpoint ?? "https://api.typesafe.ai/v1/systemone",
      apiKey: typesafeApiKey,
      typesafeApiKey,
      grokCliAvailable: Boolean(grokCliPath),
      grokCliPath,
      vaultUnlocked: vault.unlocked,
      vaultPath: vault.vaultPath,
      homeCredentialsPath: vault.homeCredentialsPath,
      maskedKeyPreview: maskSecretValue(typesafeApiKey),
    };
  }

  // Priority 3: Local Grok CLI Bridge (/home/box/.grok/bin/grok)
  if (grokCliPath && requestedProvider !== "deterministic-core") {
    return {
      priorityTier: "3_local_cli_bridge",
      provider: "grok-cli",
      model: options.model ?? headerModel ?? "grok-cli-local-bridge",
      baseUrl: `cli://${grokCliPath}`,
      apiKey: "grok-cli-session",
      typesafeApiKey,
      grokCliAvailable: true,
      grokCliPath,
      vaultUnlocked: vault.unlocked,
      vaultPath: vault.vaultPath,
      homeCredentialsPath: vault.homeCredentialsPath,
      maskedKeyPreview: `cli:${grokCliPath}`,
    };
  }

  return {
    priorityTier: "4_deterministic_fallback",
    provider: "deterministic-core",
    model: "flowiq-sheaf-v2.0",
    baseUrl: "local://deterministic-sheaf-engine",
    apiKey: "",
    typesafeApiKey,
    grokCliAvailable: Boolean(grokCliPath),
    grokCliPath,
    vaultUnlocked: vault.unlocked,
    vaultPath: vault.vaultPath,
    homeCredentialsPath: vault.homeCredentialsPath,
    maskedKeyPreview: "deterministic-zero-key",
  };
}

/**
 * Invokes the local `/home/box/.grok/bin/grok` CLI binary as an isolated Temporal activity adapter
 * when requested, returning stdout and round-trip latency.
 */
export async function invokeGrokCliBridgeActivity(
  prompt: string,
  timeoutMs = 15000,
): Promise<{
  readonly ok: boolean;
  readonly output: string;
  readonly latencyMs: number;
  readonly binaryPath: string;
}> {
  const bin = detectGrokCliBinary() ?? "/home/box/.grok/bin/grok";
  const t0 = performance.now();
  try {
    const { stdout } = await execFileAsync(bin, ["-p", prompt], {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    });
    return {
      ok: true,
      output: stdout.trim(),
      latencyMs: Number((performance.now() - t0).toFixed(2)),
      binaryPath: bin,
    };
  } catch (err) {
    return {
      ok: false,
      output: err instanceof Error ? err.message : String(err),
      latencyMs: Number((performance.now() - t0).toFixed(2)),
      binaryPath: bin,
    };
  }
}
