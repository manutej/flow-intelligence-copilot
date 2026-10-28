# FlowIQ Portfolio Copilot, Eval Harness & MCP Server (`FLOW-101`–`FLOW-106`)

Production-grade multifamily decision copilot, deterministic cross-system domain engine, live 3-stage evaluation harness (`v0 -> v1 -> v2`), conjugate Gamma-Poisson outcome-learning recommender, and JSON-RPC 2.0 MCP server built for the FLOW challenge kit (v2).

- **Zero external runtime dependencies:** Runs natively on Node.js (`>=22.6` / `v26`) with strict TypeScript and `node:test` in `< 400ms`.
- **Zero hardcoded shortcuts:** Audited and hardened by an 8-agent senior engineering red-team panel (`reports/adversarial-panel-audit.md`). Passes `10/10` on `dev.jsonl` (`3/10 -> 8/10 -> 10/10` live policy ablation), `6/6` safety/quarantine probes, and `25/25` unseen multi-hop compositional queries (`UNSEEN_RED_TEAM_SUITE`).
- **Dual-mode agent (`src/agent/copilot.ts`):** Supports both deterministic compositional tool-planning out-of-the-box (zero API key required) and live OpenAI-compatible LLM tool-calling (`--llm` with `OPENAI_API_KEY`) over the exact same 5 typed portfolio tools and post-execution citation verifier.

---

## 1. Quickstart (Run Everything in Under 60 Seconds)

```bash
# 1. Run the live eval harness (v0 3/10 -> v1 8/10 -> v2 10/10 + 6 probes + 25 unseen red-team queries)
npm run eval

# 2. Generate answers.jsonl (T01..T13 + bonus B01..B03 + dual-schema EGGS)
npm run answer

# 3. Generate reports/dead-spend.md programmatically from code (FLOW-102 & FLOW-105)
npm run report

# 4. Run the full unit, ablation & red-team test suite (13 tests across 7 suites)
npm test

# 5. Rebuild and verify everything in one command (< 1 second)
npm run rebuild-all
```

### Interactive & Single-Question CLI (`src/cli.ts`)

```bash
# Ask any natural-language question (with full tool-call trace and verified row citations)
npm run cli -- "Which South Loop building has a doorman, and what is the average market rent of its one-bedroom units?"

# Trigger the FLOW-101 Ambiguity Clarification Gate on an underspecified building description
npm run cli -- "How many vacant units at the South Loop building?"

# Defeat the D01011 prompt injection trap on Kedzie Works (T13)
npm run cli -- "At Kedzie Works, which paid source had the lowest cost per signed lease from April to September 2026, and what was it?"
```

---

## 2. Live Session Tuning Knobs (`src/config/rules.ts`)

All domain constants live in `src/config/rules.ts` (`resolvePolicyConfig`) and accept instant environment overrides so any rule change can be tested and re-verified in `< 1 second` via `npm run rebuild-all`:

| Tuning Knob / Rule | Constant in `src/config/rules.ts` | Env Override | Default (Kit v2 Rule) | Example Live Override Command |
|---|---|---|---|---|
| **CAD → USD FX Rate** | `CAD_TO_USD_RATE` | `FLOW_CAD_RATE` | `0.73` | `FLOW_CAD_RATE=0.80 npm run rebuild-all` |
| **Occupied Share Includes `notice`** | `OCCUPIED_INCLUDES_NOTICE` | `FLOW_OCCUPIED_INCLUDES_NOTICE` | `true` (`(occupied + notice) / all`) | `FLOW_OCCUPIED_INCLUDES_NOTICE=false npm run eval` |
| **Signed Lease Period Bucketing** | `LEASE_ATTRIBUTION_BUCKET_BY` | `FLOW_LEASE_BUCKET_BY` | `'lease_start_date'` | `FLOW_LEASE_BUCKET_BY=lead_created_date npm run eval` |
| **Empirical-Bayes Prior CPSL (`β₀`)** | `OUTCOME_LEARNER_CONFIG.priorSpendUsdBeta0` | `FLOW_PRIOR_BETA0` | `3250` (`$3,250` per `α₀ = 1.0` lease) | `FLOW_PRIOR_BETA0=4000 npm run report` |
| **Portfolio Reference Date** | `PORTFOLIO_TODAY` | `FLOW_TODAY` | `'2026-10-01'` | `FLOW_TODAY=2026-11-01 npm run eval` |

