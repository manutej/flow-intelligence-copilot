# FLOW-102 · Portfolio Dead-Spend & Reallocation Report

> **Generated programmatically** by `scripts/generate-reports.ts` on reference date `2026-10-01` across operating buildings `P01`–`P08` (`P09 Cornell Annex` excluded: 0 units in `units.csv`).
> **Data normalization applied:** `1 CAD = 0.73 USD` (12 posted CAD invoices), `10 void` invoices excluded (`$0.00`), `9` duplicate phone-reentry leads deduplicated to earliest lead, and signed leases bucketed by `leases.start_date`.

## 1. Executive Summary

- **Total Dead Spend (April to September 2026):** **$46,599.90** across **9 paid (building, source) pairs** that generated **0 signed leases** (20.7% of the portfolio's $224,599.90 total paid ILS/ad spend).
- **Foreign-Currency Dead Spend Caught:** Agency-billed accounts in Canadian Dollars — `P06 Kedzie Works · Facebook Ads` (`3,900 CAD` posted = **$2,847.00**) and `P07 Printers Row Tower · Facebook Ads` (`5,730 CAD` posted = **$4,182.90**) — produced **0 signed leases**.
- **Portfolio Reallocation Impact (`B03`):** Moving all **$46,599.90** of dead spend to the portfolio's lowest-cost paid source (**`Apartments.com`** at **$2,915.86/lease**, `$84,560.00 ÷ 29 leases`) buys **`15` additional signed leases** (`floor(46599.90 ÷ 2915.8621) = 15`, unrounded `15.98`).

## 2. Every Zero-Lease Paid Pair (`T04` — April to September 2026)

| Building ID | Building Name | Paid Source | Posted Invoices | Void Excluded | Currency Note | Leads / Tours / Apps | Signed Leases | Dead Spend (USD) | Actionable Recommendation | Row Citations |
|---|---|---|---:|---:|---|---|---:|---:|---|---|
| `P01` | Halsted & Lake | `Zillow` | 6 | 1 | USD | 33L / 8T / 0A | **0** | **$9,690.00** | Kill 100% ($1,615.00/mo) → reallocate to P01 Apartments.com ($2,570.00/lease, 4 leases) | `properties:P01, spend:S0002, spend:S0007, spend:S0011` |
| `P03` | Fulton Yards | `Apartment List` | 6 | 0 | USD | 29L / 6T / 2A | **0** | **$4,200.00** | Kill 100% ($700.00/mo) → reallocate to P03 Apartments.com ($1,978.00/lease, 5 leases) | `properties:P03, spend:S0052, spend:S0058, spend:S0064` |
| `P05` | Armitage Commons | `Apartments.com` | 6 | 2 | USD | 27L / 11T / 2A | **0** | **$7,340.00** | Kill 100% ($1,223.33/mo) → reallocate to P05 Facebook Ads ($2,040.00/lease, 1 leases) | `properties:P05, spend:S0101, spend:S0104, spend:S0108` |
| `P05` | Armitage Commons | `Rent.` | 6 | 1 | USD | 17L / 3T / 0A | **0** | **$2,920.00** | Kill 100% ($486.67/mo) → reallocate to P05 Facebook Ads ($2,040.00/lease, 1 leases) | `properties:P05, spend:S0102, spend:S0106, spend:S0109` |
| `P06` | Kedzie Works | `Facebook Ads` | 6 | 0 | CAD (6 rows × 0.73) | 20L / 5T / 1A | **0** | **$2,847.00** | Kill 100% ($474.50/mo) → reallocate to P06 Google Ads ($2,005.00/lease, 2 leases) | `properties:P06, spend:S0126, spend:S0131, spend:S0136` |
| `P07` | Printers Row Tower | `Facebook Ads` | 6 | 1 | CAD (6 rows × 0.73) | 33L / 6T / 2A | **0** | **$4,182.90** | Kill 100% ($697.15/mo) → reallocate to P07 Apartments.com ($2,206.67/lease, 6 leases) | `properties:P07, spend:S0158, spend:S0163, spend:S0168` |
| `P07` | Printers Row Tower | `Rent.` | 6 | 0 | USD | 28L / 8T / 0A | **0** | **$4,470.00** | Kill 100% ($745.00/mo) → reallocate to P07 Apartments.com ($2,206.67/lease, 6 leases) | `properties:P07, spend:S0156, spend:S0161, spend:S0166` |
| `P08` | Wabash Point | `Rent.` | 6 | 0 | USD | 26L / 8T / 1A | **0** | **$4,300.00** | Kill 100% ($716.67/mo) → reallocate to P08 Apartments.com ($2,850.00/lease, 4 leases) | `properties:P08, spend:S0187, spend:S0191, spend:S0195` |
| `P08` | Wabash Point | `Zillow` | 6 | 0 | USD | 29L / 9T / 0A | **0** | **$6,650.00** | Kill 100% ($1,108.33/mo) → reallocate to P08 Apartments.com ($2,850.00/lease, 4 leases) | `properties:P08, spend:S0186, spend:S0190, spend:S0194` |
| **TOTAL** | **6 Buildings Affected** | **9 Dead Pairs** | **54** | **5** | **USD + CAD** | **242L / 64T / 8A** | **0** | **$46,599.90** | **Reallocate to `Apartments.com` → +15 whole leases** | `properties:P01, spend:S0002, properties:P03, spend:S0052` |

## 3. Portfolio Paid Source Efficiency Ranking (`T03` & `B03`)

| Portfolio Rank | Paid Source | Total Spend (USD) | Signed Leases (April to September 2026) | Cost Per Signed Lease (USD) | Leads → Tours → Leases | Tour-to-Lease % | Status |
|---:|---|---:|---:|---:|---|---:|---|
| 1 | `Apartments.com` | $84,560.00 | 29 | **$2,915.86** | 326 → 115 → 29 | 25.2% | **Lowest CPSL (`B03` Reallocation Target)** |
| 2 | `Google Ads` | $36,550.00 | 12 | **$3,045.83** | 164 → 51 → 12 | 23.5% | Active Paid Channel |
| 3 | `Zillow` | $57,190.00 | 13 | **$4,399.23** | 218 → 70 → 13 | 18.6% | Active Paid Channel |
| 4 | `Facebook Ads` | $14,939.90 | 3 | **$4,979.97** | 119 → 25 → 3 | 12.0% | Active Paid Channel |
| 5 | `Rent.` | $22,460.00 | 3 | **$7,486.67** | 141 → 37 → 3 | 8.1% | Active Paid Channel |
| 6 | `Apartment List` | $8,900.00 | 1 | **$8,900.00** | 57 → 16 → 1 | 6.3% | **Highest CPSL (`T03`: $8,900.00/lease)** |

## 4. Closed-Loop Decision Audit (`FLOW-105` Integration with `decisions.csv`)

Every historical decision in `data/ops/decisions.csv` is evaluated dynamically by `src/domain/learner.ts` using our conjugate Gamma-Poisson model (`alpha0 = 1, beta0 = $3250`):

- **`decisions:X001` (`2026-05`, `P01`, `Zillow`, `increase +$300/mo`, `accepted = yes`):** Failed increase: accepting +$300/mo in 2026-05 burned $8170 over 5 post-decision months ($9690 total, Pr(K=0) at the prior mean rate = 8.1%) with 0 signed leases ($1500 direct regret). Posterior CPSL degraded from $4770.00 to $12940.00, flipping next action to a full cut.
- **`decisions:X004` (`2026-06`, `P03`, `Apartment List`, `decrease -$300/mo`, `accepted = no`):** Rejected cut cost money: operator declined the -$300/mo cut in 2026-06 ($1200 direct counterfactual regret), and Apartment List at P03 subsequently burned $2960 over 4 months with 0 leases.
- **`decisions:X006` (`2026-06`, `P05`, `Rent.`, `decrease -$250/mo`, `accepted = no`):** Rejected cut cost money: operator declined the -$250/mo cut in 2026-06 ($1000 direct counterfactual regret), and Rent. at P05 subsequently burned $1900 over 4 months with 0 leases.
- **`decisions:X008` (`2026-07`, `P07`, `Rent.`, `decrease -$150/mo`, `accepted = yes`):** Confirmed waste reduction: cutting $150/mo in 2026-07 on Rent. at P07 saved spend on a channel that produced 0 leases ($1910 post-decision spend, Pr(K=0) = 55.6%); recommend cutting all remaining spend.
- **`decisions:X009` (`2026-08`, `P01`, `Facebook Ads`, `decrease -$200/mo`, `accepted = yes`):** Small-sample guard active: post-decision window is only 2 months ($950 spend, 0 leases). At the portfolio prior mean rate ($3250/lease), Pr(K=0) = 74.7%, so conjugate shrinkage keeps Facebook Ads at P01 at $3295.00 instead of over-penalizing a 2-month sample.
- **`decisions:X010` (`2026-08`, `P08`, `Zillow`, `increase +$150/mo`, `accepted = no`):** Correctly rejected increase: operator declined the +$150/mo increase in 2026-08, avoiding additional waste on Zillow at P08, which burned $6650 across all 6 months ($4580 pre + $2070 post) with 0 signed leases (posterior CPSL $9900.00); recommend cutting all remaining spend.

### Next Logged Budget Decisions (`2026-10` — `decisions.csv` Schema)

```csv
decision_id,month,property_id,source,recommendation,delta_usd,accepted,decided_by
X011,2026-10,P01,Apartments.com,increase,150,pending,flowiq_copilot
X012,2026-10,P01,Facebook Ads,decrease,-100,pending,flowiq_copilot
X013,2026-10,P01,Zillow,decrease,-2090,pending,flowiq_copilot
X014,2026-10,P02,Apartments.com,increase,250,pending,flowiq_copilot
X015,2026-10,P02,Google Ads,decrease,-250,pending,flowiq_copilot
X016,2026-10,P03,Apartments.com,increase,250,pending,flowiq_copilot
X017,2026-10,P03,Apartment List,decrease,-830,pending,flowiq_copilot
X018,2026-10,P04,Rent.,increase,250,pending,flowiq_copilot
X019,2026-10,P05,Facebook Ads,increase,250,pending,flowiq_copilot
X020,2026-10,P05,Rent.,decrease,-450,pending,flowiq_copilot
```
