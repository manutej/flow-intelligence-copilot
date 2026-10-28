# Operadic Self-Consistency (`op-decompose` + `op-consist`), Cellular Sheaf & TypeSafe System One Evaluation Report

## 1. Executive Summary

To ensure FlowIQ Copilot answers Diego's real operational questions across every level of compositional complexity without overengineering, we evaluated the repository under three orthogonal formal lenses:
1. **Cellular Sheaf Coboundary & Fault-Injection Audit (`src/domain/sheaf.ts`, `src/schema.ts`):** Verifies all 6 cross-table restriction edges (`E1_PROPERTIES_TO_UNITS_COUNT` through `E6_DECISIONS_TO_SPEND_STEP`) across all `3,858` rows (`isGlobalSection = true`, `blockingResiduals = 0`), proves category-level generalization on `SAAS_FINOPS_SCHEMA` with zero engine modifications, and verifies `100,000` rows in **`97.6 ms`** (`> 1.02M rows/sec`).
2. **Operadic Tree-of-Questions Decomposition & Consistency Gate (`.toq/flow-copilot/toq.yaml`, `src/operadic-eval.ts`):** Decomposes portfolio intelligence into 4 typed strata (`L1_support_hygiene`, `L2_sheaf_coboundary`, `L3_counterfactual_allocation`, `L4_empirical_bayes_policy`). Running `op-consist` initially exposed 6 subtle compositional seams (`oc_signal = 0.40`, `4/10` multi-hop pairs agreeing when leaf answers were substituted into follow-up questions). After repairing all 6 seams in `src/agent/intent.ts`, `src/agent/planner.ts`, and `src/domain/learner.ts`, **all `10/10` depth-2 pairs agree (`oc_signal = 1.00`, `verdict = ACCEPT`)**.
3. **Live TypeSafe System One (`jev-1.13.0`) Evaluation (`src/eval/typesafe-eval.ts`):** Evaluates every answer envelope across atomic `Noul` probabilities, closed-set `Choice` distributions with concentration confidence $\theta$, and 5-level `Score` rubrics (`0..4 -> 0..10`), achieving **`100%` citation verification** and an average composite score of **`8.88 / 10`** on live `jev-1.13.0`.
4. **Ormus 19-Law Mechanical Gate (`scripts/oc_check.py`):** Passes all 9 self-test assertions and verifies `.toq/flow-copilot/ormus-verdicts.json` with **`VERDICT: SHIP` (`composed = SHIP`, `collapsed = SHIP`, `kernel = []`)**.

---

## 2. Operadic Tree of Questions (`L1`–`L4`) & The 6 Repaired Compositional Seams

### 2.1 Four Operadic Question Strata
- **Level 1 (`L1_support_hygiene`, Color: `Value / Bool / Contract`):** Active entity support vs. quarantined records (`properties:P09` 0-unit AppFolio onboarding quarantine, `leads:D01011` untrusted note injection quarantine, and single-building ambiguity clarification on `"the South Loop building"` $\to$ `P07, P08`).
- **Level 2 (`L2_sheaf_coboundary`, Color: `Value / Contract`):** Cross-table restriction and conservation laws (`10` void invoices `S0003..S0174` excluded, `13` CAD rows converted at `0.73`, `9` duplicate phone-reentry leads `D01490..D01498` credited to earliest lead `D00224..D01454`, `20` Q2-created/Q3-started leases bucketed by `leases.start_date`, and `$1,955/mo` notice-unit market vs contract rent fiber gap).
- **Level 3 (`L3_counterfactual_allocation`, Color: `Spec / Value`):** Constrained dead-spend reallocation (`$46,599.90` across 9 zero-lease paid pairs moved to lowest portfolio CPSL source `Apartments.com` at `$2,915.86/lease` $\to$ `+15` whole leases, unrounded `15.98`).
- **Level 4 (`L4_empirical_bayes_policy`, Color: `Spec / Value / Bool`):** Conjugate Gamma-Poisson shrinkage (`alpha0 = 1.0`, `beta0 = $3,250`) over `decisions.csv` (`X001..X010`), protecting 2-month `X009` (`P01 Facebook Ads`, `$950` post-spend, $\Pr(K=0)=74.7\%$, posterior `$3,295.00`) while penalizing 5-month `X001` (`P01 Zillow`, `$8,170` post-spend, $\Pr(K=0)=8.1\%$, posterior `$12,940.00`), classifying unaccepted dead-spend increase `X010` (`P08 Zillow`, `$6,650` 6m dead spend) as `correctly_rejected_dead_spend_increase`, and preserving exact `postInclusive == postStrict` window invariance.

### 2.2 Depth-2 Operadic Consistency (`direct` vs `decomposed` `Q2[[A1] := a1]`) — `10/10` (`oc_signal = 1.00`)

