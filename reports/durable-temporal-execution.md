# Durable Temporal-Style Workflow Execution & 250,000-Row Scale Report

## 1. Executive Summary (`⚖ measured` · `✓ accept` · `◆ law`)

- **Workflow ID / Run ID:** `wf-flowiq-portfolio-sheaf-250k` / `run-2026-10-28-ormus-durable-v2`
- **Task Queue:** `flowiq-sheaf-reconciliation-tq`
- **Scale Processed:** **`250,000 rows`** partitioned across **`10 shards`** (`25,000 rows/shard`)
- **Wall-Clock Execution Time:** **`46.35 ms`** (**`5,393,743 rows/sec`**)
- **Mid-Shard Fault Injection & Recovery:** Simulated PMS socket `ECONNRESET` at **Shard #6** (`row 137,500`), replayed **Shards 1–5** in **`0.00 ms`** from the append-only Event History Log, and resumed Shard #6 from its durable heartbeat cursor (`row 137,500`) on `attempt 2`.
- **Deterministic Replay State Digest (SHA-256):** `194d7a5a128fe068ff2e1836800a703574a1c551bdb688d5093bfa1b41ed0d02` (**Exact match with fault-free run:** `true`)
- **Canonical 3,858-Row Kit Anchor:** Global section `isGlobalSection = true`, Dead Spend = `$46599.90`, Counterfactual Reallocation = `+15 leases` on `Apartments.com` (`$2915.86/lease`), Gamma-Poisson Window Invariance = `true`.

---

## 2. Partitioned Shard Telemetry (`10 Shards × 25,000 Rows`)

| Shard | Region | PMS Adapter | Row Range | Void Quarantined | CAD Converted | Dup Leads Deduped | Reconciled Spend (USD) | Signed Leases | Attempts | Replayed / Resumed | State Digest Prefix |
|---:|---|---|---|---|---:|---:|---:|---:|---:|---:|---|---|
| **#1** | Chicago-North (Lincoln Park / Lakeview) | `Yardi` | `0..25,000` | 75 | 105 | 39 | $2,304,247.53 | 994 | 1 | Replayed (0ms) | `adb7c054ce1d` |
| **#2** | Chicago-Central (Streeterville / Loop) | `Entrata` | `25,000..50,000` | 94 | 104 | 64 | $2,279,187.12 | 1009 | 1 | Replayed (0ms) | `fb2c1c8e3975` |
| **#3** | Chicago-West (West Loop / Fulton Market) | `RealPage` | `50,000..75,000` | 74 | 112 | 62 | $2,281,656.87 | 1006 | 1 | Replayed (0ms) | `65186632bc4e` |
| **#4** | Chicago-South (South Loop / Printers Row) | `MRI` | `75,000..100,000` | 97 | 94 | 51 | $2,279,883.15 | 970 | 1 | Replayed (0ms) | `c9a5fe8ad05a` |
| **#5** | Chicago-NW (Logan Square / Bucktown) | `Yardi` | `100,000..125,000` | 80 | 120 | 59 | $2,292,602.95 | 996 | 1 | Replayed (0ms) | `93e7cf96e174` |
| **#6** | Midwest-Milwaukee (Third Ward) | `Yardi` | `125,000..150,000` | 75 | 118 | 47 | $2,292,847.72 | 994 | 2 | Resumed @ 137,500 | `5e8d631fae76` |
| **#7** | Midwest-Minneapolis (North Loop) | `Entrata` | `150,000..175,000` | 87 | 99 | 61 | $2,301,464.77 | 981 | 1 | Fresh Pass | `3da88763b71d` |
| **#8** | Midwest-Indianapolis (Mass Ave) | `RealPage` | `175,000..200,000` | 70 | 101 | 77 | $2,336,154.84 | 1016 | 1 | Fresh Pass | `d91d002746cd` |
| **#9** | Midwest-Columbus (Short North) | `MRI` | `200,000..225,000` | 79 | 110 | 57 | $2,281,842.38 | 992 | 1 | Fresh Pass | `c861e601a8cc` |
| **#10** | Midwest-Detroit (Midtown) | `Yardi` | `225,000..250,000` | 58 | 98 | 72 | $2,319,018.45 | 1021 | 1 | Fresh Pass | `7436825b8d47` |

