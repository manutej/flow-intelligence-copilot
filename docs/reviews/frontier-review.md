# FRONTIER review: findings and what happened to them

FRONTIER reviewed `main` (a85505d) by running the engine against questions it had not seen (probe script and an independent Python recompute over the CSVs). Its findings, ranked by how much a wrong answer would cost an operator, and where each was handled on `fix/review-findings`:

| # | Finding | Status |
|---|---|---|
| 1 | Questions outside the exports (weather, nonsense, TikTok, an unknown building, dates outside the data) returned an unfiltered unit count stamped PASS. | Fixed: they return `{"unknown": true}` with a reason and no citations. |
| 2 | Sources with spend and no signed leases printed `$0.00` cost per lease; Website and Referral crashed. | Fixed: `usd: null` with "not defined (no signed leases)"; free sources say "not applicable". |
| 3 | The Fair Housing guard was a keyword list. It missed paraphrases and refused some inclusive requests. | Fixed: action-plus-protected-class classifier, 40-case labelled set in `npm run eval`. |
| 4 | The eval overstated itself: a hard-coded $475 injection answer, a "v0/v1/v2" story, and a 600-question bank presented as accuracy. | Fixed: rule ablation over one engine, real injection probe, bank labelled a regression snapshot, 16-question held-out set. |
| 5 | Terminal wrapping inserted spaces into money and JSON (`$84, 560.00`). | Fixed: one lossless wrapper, one `fmtUsd()`, one `plural()`. |
| 6 | Repository visibility. | Not changed here; a settings decision for Manu. |
| 7 | Routing tool selection through a model. | Not done; the deterministic planner stays the default. |
