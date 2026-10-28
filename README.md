# FlowIQ (`flow-intelligence-copilot`)

**A pilot portfolio assistant for an eight-building Chicago apartment operator (`P01`–`P08`, plus a ninth building `P09` mid-onboarding) where an LLM or MCP client proposes tool calls, a typed TypeScript engine runs the joins, and a post-check verifies every `<table>:<id>` row citation before returning.**

The portfolio's data is split across three exports that don't share clean conventions: a PMS (`properties.csv`, `units.csv`, `leases.csv`), a CRM (`leads.csv`), and an ad-spend ledger (`spend.csv`), plus ten months of historical budget decisions (`decisions.csv`). If you hand raw CSV rows to a language model and ask it for occupancy, cost per signed lease, or dead ad spend, it trips over voided invoices, CAD-denominated bills, duplicate phone leads, zero-dollar concessions, a 0-unit onboarding stub (`P09`), and a prompt injection hidden inside a lead note (`leads:D01011`).

The core idea of this pilot is simple: **keep language understanding and prose synthesis in the model (or intent parser), keep every join, filter, currency conversion, and division in pure TypeScript functions, and verify every cited `<table_name>:<primary_key>` against the loaded CSV index before any answer leaves the system.**

- **Docs:** [`NOTES.md`](NOTES.md) (design choices, what failed first, `FLOW-105` learner math, `FLOW-106` Ninth House onboarding plan) · [`reports/dead-spend.md`](reports/dead-spend.md) (`FLOW-102` dead-spend analysis) · [`reports/adversarial-panel-audit.md`](reports/adversarial-panel-audit.md) (8-agent red-team review) · [`KIT_README.md`](KIT_README.md) (original challenge brief)

---

## How you use it (three surfaces over one engine)

All three surfaces call the same five read-only domain tools (`find_properties`, `query_units_and_occupancy`, `query_leases_and_renewals`, `query_marketing_spend_and_funnel`, `evaluate_budget_decisions`) and the same citation verifier:

### 1. Plugged into an AI assistant via MCP (`FLOW-104`)

[`src/mcp/server.ts`](src/mcp/server.ts) is a standard JSON-RPC 2.0 `stdio` Model Context Protocol server. Drop-in configs are already committed at [`.mcp.json`](.mcp.json) (for Claude Code) and [`.cursor/mcp.json`](.cursor/mcp.json) (for Cursor).

- **In Claude Code or Cursor:** open this folder and the `flowiq` MCP server starts automatically. Ask your assistant *"Which paid channels burned money with zero signed leases from April to September?"* or *"How many leases at the brick one in Logan Square expire in Q1 2027?"* and the model calls the MCP tools directly.
- **In Claude Desktop (`claude_desktop_config.json`):**
  ```json
  {
    "mcpServers": {
      "flowiq": {
        "command": "node",
        "args": ["--no-warnings", "/abs/path/to/flow-intelligence-copilot/src/mcp/server.ts"],
        "cwd": "/abs/path/to/flow-intelligence-copilot"
      }
    }
  }
  ```
- **Test the MCP server from your terminal in 5 seconds:**
  ```console
  $ printf '{"jsonrpc":"2.0","id":1,"method":"initialize"}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"ask_flowiq","arguments":{"question":"Which South Loop building has a doorman, and what is the average market rent of its one-bedroom units?"}}}\n' | npm run mcp --silent
  ```

### 2. From the terminal CLI (`src/cli.ts`)

You can run single questions or an interactive REPL (`npm run cli`). By default it runs offline using the local semantic query planner (`src/agent/intent.ts` + `src/agent/planner.ts`). Pass `--llm` with `XAI_API_KEY` (Grok) or `OPENAI_API_KEY` to run a live LLM tool-calling loop over the same tools:

```console
$ npm run cli -- "How many vacant units are at the brick one in Logan Square?"

=== FlowIQ Copilot ===
Question:  How many vacant units are at the brick one in Logan Square?
Tools:     find_properties({"query":"How many vacant units are at the brick one in Logan Square?","scope":"single_building"}) -> status=resolved_single, matched=[P06] | query_units_and_occupancy({"propertyIds":["P06"]}) -> occupied=119/140 (85%), vacant=21
Answer:    Kedzie Works (P06, the brick vintage walk-up in Logan Square) currently has 21 vacant units out of 140 total units (85.0% occupied including 6 units on notice).
Result:    {"property_id":"P06","count":21}
Citations: properties:P06, units:U0658, units:U0667, units:U0668, units:U0673, units:U0685
Verified:  PASS (all row IDs verified)
```

```console
$ XAI_API_KEY=... npm run cli -- --llm "At Kedzie Works, which paid source had the lowest cost per signed lease from April to September 2026?"
```

### 3. Evaluation harness, reports, and visual audit console