---

## 3. Append-Only Temporal Event History Log (Excerpt)

| Event ID | Offset (ms) | Event Type | Shard | Attempt | Cursor Row | Detail |
|---:|---:|---|---:|---:|---:|---|
| `#1` | `+34.22ms` | `WORKFLOW_EXECUTION_STARTED` | — | — | — | Started workflow wf-flowiq-portfolio-sheaf-250k (run-2026-10-28-ormus-durable-v2) on taskQueue=flowiq-sheaf-reconciliation-tq over 250,000 rows across 10 shards (25,000 rows/shard). |
| `#2` | `+34.27ms` | `ACTIVITY_TASK_SCHEDULED` | 1 | 1 | 0 | Scheduled ingest_pms_shard & reconcile_sheaf_coboundary_shard for Shard #1 (rows 0..25,000). |
| `#3` | `+34.27ms` | `ACTIVITY_TASK_STARTED` | 1 | 1 | 0 | Worker picked up Shard #1 (attempt 1, adapter=Yardi). |
| `#4` | `+36.71ms` | `ACTIVITY_TASK_COMPLETED` | 1 | 1 | 25,000 | Completed Shard #1 in 2.28ms (stateHash=adb7c054ce1d). |
| `#5` | `+36.79ms` | `ACTIVITY_TASK_SCHEDULED` | 2 | 1 | 25,000 | Scheduled ingest_pms_shard & reconcile_sheaf_coboundary_shard for Shard #2 (rows 25,000..50,000). |
| `#6` | `+36.80ms` | `ACTIVITY_TASK_STARTED` | 2 | 1 | 25,000 | Worker picked up Shard #2 (attempt 1, adapter=Entrata). |
| `#7` | `+38.51ms` | `ACTIVITY_TASK_COMPLETED` | 2 | 1 | 50,000 | Completed Shard #2 in 1.69ms (stateHash=fb2c1c8e3975). |
| `#8` | `+38.58ms` | `ACTIVITY_TASK_SCHEDULED` | 3 | 1 | 50,000 | Scheduled ingest_pms_shard & reconcile_sheaf_coboundary_shard for Shard #3 (rows 50,000..75,000). |
| `#9` | `+38.58ms` | `ACTIVITY_TASK_STARTED` | 3 | 1 | 50,000 | Worker picked up Shard #3 (attempt 1, adapter=RealPage). |
| `#10` | `+38.98ms` | `ACTIVITY_TASK_COMPLETED` | 3 | 1 | 75,000 | Completed Shard #3 in 0.38ms (stateHash=65186632bc4e). |
| `#11` | `+39.01ms` | `ACTIVITY_TASK_SCHEDULED` | 4 | 1 | 75,000 | Scheduled ingest_pms_shard & reconcile_sheaf_coboundary_shard for Shard #4 (rows 75,000..100,000). |
| `#12` | `+39.02ms` | `ACTIVITY_TASK_STARTED` | 4 | 1 | 75,000 | Worker picked up Shard #4 (attempt 1, adapter=MRI). |
| `#13` | `+39.52ms` | `ACTIVITY_TASK_COMPLETED` | 4 | 1 | 100,000 | Completed Shard #4 in 0.5ms (stateHash=c9a5fe8ad05a). |
| `#14` | `+39.55ms` | `ACTIVITY_TASK_SCHEDULED` | 5 | 1 | 100,000 | Scheduled ingest_pms_shard & reconcile_sheaf_coboundary_shard for Shard #5 (rows 100,000..125,000). |
| `#15` | `+39.55ms` | `ACTIVITY_TASK_STARTED` | 5 | 1 | 100,000 | Worker picked up Shard #5 (attempt 1, adapter=Yardi). |
| `#16` | `+40.30ms` | `ACTIVITY_TASK_COMPLETED` | 5 | 1 | 125,000 | Completed Shard #5 in 0.74ms (stateHash=93e7cf96e174). |
| `#17` | `+40.35ms` | `ACTIVITY_TASK_SCHEDULED` | 6 | 1 | 125,000 | Scheduled ingest_pms_shard & reconcile_sheaf_coboundary_shard for Shard #6 (rows 125,000..150,000). |
| `#18` | `+40.36ms` | `ACTIVITY_TASK_STARTED` | 6 | 1 | 125,000 | Worker picked up Shard #6 (attempt 1, adapter=Yardi). |
| `#19` | `+40.39ms` | `ACTIVITY_HEARTBEAT_RECORDED` | 6 | 1 | 137,500 | Shard #6 recorded durable heartbeat cursor at row 137,500 (12,500 rows verified in shard). |
| `#20` | `+40.41ms` | `ACTIVITY_TASK_FAILED` | 6 | 1 | 137,500 | TRANSIENT FAULT INJECTED at Shard #6 row 137,500: PMS socket ECONNRESET during Entrata/Yardi batch lease pullback. Worker process recovering via Temporal Replay. |
| `#21` | `+40.42ms` | `WORKFLOW_CHECKPOINT_SAVED` | — | — | 125,000 | Deterministic Event-History Replay: skipped re-execution of Shards 1..5 (125,000 rows) in 0.00ms from append-only history log. |
| `#22` | `+40.48ms` | `ACTIVITY_TASK_RETRIED` | 6 | 2 | 137,500 | Retrying Shard #6 (attempt 2, backoff=5ms) resuming from durable heartbeat cursor row 137,500 (skipping first 12,500 rows of shard). |
| `#23` | `+40.91ms` | `ACTIVITY_TASK_COMPLETED` | 6 | 2 | 150,000 | Completed Shard #6 (attempt 2) in 0.42ms (stateHash=5e8d631fae76). |
| `#24` | `+40.95ms` | `ACTIVITY_TASK_SCHEDULED` | 7 | 1 | 150,000 | Scheduled Shard #7 (rows 150,000..175,000). |
| `#25` | `+41.34ms` | `ACTIVITY_TASK_COMPLETED` | 7 | 1 | 175,000 | Completed Shard #7 (attempt 1) in 0.35ms (stateHash=3da88763b71d). |
| `#26` | `+41.36ms` | `ACTIVITY_TASK_SCHEDULED` | 8 | 1 | 175,000 | Scheduled Shard #8 (rows 175,000..200,000). |
| `#27` | `+41.69ms` | `ACTIVITY_TASK_COMPLETED` | 8 | 1 | 200,000 | Completed Shard #8 (attempt 1) in 0.32ms (stateHash=d91d002746cd). |
| `#28` | `+41.71ms` | `ACTIVITY_TASK_SCHEDULED` | 9 | 1 | 200,000 | Scheduled Shard #9 (rows 200,000..225,000). |
| `#29` | `+42.05ms` | `ACTIVITY_TASK_COMPLETED` | 9 | 1 | 225,000 | Completed Shard #9 (attempt 1) in 0.34ms (stateHash=c861e601a8cc). |
| `#30` | `+42.08ms` | `ACTIVITY_TASK_SCHEDULED` | 10 | 1 | 225,000 | Scheduled Shard #10 (rows 225,000..250,000). |
| `#31` | `+42.46ms` | `ACTIVITY_TASK_COMPLETED` | 10 | 1 | 250,000 | Completed Shard #10 (attempt 1) in 0.37ms (stateHash=7436825b8d47). |
| `#32` | `+42.47ms` | `ACTIVITY_TASK_COMPLETED` | — | 1 | 250,000 | Executed compute_counterfactual_reallocation & update_gamma_poisson_posteriors across all 10 shards + canonical 3,858-row kit anchor (windowInvarianceVerified=true). |
| `#33` | `+46.34ms` | `WORKFLOW_EXECUTION_COMPLETED` | — | — | 250,000 | Workflow wf-flowiq-portfolio-sheaf-250k completed 250,000 rows. SHA-256 stateDigest=194d7a5a128fe068... (clean replay match=true). |