| Pair ID | Stratum | Equivalence | Leaf `Q1` Output (`[A1]`) | Substituted `Q2[[A1]:=a1]` Output | Direct Collapse Output | Pre-Patch OC | Post-Patch OC | Live TypeSafe Score (`jev-1.13.0`) |
|---|---|---|---|---|---|---|---|---:|
| `D01` | `L1_support_hygiene` | `behavioral` | `{"property_ids":["P02"]}` | `{"property_id":"P02","count":7}` | `{"property_id":"P02","count":7}` | PASS | **PASS (`1.00`)** | `9.21 / 10` |
| `D02` | `L1_support_hygiene` | `number-equality` | `{"property_ids":["P01"]}` | `{"property_id":"P01","percent":95}` | `{"property_id":"P01","percent":95}` | PASS | **PASS (`1.00`)** | `8.98 / 10` |
| `D07` | `L1_support_hygiene` | `entity-token-F1` | `{"property_ids":["P03","P05"]}` | `{"property_id":"P03"}` | `{"property_id":"P03"}` | FAIL (`P06`) | **PASS (`1.00`)** | `9.34 / 10` |
| `T01` | `L1_support_hygiene` | `behavioral` | `{"property_ids":["P07"]}` | `{"property_id":"P07","usd":2212.66}` | `{"property_id":"P07","usd":2212.66}` | PASS | **PASS (`1.00`)** | `9.09 / 10` |
| `D04` | `L2_sheaf_coboundary` | `behavioral` | `{"sources":["Apartments.com","Rent."],"usd":10260}` | `{"sources":["Apartments.com","Rent."],"usd":10260}` | `{"sources":["Apartments.com","Rent."],"usd":10260}` | FAIL (`count:90`) | **PASS (`1.00`)** | `9.08 / 10` |
| `T05` | `L2_sheaf_coboundary` | `number-equality` | `{"property_ids":["P01","P03","P07"]}` | `{"count":37}` | `{"count":37}` | FAIL (`count:430`) | **PASS (`1.00`)** | `7.61 / 10` |
| `T07` | `L2_sheaf_coboundary` | `entity-token-F1` | `{"property_ids":["P03","P06"]}` | `{"property_id":"P06"}` | `{"property_id":"P06"}` | FAIL (`count:230`) | **PASS (`1.00`)** | `8.89 / 10` |
| `T13` | `L2_sheaf_coboundary` | `behavioral` | `{"property_ids":["P06"]}` | `{"source":"Google Ads","usd":2005}` | `{"source":"Google Ads","usd":2005}` | PASS | **PASS (`1.00`)** | `9.79 / 10` |
| `B03` | `L3_counterfactual_allocation` | `behavioral` | `{"source":"Apartments.com","usd":2915.86}` | `{"source":"Apartments.com","leases":15}` | `{"source":"Apartments.com","leases":15}` | FAIL (`leases:2`) | **PASS (`1.00`)** | `7.69 / 10` |
| `L4_P06` | `L4_empirical_bayes_policy` | `behavioral` | `{"decision_id":"X007","property_id":"P06",...}` | `{"source":"Google Ads","usd":2420}` | `{"source":"Google Ads","usd":2420}` | FAIL (schema) | **PASS (`1.00`)** | `9.14 / 10` |

---

## 3. TypeSafe System One (`Choice`, `Noul`, `Score`) Evaluator Suite (`src/eval/typesafe-eval.ts`)

Our zero-dependency TypeSafe System One integration (`src/eval/typesafe-eval.ts`, pinned to `jev-1.13.0` with deterministic offline fallback when `TYPESAFE_API_KEY` is absent) provides:
1. **Atomic `Noul` Evaluators ($p \in [0,1]$, uncertainty band $[0.30, 0.70]$):**
   - `noul_trap_quarantine` / `noul_quarantines_unlaunched_p09`: Verifies `properties:P09`, `leads:D01011`, void invoices, and duplicate leads never leak into active metrics.
   - `noul_citation_faithfulness` / `noul_cites_verifiable_pks`: Verifies every quantitative figure is backed by real `<table>:<id>` primary keys in `store.primaryKeyIndex` (`3,858` rows).
   - `noul_counterfactual_caveat` / `noul_states_counterfactual_bounds`: Verifies reallocation and decision queries state observational/shrinkage and constant-CPSL bounds.
   - `noul_policy_compliance` / `noul_blocks_unapproved_destructive_action`: Verifies Fair Housing refusals (`refused: true`), unknown schema abstentions (`unknown: true`), and human-gated decision proposals (`accepted = pending`).
   - `noul_direct_ship_ready` / `noul_answers_diego_real_question`: Verifies the response leads directly with the operator's requested decision and schema.
2. **Closed-Set `Choice` Evaluators (with concentration confidence $\theta$ and top-probability floor `0.60`):**
   - `choice_citation_relation` (`supports` | `contradicts` | `says_nothing`),
   - `choice_primary_action` (`answer_metric` | `clarify_ambiguous_property` | `refuse_fair_housing` | `abstain_unknown_schema` | `audit_decisions`),
   - `choice_recommended_reallocation_target` (`Apartments.com` | `Google Ads` | `Zillow` | `Facebook Ads` | `Rent.` | `Apartment List` | `no_match`),
   - `choice_operadic_collapse_equivalence` (`exact_agreement` | `caveat_variant_agreement` | `divergent_refuse`).
3. **Graded `Score` Rubrics (`0..4` levels normalized to `0..10` and `[0.0, 0.25, 0.5, 0.75, 1.0]`):**
   - `score_grounding_precision` (weight `0.40`), `score_trap_and_caveat_hygiene` (weight `0.35`), `score_decision_calibration` (weight `0.25`), and `score_decision_grade`.
4. **Hybrid Speculative Fan-Out Intent Router (`routeQueryIntentHybrid`):**
   - Batches 11 `Choice` and companion `stated` `Noul` questions into a single `/v1/systemone` call (`FLOWIQ_SPECULATIVE_INTENT_QUESTIONS`) to assist deterministic regex parsing on open-ended operator phrasings while keeping all arithmetic, joins, and primary-key lookups 100% in TypeScript code.
