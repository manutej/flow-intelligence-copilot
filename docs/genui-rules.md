# GenUI picker rules

`src/genui/picker.ts` picks one of 10 templates for each question. The pick is deterministic: the same question and data always give the same template. Every number on a panel is `{v, ref}` and points into a verified S2 envelope result. `specErrors` in `src/genui/spec.ts` rejects any spec with a bare number, a figure written into prose, a ref that does not resolve, a value that differs from its ref (zero tolerance), or a result hash mismatch. A rejected spec is replaced by an `error_data` card and never drawn.

## Flow

1. `coreQuestion()` cuts the presentation cues below out of the question, so S2's closed vocabulary only sees the data question.
2. S2 parses and answers (`askFlowIqCopilot`, deterministic mode, model parse when configured). Multi-turn input split on `→` runs in one session.
3. `pick()` applies the first matching rule and runs any extra verified sub-queries (per building, per source, per month, prior period).
4. `askPanel()` validates. The server saves and reloads panels from `GENUI_STORE`.

## Rule table (first match wins)

| # | Condition | Template | Notes |
|---|-----------|----------|-------|
| 0 | refused, clarify or unknown | clarify_card | mode refuse, clarify or unknown; `error_data` if the proof did not verify |
| 1 | measure `reallocation_leases` | recommendation_card | Approve only creates a draft marked pending approval |
| 2 | measure `dead_spend_*` and a CHANGE cue | recommendation_card | |
| 3 | result is a list of pairs or sources | ranked_table | |
| 4 | `ending_and_renewed` without a percent | stacked_bar | renewed vs the rest |
| 5 | `spend_h1_vs_q3`, or a DELTA cue | kpi_delta | prior-period sub-query |
| 6 | TREND cue | trend_line | monthly sub-queries; `partial` if months are missing |
| 7 | HEAT cue | grid_heatmap | building × source sub-queries; `partial` plus a missing list |
| 8 | SCATTER cue | scatter | highlight = highest rent per sq ft |
| 9 | argmax, argmin, compare or topK | ranked_table with a RANK cue, else sorted_bar | winner highlighted |
| 10 | otherwise | kpi | |

## Cues

| Cue | Regex |
|-----|-------|
| TREND | `/\b(by month\|per month\|each month\|month by month\|over time\|trend\|trending\|month over month\|monthly (trend\|breakdown))\b/i` |
| DELTA | `/\b(compared? (to\|with)\|vs\.?\|versus\|than) (the )?(prior\|previous\|last)\b\|\b(prior\|previous) period\b/i` |
| RANK | `/\b(top \d+\|top (three\|five\|ten)\|rank\|ranked\|ranking\|leaderboard\|table)\b/i` |
| HEAT | `/\bby (building\|property) and (source\|channel)\b\|\bby (source\|channel) and (building\|property)\b/i` |
| SCATTER | `/\b(rent\|price)\b.*\b(vs\.?\|versus\|against)\b.*\b(size\|sq ?ft\|square (feet\|footage))\b/i` |
| CHANGE | `/\b(what should (i\|we) change\|where are we losing money\|what should (i\|we) do\|recommend)/i` |

## Intent → insight map

`intent` = the S2 template id (`domain.measure.aggregation`). The panel's `insight` line comes from the measure. `good_direction` sets which way a delta counts as favorable. Deltas show an arrow, a sign and the word favorable or unfavorable, never red or green.

| Measure | Insight | good_direction |
|---------|---------|----------------|
| `unit_count` | Inventory: how many units match | down |
| `vacancy_rate` | Vacancy pressure | down |
| `occupied_share` | Occupancy health | up |
| `avg_market_rent` | Pricing position | up |
| `avg_sqft` | Unit mix size | up |
| `rent_per_sqft` | Price per square foot | up |
| `avg_market_rent_and_sqft` | Pricing vs size | – |
| `lease_count` | Leasing velocity | up |
| `renewal_rate` | Retention | up |
| `ending_and_renewed` | Renewal pipeline | up |
| `average_concession` | Concession cost | down |
| `rent_at_risk` | Revenue at risk | down |
| `new_vs_renewal_and_concession` | New vs renewal mix | – |
| `renewal_rate_class_comparison` | Retention by class | – |
| `lead_count` | Demand volume | up |
| `spend_total` | Marketing spend | down |
| `spend_h1_vs_q3` | Spend change between periods | down |
| `cost_per_lead` | Channel efficiency | down |
| `cost_per_tour` | Channel efficiency | down |
| `cost_per_lead_and_tour` | Channel efficiency | down |
| `cost_per_signed_lease` | Channel return (cost per lease) | down |
| `signed_leases_ranking` | Lease production | up |
| `tour_to_lease_rate` | Funnel conversion | up |
| `apply_rate` | Funnel conversion | up |
| `applied_without_tour` | Funnel leakage | – |
| `applied_and_leased` | Funnel conversion | up |
| `dead_spend_pairs` | Where we are losing money | down |
| `dead_spend_building` | Where we are losing money | down |
| `reallocation_leases` | What should I change: budget move | up |
| `decision_lookup` | Decision record | – |
| `decision_cohort_rejected` | Decision outcomes | – |
| `decision_post_spend_comparison` | Decision impact | – |
| `decision_outcome_learning` | Decision learning | – |
| `void_and_duplicate_counts` | Data quality | down |
| `unsupported` | Outside the data | – |
