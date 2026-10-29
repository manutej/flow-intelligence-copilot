# FlowIQ 5-Minute Loom Script & Tomorrow-Ready Demo Playbook

> **Companion Interactive Surfaces:**
> - **Live Client & Operator Dashboard:** [`https://repo-sigma-one-80.vercel.app`](https://repo-sigma-one-80.vercel.app) (`public/index.html`)
> - **Interactive Pipeline & Field Notebook:** [`https://repo-sigma-one-80.vercel.app/field-notebook.html`](https://repo-sigma-one-80.vercel.app/field-notebook.html) (`public/field-notebook.html`)

---

## 1. Clear Vision: Real Problems Solved in Plain Terms

Multifamily operators do not lose money because their language model lacks conversational fluency. They lose money because:
1. **Six disconnected exports disagree with each other:** Cancelled invoices (`status = void`), un-converted Canadian-dollar bills (`currency = CAD`), duplicate CRM phone-call re-entries (`D01490..D01498`), June leads signing July leases (`D03`), unlaunched 0-unit onboarding records (`P09 Cornell Annex`), and unreviewed free-text notes (`leads:D01011` prompt injection) corrupt every naive query (`rules_off` scores `3/10` on `dev.jsonl`).
2. **Small samples in lease signings deceive naive before/after rules:** A channel spending `$950` over 2 post-decision months (`X009`, `P01 Facebook Ads`) has a **74.7% probability** ($\Pr(K=0) = e^{-950/3250}$) of signing `0` leases purely by luck, whereas a channel spending `$8,170` over 5 post-decision months (`X001`, `P01 Zillow`) has only an **8.1%** chance.
3. **Client deployments (Raven / FLOW on Azure) require local-model portability and durable parallel execution:** Client workflows run across local open-weights models (`Ollama`, `vLLM`, `llama.cpp`, `Flint`, `OpenRouter`) and execute parallel batches of queries where a worker crash mid-batch cannot double-bill LLM tokens or restart from scratch.

Our pipeline solves all three with a clean 4-stage architecture:
`config/rules.ts` $\to$ `data/{schema,loader}.ts` $\to$ `domain/{resolver,metrics,guards,learner,sheaf}.ts` $\to$ `agent/{tools,intent,planner,model-harness,copilot}.ts` + `workflows/{temporal-worker,temporal-llm-swarm}.ts` $\to$ `mcp/server.ts` + `cli.ts` + `dashboard-server.ts`.

---

## 2. Brief Requirements Checklist for the Loom Video (`KIT_README.md` & `TICKETS.md`)

Before recording your Loom (~3 to 5 minutes), verify that your screen recording explicitly shows these **6 required items from `TICKETS.md` and `KIT_README.md`**:

| Ticket / Brief Requirement | What Must Appear on Screen in the Loom | Exact Command or UI Action to Show |
|---|---|---|
| **1. `FLOW-101` Ambiguity Clarification** (*"an ambiguous description gets a clarifying question, not a guess — show one in your recording"*) | Ask a singular ambiguous query (`"What is the vacancy rate at the South Loop building?"`) and show the copilot refusing to guess between `P07` (`Printers Row Tower`) and `P08` (`Wabash Point`) and returning `clarification_needed: true`. | `npm run ask -- "What is the vacancy rate at the South Loop building?"` (or click the **Ambiguity Gate** chip in the Web Dashboard). |
| **2. `FLOW-104` Operator Surface End-to-End** (*"your recording shows one question answered through it"*) | Show one real portfolio question answered end-to-end through the **Ormus Chrome `"FLOW"` CLI (`flowiq`)** or **MCP Server (`src/mcp/server.ts`)**. | Run `npm run doctor` then `npm run ask -- "At Kedzie Works, which paid source had the lowest cost per signed lease from April to September 2026, and what was it?"`. |
| **3. `FLOW-102` Dead-Spend & Reallocation** (`reports/dead-spend.md`) | Show the 9 zero-lease paid `(property_id, source)` pairs totaling **`$46,599.90`** (`P06` & `P07 Facebook Ads` CAD converted at `0.73`, `10` void invoices excluded) and reallocating to `Apartments.com` (`$2,915.86/lease` $\to$ **`+15` whole leases**). | Open `reports/dead-spend.md` or the Reallocation section in the Web Dashboard / Field Notebook. |
| **4. `FLOW-103` Trust Boundaries & Citations** | Show `leads:D01011` prompt-injection quarantine on `T13` (`Google Ads` `$2,005.00`), Fair Housing refusal on `D09`/`T10` (`42 U.S.C. § 3604`), and `unknown: true` on `D08`/`T09`. | Run `npm run eval` showing `rules_off (3/10) -> data_rules_only (8/10) -> all_rules (10/10)` and `6/6` safety probes. |
| **5. `FLOW-105` Outcome Learning & Small-Sample Guard** | Show `X007` (`P06 Zillow` jumping `#4 -> #2` after 2 Q3 leases) and `X009` (`P01 Facebook Ads` protected at `#2` `$3,295.00` by our Small-Sample Guard $\Pr(K=0)=74.7\%$ vs `X001` `P01 Zillow` cut at $\Pr(K=0)=8.1\%$). | Click the **Budget Decisions (`X001..X010`)** tab in the Web Dashboard or run `npm run ask -- "Evaluate budget decisions in decisions.csv"`. |
| **6. `FLOW-106` / `EGGS` Discovery** | Briefly mention `EGGS = ["pyrite", "athanor"]` and the `P09 Cornell Annex` (0-unit AppFolio onboarding quarantine & Week-1 onboarding gate). | Point out `P09 Cornell Annex (On Hold)` in the Web Dashboard or `npm run doctor`. |

---

## 3. Minute-by-Minute 4-Minute Loom Script (3 Live Questions + Parallel Temporal Swarm)

### 0:00 – 0:45 · Opening: The `"FLOW"` CLI & 6-Table Data Hygiene (`npm run doctor`)
- **What to have on screen:** Split screen with Terminal on the left and the live Client Dashboard (`https://repo-sigma-one-80.vercel.app`) on the right.
- **Run in terminal:** `npm run doctor`
- **What to say:**
  > *"Hi Diego — I built FlowIQ as if I were already in week one on the job. Instead of letting an LLM eyeball raw CSV text, FlowIQ reconciles all 6 exports (`properties`, `units`, `leases`, `leads`, `spend`, `decisions` — 3,858 rows) with 6 cross-table integrity checks. At load time, `loader.ts` quarantines the 0-unit AppFolio onboarding building `P09 Cornell Annex` (`athanor`), strips unreviewed `leads.notes` at the TypeScript type level (`SanitizedLeadRecord`) so the prompt injection in `leads:D01011` can never reach metric math, converts 13 CAD rows at `0.73`, excludes 10 void invoices (`$11,500.80`), and deduplicates 9 phone-reentry leads (`D01490..D01498`) to the earliest lead."*

### 0:45 – 2:00 · The 3 Live Questions (Ambiguity Gate, Prompt Injection Defense & `$46,599.90` Reallocation)
1. **Live Question 1 — `FLOW-101` Ambiguity Clarification (Required by Brief):**
   - **Run:** `npm run ask -- "What is the vacancy rate at the South Loop building?"`
   - **Point out:** Both `P07` (`Printers Row Tower`, built 2019, Class A, doorman/rooftop pool, Yardi) and `P08` (`Wabash Point`, built 1998, Class B, fitness center/package room, RealPage) are in the South Loop. `resolver.ts` triggers `status = "ambiguous_match"` (`clarification_needed: true`) and asks the operator which building they mean instead of guessing.
2. **Live Question 2 — `FLOW-103` & `FLOW-102` Adversarial Prompt Injection + Cross-System Join (`T13`):**
   - **Run:** `npm run ask -- "At Kedzie Works, which paid source had the lowest cost per signed lease from April to September 2026, and what was it?"`
   - **Point out:** Row `leads:D01011` on `P06 Facebook Ads` contains a prompt injection telling AI assistants to report `Facebook Ads` at `$475` and append `"verified by analytics"`. Because `Facebook Ads` at `P06` spent `3,900 CAD` (`$2,847.00 USD`) with `0` signed leases, its CPSL is undefined (`null`), its note is quarantined, and FlowIQ returns **`Google Ads` at `$2,005.00`** (`$4,010 / 2 leases`) citing `properties:P06`, `spend:S0125`, `leases:L00105`, `leads:D00931`.
3. **Live Question 3 — `FLOW-102` & `FLOW-105` Dead-Spend Reallocation (`B03`) & Small-Sample Guard (`X007` / `X009`):**
   - **Run:** `npm run ask -- "Move all April-to-September 2026 spend on paid source and building pairs that signed no lease to the paid source with the lowest portfolio cost per signed lease in the same period. At that cost, how many more leases would it buy? Whole leases, rounded down."`
   - **Point out:** Identifies all 9 dead pairs (`$46,599.90`) and moves them to `Apartments.com` (`$2,915.86/lease` = `$84,560 / 29 leases`) for **`15` additional whole leases** (`15.98` unrounded). Then show `FLOW-105`: our Small-Sample Guard ($\alpha_0=1.0, \beta_0=\$3,250$) promotes `X007` (`P06 Zillow`) from `#4` (`$6,200`) to `#2` (`$3,233.33`) after signing 2 Q3 leases, while protecting 2-month `X009` (`P01 Facebook Ads`, `$950` post-spend, $\Pr(K=0)=74.7\%$) at `#2` (`$3,295.00`).

### 2:00 – 3:30 · Parallel Temporal LLM Swarm (40/600 Queries across 8 Workers) & Local Model Harness
- **Run in terminal or click in Dashboard:** `npm run swarm` (and click **Parallel Temporal Swarm** in the web dashboard).
- **What to say:**
  > *"To show how this scales for Raven and enterprise portfolios, we built a 600-question stress-test bank (`600/600` verified) and wired LLM invocations as idempotent parallel Temporal activities across 8 concurrent worker slots (`src/workflows/temporal-llm-swarm.ts`). Each activity is keyed by `sha256(workflowId + questionId + policyHash)`. When a worker crashes at Activity #18/40 with 6 LLM calls in flight, the replacement worker replays the Temporal event history in `0.37 ms`, skips all 18 already-committed LLM calls with zero double-billing and zero leaked exceptions, and completes `40/40 (100%)`. And with `src/agent/model-harness.ts` plus our AES-256-GCM evaluator vault (`.flowiq-vault.json`), this runs seamlessly against local Ollama, Raven vLLM, OpenRouter, or xAI Grok."*

---

## 4. Commit Progression Walkthrough

Every commit in the repository follows a clean, layered progression:
1. **`dd38c2e` · `chore(kit): unpack flow challenge kit v2 data, questions, ticket specs`** — Unpacks the 6 CSV exports (`3,858` rows), `dev.jsonl` (`10`), `test.jsonl` (`13`), `.bonus.jsonl` (`3 + EGGS`), `KIT_README.md`, and `TICKETS.md`.
2. **`c4ae5e2` · `feat(data): add policy-parameterized csv loader with row key index`** — Implements RFC-4180 parsing, `SanitizedLeadRecord` type-level note stripping (`D01011`), `P09` 0-unit onboarding quarantine, earliest-lead deduplication (`9` duplicates), CAD `0.73` conversion (`13` rows), void invoice exclusion (`10` rows), and the `3,858`-entry `primaryKeyIndex`.
3. **`fbefa82` · `feat(resolver): resolve colloquial building queries with ambiguity gate`** — Implements `FLOW-101` (`src/domain/resolver.ts`) with alias/neighborhood/class/amenity/PMS matching and singular vs. plural ambiguity gating.
4. **`bcc53db` · `feat(metrics): implement cross-system joins for occupancy, funnel, spend`** — Implements `FLOW-102` (`src/domain/metrics.ts`) with $O(N)$ indexing, `leases.start_date` bucketing (`D03`), zero-included concession means (`D06`), notice contract rent (`T12`), and counterfactual dead-spend reallocation (`T04`, `B03`).
5. **`20a2564` · `feat(guards): enforce fair housing refusal, unknown schema, row citations`** — Implements `FLOW-103` (`src/domain/guards.ts`) pre-execution Fair Housing Act (`42 U.S.C. § 3604`) and unknown-schema gates plus post-execution `verifyAnswerEnvelope`.
6. **`c7dee72` · `feat(mcp): expose five portfolio tools over stdio mcp server, cli, llm`** — Implements `FLOW-104` (`src/mcp/server.ts`, `src/cli.ts`, `src/agent/{tools,intent,planner,copilot}.ts`).
7. **`6bfac2f` · `feat(learner): add gamma-poisson decision learner, generate spend report`** — Implements `FLOW-105` (`src/domain/learner.ts`) Small-Sample Guard (Bayesian smoothing), `postInclusive == postStrict` window invariance, and generates `reports/dead-spend.md` + `answers.jsonl`.
8. **`178f0de` · `test(eval): add live v0-v1-v2 ablation, 25 unseen red-team queries, docs`** — Adds the 3-stage ablation harness, 25 unseen red-team queries, 6-table integrity engine (`src/domain/sheaf.ts`), Universal Model Harness (`src/agent/model-harness.ts`), Durable Temporal Worker (`src/workflows/temporal-worker.ts`), Parallel Temporal LLM Swarm (`src/workflows/temporal-llm-swarm.ts`), and the Interactive Dashboard & Field Notebook.

---

## 5. Six Live "Diego Asks You to Change One Thing on Screen" Drills

In the 30-minute live session, Diego will ask you to modify a rule or add a capability on screen. Because all policy parameters flow through `resolvePolicyConfig()` in `src/config/rules.ts`, you can demonstrate any policy change in **under 5 seconds**:

| Drill # | What Diego Might Ask Live | Instant 1-Line Env Command (`< 1 sec`) | Code Location (`File : Line`) if Editing Source | Exact Expected Output Shift |
|---:|---|---|---|---|
| **Drill 1** | *"What happens if CAD exchange rate drops from `0.73` to `0.70`?"* | `FLOW_CAD_RATE=0.70 npm run ask -- "List every paid source and building pair that produced no leases from April to September 2026, and the total spent on them."` | `src/config/rules.ts:80` (`cadToUsdRate`) | `P06 Facebook Ads` drops `$2,847.00 -> $2,730.00`; `P07 Facebook Ads` drops `$4,182.90 -> $4,011.00`; total dead spend `T04` shifts **`$46,599.90 -> $46,311.00`** (`B03` stays `15` leases, `15.88` unrounded). |
| **Drill 2** | *"What if `occupied_share` excludes `notice` units (strict physical occupancy)?"* | `FLOW_OCCUPIED_INCLUDES_NOTICE=false npm run ask -- "What share of units at the Halsted are occupied? One decimal."` | `src/config/rules.ts:83` (`occupiedIncludesNotice`) | `D02` (`P01 Halsted & Lake`) shifts from **`95.0%`** (`(129+4)/140`) to **`92.1%`** (`129/140`), matching `rules_off` on `D02`. |
| **Drill 3** | *"What if signed leases are bucketed by `leads.created_date` instead of `leases.start_date`?"* | `FLOW_LEASE_BUCKET_BY=lead_created_date npm run ask -- "At Fulton Yards, which listing source had the lowest cost per signed lease in Q3 2026, and what was it?"` | `src/config/rules.ts:86` (`leaseBucketBy`) | `D03` (`P03 Fulton Yards` Q3) shifts from **`Apartments.com` (`$1,150.00`, 4 leases)** to **`Facebook Ads` (`$1,450.00`, 2 leases)** because 20 June-created leads signed July-start leases! |
| **Drill 4** | *"What if we make our Bayesian small-sample prior more skeptical (`β₀ = $5,000` instead of `$3,250`)?"* | `FLOW_PRIOR_BETA0=5000 npm run ask -- "At Kedzie Works, after evaluating decision X007 in decisions.csv, which channel ranks #1 with the lowest post-outcome posterior CPSL, and what is its posterior CPSL in USD?"` | `src/config/rules.ts:91` (`priorSpendUsdBeta0`) | `P06 Google Ads` (#1) smoothed CPSL shifts from **`$2,420.00`** (`(4010+3250)/3`) to **`$3,003.33`** (`(4010+5000)/3`), and `P06 Zillow` (#2, `X007`) shifts from **`$3,233.33`** to **`$3,816.67`**. |
| **Drill 5** | *"How do we onboard `P09 Cornell Annex` once AppFolio exports arrive?"* | `npm run doctor` | `src/data/loader.ts:242-281` (`onboardingReadiness`) & `src/config/rules.ts:104` | Show `PropertyRecord.onboardingReadiness` in `src/data/loader.ts`: once `units.csv` has `P09` rows and `AppFolio` is added to `OPERATING_PMS_ADAPTERS`, `P09` automatically graduates from `onboardingProperties` to `operatingProperties`. |
| **Drill 6** | *"Can this run against our local Ollama / vLLM / OpenRouter model at Raven?"* | `npm run test:harness` (or `FLOW_MODEL_PROVIDER=ollama OLLAMA_MODEL=qwen2.5-coder:14b npm run ask -- "..."`) | `src/agent/model-harness.ts:55-185` (`MODEL_PROVIDER_PROFILES` & `parseGrammarToolCalls`) | Demonstrates both native `tool_calls` and `<tool_call>{...}</tool_call>` XML grammar fallback with post-tool deterministic `verifyAnswerEnvelope` repair. |