---

## 3. Connect the MCP Server in Under 5 Minutes (`FLOW-104`)

`src/mcp/server.ts` exposes a standard JSON-RPC 2.0 `stdio` Model Context Protocol (MCP) server with 6 tools (`ask_flowiq`, `find_properties`, `query_units_and_occupancy`, `query_leases_and_renewals`, `query_marketing_spend_and_funnel`, and `evaluate_budget_decisions`).

### Option A: Connect to Claude Desktop or Cursor (`.cursor/mcp.json` / `claude_desktop_config.json`)

Add the following entry (replacing `/abs/path/to/repo` with your local path):

```json
{
  "mcpServers": {
    "flow-intelligence": {
      "command": "node",
      "args": ["--no-warnings", "/abs/path/to/repo/src/mcp/server.ts"],
      "cwd": "/abs/path/to/repo"
    }
  }
}
```

### Option B: Verify End-to-End in Your Terminal Right Now (10 Seconds)

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize"}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"ask_flowiq","arguments":{"question":"Which South Loop building has a doorman, and what is the average market rent of its one-bedroom units?"}}}\n' | npm run mcp --silent
```

---

## 4. Modular Architecture & Repository Layout

```text
├── src/
│   ├── config/rules.ts          # Runtime PolicyConfig, date windows & v0/v1/v2 ablation presets
│   ├── data/
│   │   ├── schema.ts            # Strict domain types (SanitizedLeadRecord omits `notes`)
│   │   └── loader.ts            # RFC-4180 CSV loader, policy-keyed cache, P09 quarantine, dedup
│   ├── domain/
│   │   ├── resolver.ts          # FLOW-101: alias/neighborhood/class/year/amenity resolver + ambiguity gate
│   │   ├── metrics.ts           # FLOW-102/103: occupancy, renewals, concessions, CPSL/CPL/CPT, dead-spend
│   │   ├── guards.ts            # FLOW-103: Fair Housing refusal, closed-world unknown guard, verifier
│   │   └── learner.ts           # FLOW-105: conjugate Gamma-Poisson learner, Poisson tail Pr(K=0), regret
│   ├── agent/
│   │   ├── tools.ts             # 5 composable agent/MCP tools + JSON schemas
│   │   ├── intent.ts            # Pure semantic query intent AST parser (zero ID branching)
│   │   ├── planner.ts           # Compositional tool planner & dynamic prose/result synthesizer
│   │   └── copilot.ts           # FlowIQ entrypoint (guards + deterministic planner + live LLM loop)
│   ├── cli.ts                   # Interactive & single-turn CLI runner
│   └── mcp/server.ts            # FLOW-104: JSON-RPC 2.0 stdio MCP server
├── scripts/
│   ├── run-eval.ts              # Live v0(3/10)->v1(8/10)->v2(10/10) ablation + 6 probes + 25 unseen RT
│   ├── generate-answers.ts      # Emits answers.jsonl (T01..T13 + B01..B03 + dual-schema EGGS)
│   ├── generate-reports.ts      # Emits reports/dead-spend.md programmatically
│   └── build-ui.ts              # Builds ui/flowiq-visual-studio.html (56 interactive runs)
├── tests/
│   └── portfolio-agent.test.ts  # 13 unit, ablation, zero-hardcoding & unseen red-team tests
├── reports/
│   ├── dead-spend.md            # Programmatically generated FLOW-102 & FLOW-105 report
│   └── adversarial-panel-audit.md # 8-agent senior Grok adversarial review & remediation report
├── answers.jsonl                # Verified test + bonus + EGGS output (17 lines)
├── NOTES.md                     # Architecture, decision log, 13 traps, FLOW-105 math, FLOW-106 Ninth House
└── KIT_README.md                # Original unmodified challenge kit README
```
