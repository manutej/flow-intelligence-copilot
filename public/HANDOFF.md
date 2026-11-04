# FlowIQ handoff

FlowIQ answers questions about one Chicago apartment portfolio from six CSV exports: properties, units, leases, leads, marketing spend and past budget decisions. Eight buildings are operating (P01–P08, 1,100 units). P09 Cornell Annex is on onboarding hold and is left out of portfolio totals. An answer cites the rows it used, for example `leases:L00105`. The joins, currency conversion and deduplication run in zero-dependency TypeScript. A model is optional and does not replace those calculations.

## Where it is

The site is https://repo-sigma-one-80.vercel.app. The field notebook is https://repo-sigma-one-80.vercel.app/field-notebook.html. Agents call the MCP server at https://repo-sigma-one-80.vercel.app/api/mcp (Streamable HTTP, no key, read-only). https://repo-sigma-one-80.vercel.app/llms.txt and https://repo-sigma-one-80.vercel.app/AGENTS.md are the short and long notes for agents. This file is copied to `public/HANDOFF.md`. The local dashboard serves that copy at `/HANDOFF.md`.

## Run it locally

Node is `>=22.6.0` (`package.json` `engines`). There are no npm dependencies and no lockfile, so `npm ci` has nothing to install. From a clone:

- `npm test` runs `tests/*.test.ts`.
- `npm run eval` runs rule ablation, the dev set, probes, the red-team set, the Fair Housing set and the held-out questions.
- `npm run validate` checks the kit questions against their expected answers.
- `npm run mcp:smoke` starts the stdio MCP server from `/tmp` and checks it.
- `npm run mcp:http:smoke` checks the same server over Streamable HTTP.
- `npm run dashboard` serves the site at http://localhost:4310.

`npx tsc --noEmit` needs the `typescript` package. The npm package named `tsc` is a different program. Install typescript without saving it (`npm install --no-save --no-package-lock typescript`), then run `npx tsc --noEmit`. `tsconfig.json` already sets `noEmit`.

## Connect an agent

Client setup for Grok, Claude, Cursor and the xAI API is in [docs/MCP_SETUP.md](docs/MCP_SETUP.md). `npm run mcp:install` wires a local stdio server. The server lists eight tools, in this order, from `src/mcp/catalog.ts`:

- `ask_flowiq` — first call for a question in the user's words. Returns a short answer and the source rows. Says "I don't know" when the exports cannot answer, asks which building when a name is ambiguous, and refuses a Fair Housing request.
- `find_properties` — resolve a loose building name to an id, or list buildings by neighborhood, class, PMS, year built or amenity. With `resolutionMode` `single_building` it returns `ambiguous_match` when more than one building fits.
- `query_units_and_occupancy` — unit counts, occupied share (units on notice count as occupied), vacancy rate, asking rent, square feet and rent per square foot.
- `query_leases_and_renewals` — lease counts, renewal rate, monthly rent at risk and average concession (zeros included).
- `query_marketing_spend_and_funnel` — spend with CAD converted and void invoices at $0, deduplicated leads, tours, signed leases, and cost per lead, tour and signed lease. Spend with no signed leases has a null cost per lease, never $0.
- `evaluate_budget_decisions` — how past rows in `decisions.csv` turned out, with small samples shrunk toward the portfolio average, plus regret and the next recommendation.
- `audit_sheaf_consistency` — rows held out or not reconciled across the six exports, with the row ids.
- `flowiq_about` — coverage, date range, what the exports cannot answer, how row ids read, and the what-if defaults. No arguments. Call it once when unsure.

`ask_flowiq` accepts a one-question what-if: `cadToUsdRate`, `occupiedIncludesNotice`, `leaseBucketBy`, `priorSpendUsdBeta0`. Void invoices, lead dedup, the P09 hold, Fair Housing and the unknown guard cannot be switched off from outside.

## Guards

