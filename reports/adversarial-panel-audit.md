# 8-Agent Senior Grok Adversarial Review Panel — Synthesis & Remediation Report

> **Executed via:** `/home/box/.grok/bin/grok -m grok-4.7-build-fast` across 8 specialized Principal Engineering roles
> **Raw Transcripts:** `/workspace/ormus-flow-challenge/adversarial-panel/agent-01-*.md` through `agent-08-*.md`
> **Reference Brief:** `https://ormus.solutions/talent/briefs/flow` + `KIT_README.md` + `TICKETS.md` + `CHANGELOG.md`

---

## 1. Panel Roster & Mandate

| Agent ID | Role | Primary Audit Target | Transcript Size |
|---|---|---|---|
| **Agent 1** | Anti-Hardcoding & Generalization Prosecutor | `src/agent/copilot.ts`, `scripts/run-eval.ts` | `8,919 bytes` |
| **Agent 2** | Compositional Tool Depth & Unseen Query Red-Teamer | `src/domain/metrics.ts`, `src/domain/resolver.ts`, `src/agent/tools.ts`, 6 CSV schemas | `8,962 bytes` |
| **Agent 3** | Eval Harness & Ablation Rigor Critic (`15%` weight) | `scripts/run-eval.ts`, `v0 -> v1 -> v2` ablation, `tests/portfolio-agent.test.ts` | `6,967 bytes` |
| **Agent 4** | Data Integrity, Cross-System Joins & Trap Auditor (`20%` weight) | `src/config/rules.ts`, `src/data/loader.ts`, `answers.jsonl`, `NOTES.md` | `8,270 bytes` |
| **Agent 5** | Security, Trust Boundary & Grounding Auditor (`FLOW-103`) | `src/domain/guards.ts`, Fair Housing, Unknown Schema, Prompt Injection | `7,465 bytes` |
| **Agent 6** | Empirical-Bayes Decision Learner & Statistical Auditor (`FLOW-105`) | `src/domain/learner.ts`, `decisions.csv`, conjugate Gamma-Poisson math | `6,912 bytes` |
| **Agent 7** | Principal Software Architect (Simplicity, Modularity & Senior Craft) | `package.json`, module graph, `intent.ts` / `planner.ts` / `copilot.ts` split | `7,405 bytes` |
| **Agent 8** | Live Session & Diego Simulator ("Change One Assumption Live") | `src/config/rules.ts`, `scripts/generate-reports.ts`, live override propagation | `7,286 bytes` |

---

## 2. Critical & High-Severity Findings Caught by the 8-Agent Panel

### Finding 1 (CRITICAL — Agents 1, 7, 8): Hardcoded Prose Numerals in `copilot.ts` and `scripts/generate-reports.ts`
- **What was caught:**
  - `src/agent/copilot.ts` line 391 hardcoded `"the 9 zero-lease paid (building, source) pairs"`, `"($84,560.00 / 29 leases)"`, and `"(rounded down from 15.98)"` inside the B03 reallocation explanation string.
  - `src/agent/copilot.ts` line 425 hardcoded `"Nine"`, `"P06 and P07 Facebook Ads"`, and `"0.73 USD"` in the T04 explanation string.
  - `scripts/generate-reports.ts` lines 77–80 and 110–160 hardcoded `$2,847.00`, `$4,182.90`, `$84,560.00 ÷ 29`, `242L / 64T / 8A`, and the `X001`/`X004`/`X006`/`X008` numbers in prose paragraphs.
  - When Diego runs `FLOW_CAD_RATE=0.80 npm run rebuild-all`, the computed `result` and table cells updated to `$47,274.00` and `16` leases, while the prose parenthetical still said `0.73 USD` and `15.98`!
- **Remediation Implemented:**
  - Every numeral in `src/agent/planner.ts` and `scripts/generate-reports.ts` is now 100% dynamically projected from `store.policy`, `mkt.deadSpendReallocation` (`bestSourceSpendUsd`, `bestSourceSignedLeases`, `unroundedAdditionalLeases`, `cadRateUsed`), and `learner.evaluatedDecisions`.

### Finding 2 (CRITICAL — Agents 1, 3, 4): Static `ABLATION_LEDGER` in `scripts/run-eval.ts` & Import-Time Env Singletons
- **What was caught:**
  - `scripts/run-eval.ts` printed a compile-time `ABLATION_LEDGER` constant rather than executing the engine under `v0`, `v1`, and `v2` rules.
  - `src/config/rules.ts` evaluated `process.env.FLOW_*` only at module import time, and `loadPortfolioStore()` cached by `resolvedRoot` without a policy fingerprint.
- **Remediation Implemented:**
  - Added `PortfolioPolicyConfig` and `resolvePolicyConfig(overrides)` in `src/config/rules.ts`, with explicit `POLICY_V0_NAIVE`, `POLICY_V1_JOINED`, and `POLICY_V2_GUARDED` presets.
  - `loadPortfolioStore(repoRoot, policy)` stamps `policy` onto `PortfolioStore` and caches by `${resolvedRoot}::${policyFingerprint(policy)}`.
  - `scripts/run-eval.ts` now executes `askFlowIqCopilot` live across `dev.jsonl` three times (`v0` -> `3/10`, `v1` -> `8/10`, `v2` -> `10/10`) and verifies the exact failure modes and fixes dynamically, followed by a 25-query Unseen Red-Team Generalization Suite.

