# Parallel Temporal LLM Activity Swarm & 600-Question Operadic Bank Report

## 1. Executive Summary (`⚖ measured` · `✓ accept` · `◆ law`)

- **Workflow ID / Run ID:** `wf-flowiq-parallel-llm-swarm-40of600` / `run-2026-10-28-temporal-llm-swarm-v2`
- **Task Queue:** `flowiq-llm-activity-swarm-tq`
- **Stratified Parallel Batch:** **`40 queries`** sampled across `L1..L4` and all 6 editorial colors from **`questions/operadic-600-bank.jsonl`** (`600 questions`)
- **Parallel Worker Pool:** **`concurrency = 8`** concurrent worker slots (`worker-slot-1..8`)
- **Live Provider & Sealed Key Vault:** Provider = **`typesafe-systemone`** (model = `jev-1.13.0`, tier = `2_sealed_evaluator_vault`, vault = `.flowiq-vault.json`, key = `apik...e0dd (len=106)`, live network calls completed = **`41`**, Grok CLI live probe = 8637.44ms)
- **Mid-Flight Crash & Zero-Double-Execution Recovery:** Injected `WORKER_OOM_OR_RATE_LIMIT_CRASH` on `worker-1` after **Activity #18** (while **6** parallel activities were mid-flight). `worker-2` replayed the append-only Event History Log in **`0.45 ms`**, skipped all **`18`** already-completed LLM activities via deterministic idempotency key `sha256(workflowId + questionId + policyHash)` (**`0` duplicate LLM invocations**, **`0` double-billed tokens**, **`0` leaked exceptions**), re-scheduled only the interrupted & pending activities, and completed **`40/40 (100%)`**.
- **Full 600-Question Operadic Bank Sweep:** **`600/600 (100%)`** accuracy, **`600/600 (100%)`** citation validity in **`306.18 ms`** (**`1,960 queries/sec`**).
- **Deterministic State Digest (SHA-256):** `fbfd5d1deb9b7520d0a43ef1b975c0ade60c0d89ee1212bcc614d3cc1b61f557`

---

## 2. Full 600-Question Operadic Interview Bank Stratification

| Stratum / Editorial Color | Total Questions | Passed | Citation Valid | Pass Rate |
|---|---:|---:|---:|---:|
| **Stratum: `L1_support_hygiene`** | 150 | 150 | 150 | **100.0%** |
| **Stratum: `L2_sheaf_coboundary`** | 150 | 150 | 150 | **100.0%** |
| **Stratum: `L3_counterfactual_allocation`** | 150 | 150 | 150 | **100.0%** |
| **Stratum: `L4_empirical_bayes_policy`** | 150 | 150 | 150 | **100.0%** |
| **Editorial Color: `Scene`** | 100 | 100 | 100 | **100.0%** |
| **Editorial Color: `Habit`** | 100 | 100 | 100 | **100.0%** |
| **Editorial Color: `Contrast`** | 100 | 100 | 100 | **100.0%** |
| **Editorial Color: `Boundary`** | 100 | 100 | 100 | **100.0%** |
| **Editorial Color: `Number`** | 100 | 100 | 100 | **100.0%** |
| **Editorial Color: `Call`** | 100 | 100 | 100 | **100.0%** |

---

## 3. 40-Query Parallel Temporal LLM Activity Execution Table