`checkUnknownDataGuard` in `src/domain/guards.ts` abstains with `result: { unknown: true }` when the question needs something the six exports do not hold. That includes operating expenses, payroll, utilities, NOI, cap rate, debt service, resident surveys, credit or income, competitor rents, and a fiscal year (the files have calendar months only). An "ILS" or "listing sites" spend group is also unknown, because no site list defines that group. The answer says "I don't know".

`checkFairHousingGuard` refuses a request that pairs a discriminatory action (advertise, steer, exclude, filter, target) with a protected class under the Fair Housing Act (42 U.S.C. § 3604), the Illinois Human Rights Act (775 ILCS 5/) and the Chicago Fair Housing Ordinance (§ 5-8-030). The result is `refused: true`. A class word with no such action is not refused. Vouchers are a separate rule: `isVoucherQuestion` in `src/domain/fair-housing.ts` refuses any Section 8, HCV or housing-voucher question, including a neutral one, because source of income is protected under the Chicago ordinance and the Illinois act, and the exports do not record it. `ALLOW_INCLUSIVE_VOUCHER_WORDING` is true, so a statement such as "we accept Housing Choice Vouchers" is allowed. A question or a restriction is still refused.

## Repo map

`src/` is the engine: `src/agent` (parser, planner, copilot), `src/domain` (metrics, guards, fair housing), `src/data` (CSV loader), `src/mcp` (server and tool catalog), `src/cli.ts`. `data/` holds the six exports. `questions/` and `tests/` are the banks and the tests. `api/` is the HTTP handlers for ask, state and mcp. `public/` is the site. Version is `FLOWIQ_VERSION` in `src/version.ts` (also `package.json`).

## Current state

Version `2.3.0`. `main` is `a0fd5de`, the merge of pull request #1. That release is `fix/flowiq-site-tsc` plus `fix/bend-flowiq-001` and `fix/flowiq-site-009`, all three of which are ancestors of `main`. The bend commit marks a clarify option seen only after it is kept (`FIX-BEND-FLOWIQ-001` in `src/agent/copilot.ts`). The site branch carries the SITE-009, SITE-010 and SITE-011 page fixes and the pinned `INITIAL_STATE` hash in `tests/initial-state-drift.test.ts`.

These branch tips are not ancestors of `main`, and the fixes they were opened for are already on `main` through other commits, so they can be deleted later: `feat/flowiq-bend-001`, `feat/flowiq-site-009`, `feat/flowiq-drop-learner-integrity`. The SITE-009 commit on `main` says it supersedes `feat/flowiq-site-009` and squashes the learner-table removal from `feat/flowiq-drop-learner-integrity`.

`feat/genui-r10-1` (`d3f2c69`) is not merged. Six commits titled `fix(fair-housing)` are on that branch and not on `main`:

- trait concepts, two-edit typos, descriptive nouns
- person lookups may filter only on real columns
- read periods as words and refuse every unrecorded trait
- refuse any class match despite scope rules; label uncharted answers
- clarify class words that modify staff or measures; widen age ranges
- refuse class words on resident records; request verbs are grammar

Those six touch the shared classifier and are worth a follow-up by themselves. The rest of `feat/genui-r10-1` is the panel work and stays a separate feature.

## Deploy

The Vercel project is named `repo` (`prj_Eqgw0rQhsUMBWTiDeYFqZ3tGV3Uy`). Its project record has no git repository link, so merging to `main` does not deploy. After the merge, from a clean clone of `main`, run `vercel --prod`. The deployment serving https://repo-sigma-one-80.vercel.app is `dpl_GFU9LvVcRgdkG5gpiRrJVQfHhmn7`. The project's Node version is 24.x.

## Quirk

On Node v22.23.4, three tests in `tests/s2-model-parse.test.ts` are cancelled: the slow-model fallback, the default with no `FLOWIQ_PARSE_URL`, and the run-memory cache hit. `AbortSignal.timeout` does not keep the event loop alive, so the runner cancels the test while its promise is still pending. That file passes when the timeout keeps the loop alive.