```console
$ npm run eval          # runs v0 (3/10) -> v1 (8/10) -> v2 (10/10) on dev.jsonl + 6 probes + 25 unseen queries
$ npm run answer        # writes answers.jsonl (T01-T13, B01-B03, EGGS)
$ npm run report        # writes reports/dead-spend.md from the domain engine
$ npm test              # runs 15 unit, ablation, policy-override, and MCP tests
$ npm run rebuild-all   # regenerates reports, answers, visual UI, and runs eval in < 1s
$ open ui/flowiq-visual-studio.html
```

---

## How it works

```text
Question (CLI / MCP / Eval)
   │
   ▼
1. Pre-Checks (src/domain/guards.ts)
   ├─ Fair Housing check (refuses protected-class targeting/steering -> {"refused": true})
   └─ Schema boundary check (flags fields not in CSVs like cap rate / utilities -> {"unknown": true})
   │
   ▼
2. Building Resolver & Ambiguity Gate (src/domain/resolver.ts · FLOW-101)
   ├─ Matches nicknames, neighborhoods, street numbers, vintage/class, and amenities
   ├─ Quarantines 0-unit onboarding stub P09 (Cornell Annex) from operating denominators
   └─ If a singular query matches >1 building ("the South Loop building" -> P07 vs P08),
      stops and asks a clarifying question instead of guessing
   │
   ▼
3. Tool Planner / Live LLM Tool Loop (src/agent/intent.ts, planner.ts, tools.ts)
   ├─ Calls typed domain functions in src/domain/metrics.ts and src/domain/learner.ts
   └─ Enforces README rules: (occupied + notice)/all, 1 CAD = 0.73 USD, posted invoices only,
      earliest lead per lease_id wins, lease bucketing by leases.start_date, $0 concessions included
   │
   ▼
4. Citation & Injection Post-Check (src/domain/guards.ts · FLOW-103)
   ├─ Verifies every <table>:<id> exists in the 3,858-row primaryKeyIndex
   └─ Confirms leads.notes (where D01011 hides a prompt injection) never enters tool outputs
```

| Stage | What it does |
|---|---|
| **`src/config/rules.ts`** | Holds `PortfolioPolicyConfig` (FX rate, notice-in-occupied toggle, lease date bucketing, Empirical-Bayes prior `α₀ = 1.0`, `β₀ = $3,250`) plus the `POLICY_V0_NAIVE`, `POLICY_V1_JOINED`, and `POLICY_V2_GUARDED` presets. |
| **`src/data/loader.ts`** | Parses the 6 CSV files, strips `leads.notes` from `SanitizedLeadRecord` at load time, indexes all 3,858 primary keys, separates `P01`–`P08` from 0-unit `P09`, filters `void` spend rows, and deduplicates phone re-entry leads. |
| **`src/domain/resolver.ts`** | Resolves colloquial building references (`FLOW-101`) and distinguishes `single_building` queries (which must clarify on ambiguity) from `portfolio_filter` queries. |
| **`src/domain/metrics.ts`** | Computes occupancy, vacancy, renewals, effective rent, concessions, marketing funnel efficiency (`CPSL`, `CPL`, `CPT`), and the `$46,599.90` dead-spend reallocation (`FLOW-102`). |
| **`src/domain/learner.ts`** | Evaluates historical budget decisions `X001`–`X010` (`FLOW-105`) with Gamma-Poisson shrinkage and Poisson zero-lease tail probabilities \(\Pr(K=0 \mid \text{spend}) = \exp(-\text{spend}/\beta_0)\). |
| **`src/domain/guards.ts`** | Enforces Fair Housing refusals, unmodeled-field `unknown: true` responses, and row-level citation verification (`FLOW-103`). |
| **`src/agent/` & `src/mcp/`** | Exposes the 5 domain tools over both the CLI copilot (`src/cli.ts`) and the JSON-RPC 2.0 `stdio` MCP server (`src/mcp/server.ts`, `FLOW-104`). |

---

## Changing assumptions live (`src/config/rules.ts`)

Every rule assumption is parameterized in [`src/config/rules.ts`](src/config/rules.ts) and can be overridden from the command line to see what changes across the portfolio in under a second:

| Assumption | Default (Kit v2) | Env Override | Try it in terminal |
|---|---|---|---|
| **CAD → USD rate** | `0.73` | `FLOW_CAD_RATE` | `FLOW_CAD_RATE=0.80 npm run rebuild-all` |
| **Occupied includes `notice`** | `true` (`(occupied + notice) / all`) | `FLOW_OCCUPIED_INCLUDES_NOTICE` | `FLOW_OCCUPIED_INCLUDES_NOTICE=false npm run eval` |
| **Signed lease date bucketing** | `lease_start_date` | `FLOW_LEASE_BUCKET_BY` | `FLOW_LEASE_BUCKET_BY=lead_created_date npm run eval` |
| **Bayesian prior spend (`β₀`)** | `3250` (`$3,250` per `α₀ = 1.0` lease) | `FLOW_PRIOR_BETA0` | `FLOW_PRIOR_BETA0=4000 npm run report` |
| **Reference `today` date** | `2026-10-01` | `FLOW_TODAY` | `FLOW_TODAY=2026-11-01 npm run eval` |
