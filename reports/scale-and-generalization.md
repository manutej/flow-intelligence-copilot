# Category-Level Generalization, Cellular Sheaf Architecture & Scale Benchmark (`FLOW-101`–`FLOW-106`)

## 1. What Mathematical Category of Tasks Does This Solve?

Multi-table operational reconciliation and capital-allocation decision systems over messy relational exports (multifamily real-estate PMS/CRM/ILS/Ops, B2B SaaS Cloud FinOps funnels, or multi-warehouse supply-chain ledgers) share one exact mathematical structure: a **set- and commutative-monoid-valued cellular sheaf $\mathcal{F}$ over a relational schema incidence graph $\mathcal{G} = (V, E)$**.

 implemented in `src/schema.ts` and `src/domain/sheaf.ts` (~250 lines total, zero external npm dependencies):

1. **0-Cells (Stalks $v \in V$) & Quarantine / Gauge Functors ($Q_v$):**
   - In **Domain 1 (`FLOW_PORTFOLIO_SCHEMA` — Multifamily Real Estate, 3,858 rows)**:
     - `properties` (`9` rows): Quarantines non-operating onboarding property **`properties:P09`** (`Cornell Annex`, `0` units in `units.csv`, `AppFolio` PMS, Base64 `aka` token `join.ormus.solutions/ninth-house`).
     - `units` (`1,100` rows across `P01..P08`): Active apartment inventory (`occupied`, `notice`, `vacant`).
     - `leases` (`1,033` rows): Current lease contracts (`new` vs `renewal`, `start_date`, `end_date`, `monthly_rent`, `concession_usd`, `renewal_status`).
     - `leads` (`1,498` rows): Trust-boundary projection strips untrusted free-text `notes` at the type level (quarantining prompt injection **`leads:D01011`** on `P06 Facebook Ads`), and quotient $\sim_{\text{lease\_id}}$ collapses **9 duplicate phone-reentry leads (`D01490..D01498`)** onto the earliest `(created_date, lead_id)` representative (`D00224, D00355, D00487, D00501, D00545, D00809, D00902, D00913, D01454`).
     - `spend` (`208` rows): Gauge transformation maps **10 `status = void` rows** (`S0003, S0054, S0062, S0073, S0105, S0110, S0119, S0140, S0149, S0174`) to `$0.00` (`$11,500.80` USD face value excluded) and normalizes **13 `CAD` rows** (`12` posted on `P06` and `P07` `Facebook Ads`, `1` void `S0174`) at `1 CAD = 0.73 USD`.
     - `decisions` (`10` rows, `X001..X010`): Historical budget moves (`increase` / `decrease`, `delta_usd`, `accepted`, `decided_by`), enforcing human sign-off on destructive cuts.
   - In **Domain 2 (`SAAS_FINOPS_SCHEMA` — B2B SaaS / Cloud FinOps Funnel)**:
     - Stalks `regions`, `campaigns`, `trials_weekly`, `contracts_signed`, `autoscale_decisions` run through the **exact same** `verifySheafConsistency()` and `evaluateGenericAllocationAndLearner()` functions in `src/domain/sheaf.ts` without changing a single line of engine code.

2. **1-Cells (Restriction Maps $\rho_{v \to e}: \mathcal{F}(v) \to \mathcal{F}(e)$) & Coboundary Residuals $\|\delta s\|_e$:**

| Edge ID | Stalks ($u \to v$) | Restriction Invariant | Measured Residual on FLOW (`3,858` rows) |
|---|---|---|---|
| `E1_PROPERTIES_TO_UNITS_COUNT` | `properties` $\to$ `units` | `declaredUnits == COUNT(units)` $\ge 1$ & supported PMS | `0` on `P01..P08`; **quarantines `properties:P09`** (`0` units, `AppFolio`) |
| `E2_UNITS_TO_LEASES_STATUS` | `units` $\to$ `leases` | `occupied/notice` $\iff 1$ lease; `vacant` $\iff 0$; `notice` $\iff$ `notice_given` | **`0` blocking errors** across all `1,100` units and `1,033` leases (`isGlobalSection = true`) |
| `E3_UNITS_TO_LEASES_RENT_FIBER` | `units` $\to$ `leases` | `units.market_rent` vs `leases.monthly_rent` on `notice` units (`T12`) | **`$1,955/mo` portfolio fiber gap** across 8 buildings (`$370/mo` at `P06`: `$11,405` market vs `$11,035` contract) |
| `E4_LEADS_TO_LEASES_PULLBACK` | `leads` $\to$ `leases` | FK existence, `property_id` match, `created_date <= start_date`, funnel monotonicity | **9 duplicate leads** (`D01490..D01498`) + **70 cross-month lag rows** (**20 `Q2 -> Q3` boundary shifts** on `D03`) |
| `E5_SPEND_TO_LEASES_SUPPORT` | `spend` $\to$ `leases` | Paid channel support: $\text{spendUsd}(p,s) > 0 \implies \text{signedLeases}(p,s) > 0$ | **9 dead-spend pairs** totaling **`$46,599.90`** (`0` signed leases) $\to$ **`+15` `Apartments.com` leases** |
| `E6_DECISIONS_TO_SPEND_STEP` | `decisions` $\to$ `spend` | If `accepted = yes`, $S(p,s,m) - S(p,s,m-1) = \Delta_{\text{usd}}$ | **6 invoice-step residuals** (e.g. `X001` `P01 Zillow` recommended `+$300`, actual `$1,520 -> $1,170`) |

---

## 2. Algorithmic Complexity Fixes & 100,000-Row Scale Benchmark

### 2.1 Bottleneck Identified & Fixed in `src/domain/metrics.ts`
- **Before Fix:** Inside the nested `for (const prop of targetProps) { for (const source of targetSources) { ... } }` loop (`src/domain/metrics.ts:821-921`), the engine scanned `store.spend.filter(...)`, `store.deduplicatedLeads.filter(...)`, `store.signedLeases.filter(...)`, and reconstructed `new Map(store.leads.map((l) => [l.leadId, l]))` on every `(property, source)` pair ($O(|P|\cdot|S|\cdot|L|)$).
- **After Fix:** `leadMapById` is hoisted out of the loop and `spend`, `deduplicatedLeads`, and `signedLeases` are pre-indexed by `${propertyId}::${source}` in a single $O(N)$ pass before the `(property, source)` loop. Total join complexity is strictly **$O(N)$ time and $O(N)$ memory**.

### 2.2 Measured Benchmark (`tests/generalization.test.ts`)

| Dataset / Domain | Total Relational Rows | Quarantine & Restriction Edges Checked | Wall-Clock Latency | Measured Throughput |
|---|---:|---|---:|---:|
| **Domain 1: FLOW Portfolio (`data/*.csv`)** | `3,858` rows | 6 stalks + `E1..E6` coboundary + allocation | **`4.0 ms`** | **`~964,500 rows/sec`** |
| **Domain 2: B2B SaaS FinOps (`SAAS_FINOPS_SCHEMA`)** | `19` rows | 5 stalks + 4 restriction maps + allocation | **`1.1 ms`** | — |
| **Synthetic Scale Benchmark (`100k` rows)** | **`100,000` rows** (`100` props, `20k` units, `20k` leases, `50k` leads, `9.8k` spend, `100` decisions) | Full `verifySheafConsistency` + single-pass `Map` hash-joins | **`97.6 ms`** (`< 250ms` gate) | **`~1,024,000 rows/sec`** |