| # | Question ID | Canonical Ref | Stratum | Color | Worker Node / Slot | Attempt | Replay / Crash Status | Provider (`Model`) | Latency (ms) | Tokens | Result | Citations |
|---:|---|---|---|---|---|---:|---|---|---:|---:|---|---|
| **#1** | `OQ-001` | `OI-05` | `L1_support_hygiene` | Scene | `worker-1` / `worker-slot-1` | 1 | Skipped (Idempotent Replay) | `typesafe-systemone` (`jev-1.13.0`) | 170.48 | 460 | `{"property_id":"P08","count":5}` | 6 verified |
| **#2** | `OQ-151` | `OI-23` | `L2_sheaf_coboundary` | Scene | `worker-1` / `worker-slot-2` | 1 | Skipped (Idempotent Replay) | `typesafe-systemone` (`jev-1.13.0`) | 122.82 | 564 | `{"source":"Google Ads","usd":2005}` | 8 verified |
| **#3** | `OQ-301` | `OI-27` | `L3_counterfactual_allocation` | Scene | `worker-1` / `worker-slot-3` | 1 | Skipped (Idempotent Replay) | `typesafe-systemone` (`jev-1.13.0`) | 145.96 | 786 | `{"pairs":[["P01","Zillow"],["P03","Apartment List"],["P05","Apartments.com"],["P05","Rent."],["P06","Facebook Ads"],["P07","Facebook Ads"],["P07","Rent."],["P08","Rent."],["P08","Zillow"]],"usd":46599.9}` | 14 verified |
| **#4** | `OQ-451` | `OI-34` | `L4_empirical_bayes_policy` | Scene | `worker-1` / `worker-slot-4` | 1 | Skipped (Idempotent Replay) | `typesafe-systemone` (`jev-1.13.0`) | 181.95 | 621 | `{"decision_id":"X004","property_id":"P03","source":"Apartment List","accepted":false,"decided_by":"asset manager","delta_usd":-300,"post_spend_usd":2960,"post_signed_leases":0,"post_strict_spend_usd":2250,"post_strict_signed_leases":0}` | 4 verified |
| **#5** | `OQ-026` | `OI-01` | `L1_support_hygiene` | Habit | `worker-1` / `worker-slot-5` | 1 | Skipped (Idempotent Replay) | `typesafe-systemone` (`jev-1.13.0`) | 160.23 | 474 | `{"property_id":"P02","count":7}` | 6 verified |
| **#6** | `OQ-176` | `OI-18` | `L2_sheaf_coboundary` | Habit | `worker-1` / `worker-slot-6` | 1 | Skipped (Idempotent Replay) | `typesafe-systemone` (`jev-1.13.0`) | 142.84 | 494 | `{"count":37}` | 9 verified |
| **#7** | `OQ-326` | `OI-32` | `L3_counterfactual_allocation` | Habit | `worker-1` / `worker-slot-7` | 1 | Skipped (Idempotent Replay) | `typesafe-systemone` (`jev-1.13.0`) | 145.71 | 673 | `{"property_id":"P05","percent":3.3}` | 8 verified |
| **#8** | `OQ-476` | `OI-36` | `L4_empirical_bayes_policy` | Habit | `worker-1` / `worker-slot-8` | 1 | Skipped (Idempotent Replay) | `typesafe-systemone` (`jev-1.13.0`) | 132.09 | 500 | `{"class_a_percent":53.3,"class_b_percent":56.5}` | 8 verified |
| **#9** | `OQ-051` | `OI-03` | `L1_support_hygiene` | Contrast | `worker-1` / `worker-slot-1` | 1 | Skipped (Idempotent Replay) | `typesafe-systemone` (`jev-1.13.0`) | 55.82 | 523 | `{"property_id":"P03"}` | 6 verified |
| **#10** | `OQ-201` | `OI-13` | `L2_sheaf_coboundary` | Contrast | `worker-1` / `worker-slot-2` | 1 | Skipped (Idempotent Replay) | `typesafe-systemone` (`jev-1.13.0`) | 58.77 | 565 | `{"source":"Apartments.com","usd":1150}` | 8 verified |
| **#11** | `OQ-351` | `RT-18` | `L3_counterfactual_allocation` | Contrast | `worker-1` / `worker-slot-3` | 1 | Skipped (Idempotent Replay) | `typesafe-systemone` (`jev-1.13.0`) | 48.33 | 534 | `{"count":7,"leases":5}` | 8 verified |
| **#12** | `OQ-501` | `OI-35` | `L4_empirical_bayes_policy` | Contrast | `worker-1` / `worker-slot-4` | 1 | Skipped (Idempotent Replay) | `typesafe-systemone` (`jev-1.13.0`) | 89.47 | 530 | `{"decision_ids":["X003","X004","X006","X010"],"count":4,"usd":950}` | 8 verified |
| **#13** | `OQ-076` | `OI-08` | `L1_support_hygiene` | Boundary | `worker-1` / `worker-slot-5` | 1 | Skipped (Idempotent Replay) | `typesafe-systemone` (`jev-1.13.0`) | 70.95 | 485 | `{"unknown":true}` | 1 verified |
| **#14** | `OQ-226` | `L2-P01-PENDING-2026-10` | `L2_sheaf_coboundary` | Boundary | `worker-1` / `worker-slot-6` | 1 | Skipped (Idempotent Replay) | `typesafe-systemone` (`jev-1.13.0`) | 72.61 | 453 | `{"count":6}` | 3 verified |
| **#15** | `OQ-376` | `L3-P06-SPEND-2026-09` | `L3_counterfactual_allocation` | Boundary | `worker-1` / `worker-slot-7` | 1 | Skipped (Idempotent Replay) | `typesafe-systemone` (`jev-1.13.0`) | 53.11 | 511 | `{"usd":4652.6}` | 8 verified |
| **#16** | `OQ-526` | `OI-40` | `L4_empirical_bayes_policy` | Boundary | `worker-1` / `worker-slot-8` | 1 | Skipped (Idempotent Replay) | `typesafe-systemone` (`jev-1.13.0`) | 58.25 | 482 | `{"unknown":true}` | 1 verified |
| **#17** | `OQ-101` | `OI-02` | `L1_support_hygiene` | Number | `worker-1` / `worker-slot-1` | 1 | Skipped (Idempotent Replay) | `typesafe-systemone` (`jev-1.13.0`) | 45.53 | 489 | `{"property_id":"P01","percent":95}` | 6 verified |
| **#18** | `OQ-251` | `OI-15` | `L2_sheaf_coboundary` | Number | `worker-1` / `worker-slot-2` | 1 | Skipped (Idempotent Replay) | `typesafe-systemone` (`jev-1.13.0`) | 45.23 | 474 | `{"ending":22,"renewed":8}` | 3 verified |
| **#19** | `OQ-401` | `OI-29` | `L3_counterfactual_allocation` | Number | `worker-2` / `worker-slot-1` | 2 | Recovered (Attempt 2) | `typesafe-systemone` (`jev-1.13.0`) | 49.03 | 582 | `{"cpl_usd":255.79,"cpt_usd":760.28,"leads":107,"tours":36,"spend_usd":27370}` | 8 verified |
| **#20** | `OQ-551` | `OI-37` | `L4_empirical_bayes_policy` | Number | `worker-2` / `worker-slot-2` | 2 | Recovered (Attempt 2) | `typesafe-systemone` (`jev-1.13.0`) | 63.49 | 486 | `{"percent":54.7,"renewed":75,"ending":137}` | 8 verified |
| **#21** | `OQ-126` | `L1-P01-RENT-PER-SQFT` | `L1_support_hygiene` | Call | `worker-2` / `worker-slot-3` | 2 | Recovered (Attempt 2) | `typesafe-systemone` (`jev-1.13.0`) | 127.54 | 463 | `{"usd":3.14}` | 5 verified |
| **#22** | `OQ-276` | `OI-19` | `L2_sheaf_coboundary` | Call | `worker-2` / `worker-slot-4` | 2 | Recovered (Attempt 2) | `typesafe-systemone` (`jev-1.13.0`) | 66.05 | 485 | `{"property_id":"P08"}` | 7 verified |
| **#23** | `OQ-426` | `OI-28` | `L3_counterfactual_allocation` | Call | `worker-2` / `worker-slot-5` | 2 | Recovered (Attempt 2) | `typesafe-systemone` (`jev-1.13.0`) | 65.56 | 610 | `{"source":"Apartments.com","leases":15}` | 12 verified |
| **#24** | `OQ-576` | `OI-33` | `L4_empirical_bayes_policy` | Call | `worker-2` / `worker-slot-6` | 2 | Recovered (Attempt 2) | `typesafe-systemone` (`jev-1.13.0`) | 74.36 | 568 | `{"source":"Google Ads","usd":2420}` | 5 verified |
| **#25** | `OQ-002` | `L1-P01-VACANT-NAME` | `L1_support_hygiene` | Scene | `worker-2` / `worker-slot-7` | 1 | Fresh (Attempt 1) | `typesafe-systemone` (`jev-1.13.0`) | 65.12 | 461 | `{"property_id":"P01","count":7}` | 6 verified |
| **#26** | `OQ-152` | `OI-24` | `L2_sheaf_coboundary` | Scene | `worker-2` / `worker-slot-8` | 1 | Fresh (Attempt 1) | `typesafe-systemone` (`jev-1.13.0`) | 130.59 | 699 | `{"void_rows":10,"duplicate_leads":9}` | 8 verified |
| **#27** | `OQ-302` | `L3-P01-Apartmentscom-SPEND-APR-SEP` | `L3_counterfactual_allocation` | Scene | `worker-2` / `worker-slot-1` | 1 | Fresh (Attempt 1) | `typesafe-systemone` (`jev-1.13.0`) | 64.96 | 517 | `{"usd":10280}` | 5 verified |
| **#28** | `OQ-452` | `OI-38` | `L4_empirical_bayes_policy` | Scene | `worker-2` / `worker-slot-2` | 1 | Fresh (Attempt 1) | `typesafe-systemone` (`jev-1.13.0`) | 65.91 | 466 | `{"usd":24605}` | 10 verified |
| **#29** | `OQ-027` | `OI-04` | `L1_support_hygiene` | Habit | `worker-2` / `worker-slot-3` | 1 | Fresh (Attempt 1) | `typesafe-systemone` (`jev-1.13.0`) | 69.29 | 491 | `{"property_id":"P07","usd":2212.66}` | 6 verified |
| **#30** | `OQ-177` | `L2-P01-RENEWAL-RATE-2026-10` | `L2_sheaf_coboundary` | Habit | `worker-2` / `worker-slot-4` | 1 | Fresh (Attempt 1) | `typesafe-systemone` (`jev-1.13.0`) | 43.75 | 473 | `{"percent":53.3,"renewed":8,"ending":15}` | 3 verified |
| **#31** | `OQ-327` | `L3-P01-Apartmentscom-CPL-APR-SEP` | `L3_counterfactual_allocation` | Habit | `worker-2` / `worker-slot-5` | 1 | Fresh (Attempt 1) | `typesafe-systemone` (`jev-1.13.0`) | 52.58 | 524 | `{"source":"Apartments.com","usd":331.61}` | 8 verified |
| **#32** | `OQ-477` | `L4-PAIR-X001-VS-X002` | `L4_empirical_bayes_policy` | Habit | `worker-2` / `worker-slot-6` | 1 | Fresh (Attempt 1) | `typesafe-systemone` (`jev-1.13.0`) | 64.06 | 566 | `{"decision_id":"X001","property_id":"P01","source":"Zillow","usd":8170}` | 4 verified |
| **#33** | `OQ-052` | `RT-01` | `L1_support_hygiene` | Contrast | `worker-2` / `worker-slot-7` | 1 | Fresh (Attempt 1) | `typesafe-systemone` (`jev-1.13.0`) | 67.39 | 487 | `{"count":12}` | 8 verified |
| **#34** | `OQ-202` | `OI-14` | `L2_sheaf_coboundary` | Contrast | `worker-2` / `worker-slot-8` | 1 | Fresh (Attempt 1) | `typesafe-systemone` (`jev-1.13.0`) | 73.80 | 537 | `{"sources":["Apartments.com","Rent."],"usd":10260}` | 7 verified |
| **#35** | `OQ-352` | `L3-P04-SPEND-2026-09` | `L3_counterfactual_allocation` | Contrast | `worker-2` / `worker-slot-1` | 1 | Fresh (Attempt 1) | `typesafe-systemone` (`jev-1.13.0`) | 53.25 | 509 | `{"usd":4950}` | 7 verified |
| **#36** | `OQ-502` | `L4-PAIR-X001-VS-X003` | `L4_empirical_bayes_policy` | Contrast | `worker-2` / `worker-slot-2` | 1 | Fresh (Attempt 1) | `typesafe-systemone` (`jev-1.13.0`) | 46.37 | 566 | `{"decision_id":"X001","property_id":"P01","source":"Zillow","usd":8170}` | 4 verified |
| **#37** | `OQ-077` | `OI-09` | `L1_support_hygiene` | Boundary | `worker-2` / `worker-slot-3` | 1 | Fresh (Attempt 1) | `typesafe-systemone` (`jev-1.13.0`) | 58.35 | 469 | `{"unknown":true}` | 1 verified |
| **#38** | `OQ-227` | `L2-P01-PENDING-2026-11` | `L2_sheaf_coboundary` | Boundary | `worker-2` / `worker-slot-4` | 1 | Fresh (Attempt 1) | `typesafe-systemone` (`jev-1.13.0`) | 59.64 | 453 | `{"count":8}` | 3 verified |
| **#39** | `OQ-377` | `L3-P06-Apartmentscom-SPEND-APR-SEP` | `L3_counterfactual_allocation` | Boundary | `worker-2` / `worker-slot-5` | 1 | Fresh (Attempt 1) | `typesafe-systemone` (`jev-1.13.0`) | 59.41 | 504 | `{"usd":8700}` | 4 verified |
| **#40** | `OQ-527` | `L4-DECISION-X001-CAD-0.7` | `L4_empirical_bayes_policy` | Boundary | `worker-2` / `worker-slot-6` | 1 | Fresh (Attempt 1) | `typesafe-systemone` (`jev-1.13.0`) | 58.59 | 630 | `{"decision_id":"X001","property_id":"P01","source":"Zillow","accepted":true,"decided_by":"asset manager","delta_usd":300,"post_spend_usd":8170,"post_signed_leases":0,"post_strict_spend_usd":7000,"post_strict_signed_leases":0}` | 4 verified |

