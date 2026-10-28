import fs from "node:fs";
import path from "node:path";
import { resolveEvaluatorExecutionConfig } from "../src/config/key-vault.ts";
import {
  runParallelTemporalLlmSwarm,
  writeTemporalLlmSwarmArtifacts,
} from "../src/workflows/temporal-llm-swarm.ts";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-flowiq-api-key, x-flowiq-provider, x-flowiq-model",
  );

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
    const tracePath = path.join(
      repoRoot,
      ".toq",
      "flow-copilot",
      "temporal-llm-swarm-trace.json",
    );

    if (req.method === "GET") {
      const urlObj = new URL(req.url || "/", "http://localhost");
      const params = Object.fromEntries(urlObj.searchParams.entries());

      if (params.fresh !== "true" && fs.existsSync(tracePath)) {
        const cached = JSON.parse(fs.readFileSync(tracePath, "utf8"));
        const execConfig = resolveEvaluatorExecutionConfig({
          headers: req.headers || {},
          repoRoot,
        });
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(
          JSON.stringify({
            ok: true,
            source: "cached_trace",
            currentVaultResolution: {
              priorityTier: execConfig.priorityTier,
              provider: execConfig.provider,
              model: execConfig.model,
              vaultUnlocked: execConfig.vaultUnlocked,
              maskedKeyPreview: execConfig.maskedKeyPreview,
              grokCliAvailable: execConfig.grokCliAvailable,
            },
            ...cached,
          }),
        );
        return;
      }
    }

    let body = {};
    if (req.method === "POST") {
      if (req.body && typeof req.body === "object") {
        body = req.body;
      } else if (typeof req.body === "string" && req.body.trim()) {
        body = JSON.parse(req.body);
      } else {
        const chunks = [];
        for await (const chunk of req) {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        }
        const rawStr = Buffer.concat(chunks).toString("utf-8").trim();
        if (rawStr) body = JSON.parse(rawStr);
      }
    } else {
      const urlObj = new URL(req.url || "/", "http://localhost");
      body = Object.fromEntries(urlObj.searchParams.entries());
    }

    const sampleSize = body.sampleSize
      ? Math.min(600, Math.max(8, Number.parseInt(String(body.sampleSize), 10)))
      : 40;
    const concurrency = body.concurrency
      ? Math.min(32, Math.max(1, Number.parseInt(String(body.concurrency), 10)))
      : 8;
    const simulateCrash =
      body.simulateCrash !== undefined
        ? body.simulateCrash === true || body.simulateCrash === "true"
        : true;
    const provider = body.provider ? String(body.provider) : undefined;
    const model = body.model ? String(body.model) : undefined;
    const apiKey = body.apiKey ? String(body.apiKey) : undefined;
    const baseUrl = body.baseUrl ? String(body.baseUrl) : undefined;

    const result = await runParallelTemporalLlmSwarm({
      repoRoot,
      sampleSize,
      concurrency,
      simulateCrash,
      provider,
      model,
      apiKey,
      baseUrl,
      headers: req.headers || {},
      enableLiveNetworkCalls: body.enableLiveNetworkCalls !== false,
      includeGrokCliProbe: Boolean(body.includeGrokCliProbe),
    });

    try {
      writeTemporalLlmSwarmArtifacts(repoRoot, result);
    } catch {
      // Non-fatal on serverless read-only filesystem
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        ok: true,
        source: "live_execution",
        ...result,
      }),
    );
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
