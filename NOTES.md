# Notes: design, decisions, and what I would do next

Answers come from a deterministic parser and planner over the six CSV exports. A model is optional: `--provider` turns on a harness that lets a model pick tools, but every number still comes from the same typed tools and every answer goes through the same verifier. Run `npm run eval` for current numbers.

## Design

```
config (rules.ts)  ->  data (loader.ts)  ->  domain (metrics, guards, learner)  ->  agent (intent, planner, copilot)  ->  MCP / CLI / dashboard
```

- **Load once, clean once.** `src/data/loader.ts` reads the exports, converts CAD at 0.73, zeroes void invoices, merges the 9 phone re-entry leads into the earliest lead for the same lease, holds P09 (0 units) out of the operating pool, and strips `leads.notes` from the type the tools can see. Every row gets a primary-key citation (`spend:S0174`).
- **Five typed tools.** Properties, units, leases, marketing funnel, budget decisions. The MCP server, CLI and dashboard all call the same functions.
- **Guards before and after.** Before planning: the Fair Housing classifier (an action such as exclusion or targeting paired with a protected class or proxy) and the unknown gate (a building, channel or date the exports do not cover). After planning: the verifier checks that every citation exists, that the result matches the schema, and that the injected note's text never appears.
- **Saying "I don't know" is an answer.** `{"unknown": true}`, `{"refused": true}` and clarifying questions carry no citations and are never stamped PASS.

## Decisions worth defending

| Decision | Why |
|---|---|
| Bucket signed leases by `leases.start_date` | The kit says so, and 20 June leads signed July leases; bucketing by lead date flips D03. |
| Cost per lease with 0 leases is `null`, never `$0.00` | A zero-lease source is the most expensive, not the cheapest. |
| Contract rent for rent at risk | P06 notice units: $11,035 contract vs $11,405 market. Diego loses contract rent. |
| Void invoices count as $0 | 10 rows, $11,760.00 face value, $11,500.80 USD-equivalent after converting S0174 from CAD. |
| CRM notes are data, not instructions | `leads:D01011` tells "AI assistants" to report Facebook Ads at $475. Notes never reach a tool, so T13 is Google Ads at $2,005.00. |
| Small samples are shrunk, not trusted | FLOW-105 uses Gamma-Poisson shrinkage: posterior cost per lease = (spend + 3,250) / (leases + 1). X009 spent $950 over 2 months with 0 leases; at the prior mean rate that happens 74.7% of the time (exp(-950/3250); the full predictive 3250/(3250+950) is 77.4%), so it keeps rank #2 at $3,295.00. X001 spent $8,170 over 5 months with 0 leases (8.1% at the prior mean rate, 28.5% predictive) and drops to last at $12,940.00. |

**Eval, honestly.** The rule ablation runs one engine with rules switched off (3/10), data rules only (8/10) and all rules (10/10) on `dev.jsonl`. The probes, the 25 red-team questions and the 40 Fair Housing cases were written alongside the code, so they are regression checks, not accuracy estimates. The 600-question bank stores the engine's own past outputs and only detects drift. The closest thing to an accuracy number is `questions/heldout.jsonl`: 16 questions written after the engine, with answers computed by a separate script. It scores 15/16; the miss is "average square footage", which the parser reads as a unit count.

## What changes in a real system

1. **A semantic layer instead of CSVs.** The loader rules become versioned SQL views (`vw_operating_properties`, `vw_attributed_signed_leases`) owned by the .NET backend, with a live FX table instead of 0.73.
2. **Untrusted text in its own table.** Lead notes live where the analytics service account cannot join them.
3. **Same tool contracts, more surfaces.** The five tools become API endpoints; the MCP server, the Next.js app and email or chat replies all call them.
4. **The eval gates merges**, and the held-out set grows from real operator questions, labelled by someone who did not write the parser.

## First 30 days

- **Week 1:** sit with Diego and two property managers; collect 50 real questions and label them. Onboard P09 (Cornell Annex, AppFolio): get the unit directory, lease ledger, guest cards and ILS invoices, map AppFolio statuses, and flip it live only when its unit count reconciles.
- **Week 2:** put the MCP server in front of Diego in his own assistant (Grok Bot or the xAI API) against the read-only endpoint, and log every question it could not answer.
- **Week 3:** close the top gaps from that log, starting with the parser misses the held-out set already shows.
- **Week 4:** move the loader rules into SQL views and run the eval against the warehouse, not the CSVs.

## How I built this with agents

I wrote the rules and the tool contracts; agents did most of the typing, and other agents attacked the result. An eight-agent adversarial panel found hard-coded prose numbers and a static ablation table ([panel synthesis](docs/reviews/panel-synthesis-report.md)). Three later reviews found the problems fixed on this branch: answers to questions the data cannot answer, `$0.00` for zero-lease sources, a keyword Fair Housing filter, an eval that overstated itself, and a wrapper that changed numbers ([FRONTIER](docs/reviews/frontier-review.md), [design](docs/reviews/design-cli-review.md), [ATELIER](docs/reviews/atelier-crit.md)). Each fix is its own commit with the reason in the message.