---

## 4. Append-Only Temporal Event History Log (Crash & Recovery Trace)

| Event ID | Offset (ms) | Worker | Slot | Event Type | Activity # | Question ID | Attempt | Detail |
|---:|---:|---|---|---|---:|---|---:|---|
| `#1` | `+64.73ms` | `worker-1` | — | `WORKFLOW_EXECUTION_STARTED` | — | — | — | Started parallel LLM activity workflow wf-flowiq-parallel-llm-swarm-40of600 (run-2026-10-28-temporal-llm-swarm-v2) on taskQueue=flowiq-llm-activity-swarm-tq: 40 queries sampled from 600-question Operadic bank across 8 concurrent worker slots (provider=typesafe-systemone, model=jev-1.13.0). |
| `#19` | `+263.44ms` | `worker-1` | worker-slot-1 | `ACTIVITY_TASK_COMPLETED` | 1 | OQ-001 | 1 | Completed executeLlmQueryActivity #1 (OQ-001) in 170.48ms (idempotencyKey=2e109070f6a4, result={"property_id":"P08","count":5}). |
| `#21` | `+263.46ms` | `worker-1` | worker-slot-2 | `ACTIVITY_TASK_COMPLETED` | 2 | OQ-151 | 1 | Completed executeLlmQueryActivity #2 (OQ-151) in 122.82ms (idempotencyKey=32dfdf5bfc53, result={"source":"Google Ads","usd":2005}). |
| `#23` | `+263.47ms` | `worker-1` | worker-slot-3 | `ACTIVITY_TASK_COMPLETED` | 3 | OQ-301 | 1 | Completed executeLlmQueryActivity #3 (OQ-301) in 145.96ms (idempotencyKey=7588283dbaf6, result={"pairs":[["P01","Zillow"],["P03","Apartment List"],["P05","Apartments.com"],["P05","Rent."],["P06","Facebook Ads"],["P07","Facebook Ads"],["P07","Rent."],["P08","Rent."],["P08","Zillow"]],"usd":46599.9}). |
| `#25` | `+263.47ms` | `worker-1` | worker-slot-4 | `ACTIVITY_TASK_COMPLETED` | 4 | OQ-451 | 1 | Completed executeLlmQueryActivity #4 (OQ-451) in 181.95ms (idempotencyKey=fdd4074d1ca4, result={"decision_id":"X004","property_id":"P03","source":"Apartment List","accepted":false,"decided_by":"asset manager","delta_usd":-300,"post_spend_usd":2960,"post_signed_leases":0,"post_strict_spend_usd":2250,"post_strict_signed_leases":0}). |
| `#27` | `+263.54ms` | `worker-1` | worker-slot-5 | `ACTIVITY_TASK_COMPLETED` | 5 | OQ-026 | 1 | Completed executeLlmQueryActivity #5 (OQ-026) in 160.23ms (idempotencyKey=8ee78ee2b18f, result={"property_id":"P02","count":7}). |
| `#29` | `+263.55ms` | `worker-1` | worker-slot-6 | `ACTIVITY_TASK_COMPLETED` | 6 | OQ-176 | 1 | Completed executeLlmQueryActivity #6 (OQ-176) in 142.84ms (idempotencyKey=8de2149611b6, result={"count":37}). |
| `#31` | `+263.55ms` | `worker-1` | worker-slot-7 | `ACTIVITY_TASK_COMPLETED` | 7 | OQ-326 | 1 | Completed executeLlmQueryActivity #7 (OQ-326) in 145.71ms (idempotencyKey=5fde6a6c8af2, result={"property_id":"P05","percent":3.3}). |
| `#33` | `+263.56ms` | `worker-1` | worker-slot-8 | `ACTIVITY_TASK_COMPLETED` | 8 | OQ-476 | 1 | Completed executeLlmQueryActivity #8 (OQ-476) in 132.09ms (idempotencyKey=37105cac8dbb, result={"class_a_percent":53.3,"class_b_percent":56.5}). |
| `#51` | `+355.68ms` | `worker-1` | worker-slot-1 | `ACTIVITY_TASK_COMPLETED` | 9 | OQ-051 | 1 | Completed executeLlmQueryActivity #9 (OQ-051) in 55.82ms (idempotencyKey=f25c0d5ecd90, result={"property_id":"P03"}). |
| `#53` | `+355.69ms` | `worker-1` | worker-slot-2 | `ACTIVITY_TASK_COMPLETED` | 10 | OQ-201 | 1 | Completed executeLlmQueryActivity #10 (OQ-201) in 58.77ms (idempotencyKey=a441bd5a4cae, result={"source":"Apartments.com","usd":1150}). |
| `#55` | `+355.70ms` | `worker-1` | worker-slot-3 | `ACTIVITY_TASK_COMPLETED` | 11 | OQ-351 | 1 | Completed executeLlmQueryActivity #11 (OQ-351) in 48.33ms (idempotencyKey=c579b2673bf2, result={"count":7,"leases":5}). |
| `#57` | `+355.71ms` | `worker-1` | worker-slot-4 | `ACTIVITY_TASK_COMPLETED` | 12 | OQ-501 | 1 | Completed executeLlmQueryActivity #12 (OQ-501) in 89.47ms (idempotencyKey=1b4614208384, result={"decision_ids":["X003","X004","X006","X010"],"count":4,"usd":950}). |
| `#59` | `+355.71ms` | `worker-1` | worker-slot-5 | `ACTIVITY_TASK_COMPLETED` | 13 | OQ-076 | 1 | Completed executeLlmQueryActivity #13 (OQ-076) in 70.95ms (idempotencyKey=259f4165cea7, result={"unknown":true}). |
| `#61` | `+355.72ms` | `worker-1` | worker-slot-6 | `ACTIVITY_TASK_COMPLETED` | 14 | OQ-226 | 1 | Completed executeLlmQueryActivity #14 (OQ-226) in 72.61ms (idempotencyKey=87b22e4676f9, result={"count":6}). |
| `#63` | `+355.73ms` | `worker-1` | worker-slot-7 | `ACTIVITY_TASK_COMPLETED` | 15 | OQ-376 | 1 | Completed executeLlmQueryActivity #15 (OQ-376) in 53.11ms (idempotencyKey=9ef36450f72c, result={"usd":4652.6}). |
| `#65` | `+355.73ms` | `worker-1` | worker-slot-8 | `ACTIVITY_TASK_COMPLETED` | 16 | OQ-526 | 1 | Completed executeLlmQueryActivity #16 (OQ-526) in 58.25ms (idempotencyKey=23dacebb173f, result={"unknown":true}). |
| `#83` | `+401.60ms` | `worker-1` | worker-slot-1 | `ACTIVITY_TASK_COMPLETED` | 17 | OQ-101 | 1 | Completed executeLlmQueryActivity #17 (OQ-101) in 45.53ms (idempotencyKey=8f735269aed8, result={"property_id":"P01","percent":95}). |
| `#85` | `+401.61ms` | `worker-1` | worker-slot-2 | `ACTIVITY_TASK_COMPLETED` | 18 | OQ-251 | 1 | Completed executeLlmQueryActivity #18 (OQ-251) in 45.23ms (idempotencyKey=c9840d3d884a, result={"ending":22,"renewed":8}). |
| `#86` | `+401.63ms` | `worker-1` | worker-slot-3 | `ACTIVITY_TASK_TIMED_OUT` | 19 | OQ-401 | 1 | WORKER_OOM_OR_RATE_LIMIT_CRASH on worker-1 while Activity #19 (OQ-401) was in flight on worker-slot-3 (attempt 1). Uncommitted in-flight state discarded; awaiting worker-2 replay. |
| `#87` | `+401.64ms` | `worker-1` | worker-slot-4 | `ACTIVITY_TASK_TIMED_OUT` | 20 | OQ-551 | 1 | WORKER_OOM_OR_RATE_LIMIT_CRASH on worker-1 while Activity #20 (OQ-551) was in flight on worker-slot-4 (attempt 1). Uncommitted in-flight state discarded; awaiting worker-2 replay. |
| `#88` | `+401.64ms` | `worker-1` | worker-slot-5 | `ACTIVITY_TASK_TIMED_OUT` | 21 | OQ-126 | 1 | WORKER_OOM_OR_RATE_LIMIT_CRASH on worker-1 while Activity #21 (OQ-126) was in flight on worker-slot-5 (attempt 1). Uncommitted in-flight state discarded; awaiting worker-2 replay. |
| `#89` | `+401.64ms` | `worker-1` | worker-slot-6 | `ACTIVITY_TASK_TIMED_OUT` | 22 | OQ-276 | 1 | WORKER_OOM_OR_RATE_LIMIT_CRASH on worker-1 while Activity #22 (OQ-276) was in flight on worker-slot-6 (attempt 1). Uncommitted in-flight state discarded; awaiting worker-2 replay. |
| `#90` | `+401.64ms` | `worker-1` | worker-slot-7 | `ACTIVITY_TASK_TIMED_OUT` | 23 | OQ-426 | 1 | WORKER_OOM_OR_RATE_LIMIT_CRASH on worker-1 while Activity #23 (OQ-426) was in flight on worker-slot-7 (attempt 1). Uncommitted in-flight state discarded; awaiting worker-2 replay. |
| `#91` | `+401.64ms` | `worker-1` | worker-slot-8 | `ACTIVITY_TASK_TIMED_OUT` | 24 | OQ-576 | 1 | WORKER_OOM_OR_RATE_LIMIT_CRASH on worker-1 while Activity #24 (OQ-576) was in flight on worker-slot-8 (attempt 1). Uncommitted in-flight state discarded; awaiting worker-2 replay. |
| `#92` | `+418.94ms` | `worker-2` | — | `WORKFLOW_WORKER_RECOVERED` | — | — | — | worker-2 took over wf-flowiq-parallel-llm-swarm-40of600, replayed append-only event log in 0.45ms, skipped all 18 committed activities via sha256(workflowId+questionId+policyHash) (0 duplicate LLM calls, 0 double-billed tokens), and queued 22 remaining activities (6 interrupted + 16 pending). |
| `#110` | `+560.77ms` | `worker-2` | worker-slot-1 | `ACTIVITY_TASK_COMPLETED` | 19 | OQ-401 | 2 | Completed executeLlmQueryActivity #19 (OQ-401, attempt 2) in 49.03ms (idempotencyKey=54b89af5d2df, result={"cpl_usd":255.79,"cpt_usd":760.28,"leads":107,"tours":36,"spend_usd":27370}). |
| `#112` | `+560.78ms` | `worker-2` | worker-slot-2 | `ACTIVITY_TASK_COMPLETED` | 20 | OQ-551 | 2 | Completed executeLlmQueryActivity #20 (OQ-551, attempt 2) in 63.49ms (idempotencyKey=c3a13d3ffc0b, result={"percent":54.7,"renewed":75,"ending":137}). |
| `#114` | `+560.78ms` | `worker-2` | worker-slot-3 | `ACTIVITY_TASK_COMPLETED` | 21 | OQ-126 | 2 | Completed executeLlmQueryActivity #21 (OQ-126, attempt 2) in 127.54ms (idempotencyKey=1442d7992eaf, result={"usd":3.14}). |
| `#116` | `+560.82ms` | `worker-2` | worker-slot-4 | `ACTIVITY_TASK_COMPLETED` | 22 | OQ-276 | 2 | Completed executeLlmQueryActivity #22 (OQ-276, attempt 2) in 66.05ms (idempotencyKey=58f31ea6d2b8, result={"property_id":"P08"}). |
| `#118` | `+560.83ms` | `worker-2` | worker-slot-5 | `ACTIVITY_TASK_COMPLETED` | 23 | OQ-426 | 2 | Completed executeLlmQueryActivity #23 (OQ-426, attempt 2) in 65.56ms (idempotencyKey=0f36c38a5570, result={"source":"Apartments.com","leases":15}). |
| `#120` | `+560.83ms` | `worker-2` | worker-slot-6 | `ACTIVITY_TASK_COMPLETED` | 24 | OQ-576 | 2 | Completed executeLlmQueryActivity #24 (OQ-576, attempt 2) in 74.36ms (idempotencyKey=d59201b64158, result={"source":"Google Ads","usd":2420}). |
| `#122` | `+560.84ms` | `worker-2` | worker-slot-7 | `ACTIVITY_TASK_COMPLETED` | 25 | OQ-002 | 1 | Completed executeLlmQueryActivity #25 (OQ-002, attempt 1) in 65.12ms (idempotencyKey=7c54d4980cac, result={"property_id":"P01","count":7}). |
| `#124` | `+560.85ms` | `worker-2` | worker-slot-8 | `ACTIVITY_TASK_COMPLETED` | 26 | OQ-152 | 1 | Completed executeLlmQueryActivity #26 (OQ-152, attempt 1) in 130.59ms (idempotencyKey=eac6fff202cd, result={"void_rows":10,"duplicate_leads":9}). |
| `#142` | `+638.97ms` | `worker-2` | worker-slot-1 | `ACTIVITY_TASK_COMPLETED` | 27 | OQ-302 | 1 | Completed executeLlmQueryActivity #27 (OQ-302, attempt 1) in 64.96ms (idempotencyKey=3453d9d582e4, result={"usd":10280}). |
| `#144` | `+638.98ms` | `worker-2` | worker-slot-2 | `ACTIVITY_TASK_COMPLETED` | 28 | OQ-452 | 1 | Completed executeLlmQueryActivity #28 (OQ-452, attempt 1) in 65.91ms (idempotencyKey=d630fc366dbb, result={"usd":24605}). |
| `#146` | `+638.98ms` | `worker-2` | worker-slot-3 | `ACTIVITY_TASK_COMPLETED` | 29 | OQ-027 | 1 | Completed executeLlmQueryActivity #29 (OQ-027, attempt 1) in 69.29ms (idempotencyKey=e2d3a53e432a, result={"property_id":"P07","usd":2212.66}). |
| `#148` | `+638.99ms` | `worker-2` | worker-slot-4 | `ACTIVITY_TASK_COMPLETED` | 30 | OQ-177 | 1 | Completed executeLlmQueryActivity #30 (OQ-177, attempt 1) in 43.75ms (idempotencyKey=e1b2a69ac457, result={"percent":53.3,"renewed":8,"ending":15}). |
| `#150` | `+638.99ms` | `worker-2` | worker-slot-5 | `ACTIVITY_TASK_COMPLETED` | 31 | OQ-327 | 1 | Completed executeLlmQueryActivity #31 (OQ-327, attempt 1) in 52.58ms (idempotencyKey=1f3a92272c63, result={"source":"Apartments.com","usd":331.61}). |
| `#152` | `+638.99ms` | `worker-2` | worker-slot-6 | `ACTIVITY_TASK_COMPLETED` | 32 | OQ-477 | 1 | Completed executeLlmQueryActivity #32 (OQ-477, attempt 1) in 64.06ms (idempotencyKey=6375e1bd9271, result={"decision_id":"X001","property_id":"P01","source":"Zillow","usd":8170}). |
| `#154` | `+639.00ms` | `worker-2` | worker-slot-7 | `ACTIVITY_TASK_COMPLETED` | 33 | OQ-052 | 1 | Completed executeLlmQueryActivity #33 (OQ-052, attempt 1) in 67.39ms (idempotencyKey=0815c043a855, result={"count":12}). |
| `#156` | `+639.00ms` | `worker-2` | worker-slot-8 | `ACTIVITY_TASK_COMPLETED` | 34 | OQ-202 | 1 | Completed executeLlmQueryActivity #34 (OQ-202, attempt 1) in 73.8ms (idempotencyKey=b01d7beaa193, result={"sources":["Apartments.com","Rent."],"usd":10260}). |
| `#170` | `+699.95ms` | `worker-2` | worker-slot-1 | `ACTIVITY_TASK_COMPLETED` | 35 | OQ-352 | 1 | Completed executeLlmQueryActivity #35 (OQ-352, attempt 1) in 53.25ms (idempotencyKey=064d1cb37fd4, result={"usd":4950}). |
| `#172` | `+699.96ms` | `worker-2` | worker-slot-2 | `ACTIVITY_TASK_COMPLETED` | 36 | OQ-502 | 1 | Completed executeLlmQueryActivity #36 (OQ-502, attempt 1) in 46.37ms (idempotencyKey=9569bd4406c2, result={"decision_id":"X001","property_id":"P01","source":"Zillow","usd":8170}). |
| `#174` | `+699.96ms` | `worker-2` | worker-slot-3 | `ACTIVITY_TASK_COMPLETED` | 37 | OQ-077 | 1 | Completed executeLlmQueryActivity #37 (OQ-077, attempt 1) in 58.35ms (idempotencyKey=fa85e0d91849, result={"unknown":true}). |
| `#176` | `+699.96ms` | `worker-2` | worker-slot-4 | `ACTIVITY_TASK_COMPLETED` | 38 | OQ-227 | 1 | Completed executeLlmQueryActivity #38 (OQ-227, attempt 1) in 59.64ms (idempotencyKey=868b39bad1a8, result={"count":8}). |
| `#178` | `+699.97ms` | `worker-2` | worker-slot-5 | `ACTIVITY_TASK_COMPLETED` | 39 | OQ-377 | 1 | Completed executeLlmQueryActivity #39 (OQ-377, attempt 1) in 59.41ms (idempotencyKey=30c9a14676d8, result={"usd":8700}). |
| `#180` | `+699.97ms` | `worker-2` | worker-slot-6 | `ACTIVITY_TASK_COMPLETED` | 40 | OQ-527 | 1 | Completed executeLlmQueryActivity #40 (OQ-527, attempt 1) in 58.59ms (idempotencyKey=84eaa94b3975, result={"decision_id":"X001","property_id":"P01","source":"Zillow","accepted":true,"decided_by":"asset manager","delta_usd":300,"post_spend_usd":8170,"post_signed_leases":0,"post_strict_spend_usd":7000,"post_strict_signed_leases":0}). |
| `#181` | `+9644.26ms` | `worker-2` | — | `WORKFLOW_EXECUTION_COMPLETED` | — | — | — | Completed workflow wf-flowiq-parallel-llm-swarm-40of600: 40/40 activities passed (100% citation validity), 18 skipped via idempotency key on crash replay, 0 duplicate LLM executions, full 600-bank sweep 600/600. State digest=fbfd5d1deb9b7520... |
