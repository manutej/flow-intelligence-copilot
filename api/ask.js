import path from "node:path";
import { askFlowIqCopilot } from "../src/agent/copilot.ts";
import { loadPortfolioStore } from "../src/data/loader.ts";

function parsePolicyOverrides(raw = {}) {
  const overrides = {};
  if (raw.cadToUsdRate !== undefined) {
    const v = Number.parseFloat(String(raw.cadToUsdRate));
    if (Number.isFinite(v) && v > 0) overrides.cadToUsdRate = v;
  }
  if (raw.occupiedIncludesNotice !== undefined) {
    overrides.occupiedIncludesNotice =
      raw.occupiedIncludesNotice === true ||
      raw.occupiedIncludesNotice === "true";
  }
  if (raw.leaseBucketBy !== undefined) {
    overrides.leaseBucketBy =
      raw.leaseBucketBy === "lead_created_date"
        ? "lead_created_date"
        : "lease_start_date";
  }
  if (raw.priorSpendUsdBeta0 !== undefined) {
    const v = Number.parseFloat(String(raw.priorSpendUsdBeta0));
    if (Number.isFinite(v) && v > 0) overrides.priorSpendUsdBeta0 = v;
  }
  if (raw.quarantineZeroUnitProperties !== undefined) {
    overrides.quarantineZeroUnitProperties =
      raw.quarantineZeroUnitProperties === true ||
      raw.quarantineZeroUnitProperties === "true";
  }
  if (raw.excludeVoidSpend !== undefined) {
    overrides.excludeVoidSpend =
      raw.excludeVoidSpend === true || raw.excludeVoidSpend === "true";
  }
  if (raw.deduplicateLeads !== undefined) {
    overrides.deduplicateLeads =
      raw.deduplicateLeads === true || raw.deduplicateLeads === "true";
  }
  if (raw.includeunlaunched !== undefined) {
    overrides.quarantineZeroUnitProperties = !(
      raw.includeunlaunched === true || raw.includeunlaunched === "true"
    );
  }
  return overrides;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
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

    const question = String(
      body.question ||
        body.q ||
        "Which of my buildings is bleeding money on marketing right now, and why?",
    ).trim();

    const policyOverrides = parsePolicyOverrides(body.policy || body);
    const store = loadPortfolioStore(repoRoot, policyOverrides);

    const provider = body.provider ? String(body.provider) : undefined;
    const model = body.model ? String(body.model) : undefined;
    const baseUrl = body.baseUrl ? String(body.baseUrl) : undefined;
    const apiKey = body.apiKey ? String(body.apiKey) : undefined;
    const mode =
      body.mode === "llm" || (provider && provider !== "deterministic")
        ? "llm"
        : "deterministic";

    const turn = await askFlowIqCopilot(
      {
        id: body.id ? String(body.id) : "LIVE-WEB",
        type: body.type ? String(body.type) : "interactive",
        question,
      },
      {
        store,
        mode,
        provider,
        model,
        baseUrl,
        harness: apiKey ? { apiKey } : undefined,
      },
    );

    const payload = {
      ok: true,
      id: turn.envelope.id,
      question,
      answer: turn.envelope.answer,
      result: turn.envelope.result,
      citations: turn.envelope.citations,
      toolCalls: turn.toolCalls,
      clarificationNeeded: turn.clarificationNeeded,
      clarifyingQuestion: turn.clarifyingQuestion,
      modeUsed: turn.modeUsed,
      providerUsed: turn.providerUsed || "deterministic",
      modelUsed: turn.modelUsed || "flowiq-sheaf-v2.0",
      llmFallbackReason: turn.llmFallbackReason || null,
      verification: turn.verification,
      operadicConsistency: turn.verification.valid ? 1.0 : 0.0,
      policy: store.policy,
    };

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
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