### Finding 3 (HIGH — Agent 2): Under-Exposed CSV Columns & Multi-Hop Primitives for Unseen Queries
- **What was caught:**
  - `properties.csv` `class` (`A`|`B`) and `year_built` were not filterable in `find_properties` or natural language.
  - Unit-level `"courtyard view"` queries triggered the building-level `courtyard` amenity filter in `resolver.ts`, dropping buildings `P04`, `P06`, and `P08` that have courtyard-view units without `"courtyard"` in `properties.amenities`.
  - `units.csv` `bathrooms`, `sqft`, `floor`, and `view="courtyard"|"none"` were not filterable in `query_units_and_occupancy`.
  - `leases.csv` lacked arbitrary month windows (`October 2026`, `"this month"`, `H1 2026`), unit-attribute joins, and `renewalRatePercent`.
  - `query_marketing_spend_and_funnel` lacked single-month (`August 2026`, `September 2026`) and `Q2 2026` / `H1 2026` windows, `costPerLeadUsd`, `costPerTourUsd`, `applyRatePercent`, and `bedroomsWanted` filtering.
  - `evaluate_budget_decisions` lacked filtering by `decisionIds` (`X001..X010`), `accepted` (`yes`|`no`), and `recommendation` (`increase`|`decrease`).
- **Remediation Implemented:**
  - Upgraded all 5 domain primitives and `src/agent/intent.ts` + `src/agent/planner.ts` to support every CSV column, arbitrary month/quarter/half-year windows, unit-to-lease joins, CPL/CPT/apply-rate metrics, and individual/cohort decision queries.

### Finding 4 (HIGH — Agent 5): Fair Housing Proxy/Steering Phrases & Closed-World Unknown Data Guard
- **What was caught:**
  - Subtle steering/ranking phrases (`"Rank our buildings by fewest families"`, `"Which building is best suited for young Christian professionals?"`, `"Target quiet couples with no strollers"`, `"Prioritize applicants without service animals or Section 8 vouchers"`, `"Steer prospects who use wheelchairs away from walk-ups"`) bypassed `FAIR_HOUSING_ACTION_VERBS` or singular `\bwheelchair\b` patterns.
  - Unmodeled real-estate metrics (`cap rate`, `NOI`, `debt service`, `parking spaces leased`, `water/trash/electric bills`, `security deposit`, `pet fee`, `walk score`, `crime rate`, `school district`, `make-ready days`, `work order response time`, `lease buyout fee`) fell through to unit counts.
- **Remediation Implemented:**
  - Upgraded `checkFairHousingGuard` to stem all protected-class and proxy terms (`families`, `strollers`, `wheelchairs?`, `service animals?`, `section-?8`, `hcv`, `vouchers?`, `empty-nesters`, `dinks`, `school-age`, `demographic`, `marital status`, `age`, etc.) and catch selective/ranking/preference speech acts.
  - Upgraded `checkUnknownDataGuard` to cover financial/valuation (cap rate, NOI, debt), fees/deposits (pet fee, security deposit, application fee, buyout fee), utilities (water, trash, electric, gas), parking leases, operations (make-ready, turnover, work orders), and neighborhood external proxies (walk score, crime, school district).

### Finding 5 (HIGH — Agent 6): Ad-Hoc Constants in `src/domain/learner.ts` & X009 / NOTES.md Precision
- **What was caught:**
  - `deadIncreasePenaltyUsd` (`0.5 * postSpend`) and `preOutcomePriorAdjustment = -600` in `src/domain/learner.ts` were ad-hoc constants unnecessary for the ranking shift.
  - In `data/ops/decisions.csv`, `X009` (`2026-08`, `P01`, `Apartments.com`) has 2 post-decision months (`2026-08` `$380` + `2026-09` `$570` = `$950` post-spend, \(\Pr(K=0) = \exp(-950/3250) = 74.7\%\)), and pure conjugate Gamma-Poisson shrinkage (`w = 1`) keeps `P01 Apartments.com` at `$3,295.00` (rank `#2` at `P01`), while promoting `X007` (`P06 Zillow`) from H1 rank `#4` (`$6,200.00`) to post-decision rank `#2` (`$3,233.33`) with exact level and rank invariance between `postInclusive` and `postStrict`.
- **Remediation Implemented:**
  - Removed the ad-hoc constants from `src/domain/learner.ts` in favor of the pure conjugate Gamma-Poisson posterior, fixed verdict priority so rejected cuts (`X004`, `X006`) always report `missed_opportunity_rejected_cut`, and updated `NOTES.md` and `reports/dead-spend.md`.

### Finding 6 (HIGH — Agents 4, 7): `package.json` `rebuild-all` Script Bug, Swallowed `catch {}`, and `NOTES.md` Audit Details
- **What was caught:**
  - `package.json` `rebuild-all` referenced `npm run generate-reports` and `npm run generate-answers` instead of `npm run report` and `npm run answer`.
  - `src/agent/copilot.ts` had an empty `catch {}` around `runLiveLlmToolLoop` and was a 1,136-line file mixing intent parsing, tool planning, and LLM execution.
  - `NOTES.md` listed wrong earliest lead IDs for the 9 duplicate leads and wrong void sum, and `scripts/build-ui.ts` had a mismatched base64 string for `P09`.
- **Remediation Implemented:**
  - Fixed `package.json`, split the agent layer into `src/agent/intent.ts`, `src/agent/planner.ts`, and `src/agent/copilot.ts`, added structured `modeUsed` / `llmFallbackReason` tracking, improved representative citation coverage across all answers, and corrected `NOTES.md` and `scripts/build-ui.ts`.
