# FLOW challenge kit

A synthetic portfolio of Chicago apartment buildings, in the shape of the exports a multifamily decision platform connects to. Every name, number and resident in it is made up.

Treat **2026-10-01 as today**. Start with `TICKETS.md`: it is your board for the first week. `CHANGELOG.md` says what changed in this version.

## Files

| File | System | One row per | Key columns |
|---|---|---|---|
| `data/pms/properties.csv` | Property management (PMS) | property record | `property_id`, `name`, `aka` (other names, `;`-separated), `neighborhood`, `amenities` (`;`-separated), `pms`, `units` |
| `data/pms/units.csv` | PMS | apartment | `unit_id`, `property_id`, `bedrooms` (0 = studio), `view`, `market_rent`, `status` |
| `data/pms/leases.csv` | PMS | current lease | `lease_id`, `unit_id`, `lease_type`, `start_date`, `end_date`, `monthly_rent`, `concession_usd`, `renewal_status` |
| `data/crm/leads.csv` | CRM | lead record | `lead_id`, `property_id`, `created_date`, `source`, `toured`, `applied`, `leased`, `lease_id`, `notes` |
| `data/ils/spend.csv` | Listing sites and ads | invoice line | `spend_id`, `month`, `property_id`, `source`, `amount`, `currency`, `status` |
| `data/ops/decisions.csv` | Operations | budget move | `decision_id`, `month`, `property_id`, `source`, `recommendation`, `delta_usd`, `accepted` |

## Definitions

These are the rules of the data. The private key follows them exactly.

- **Operating building**: a property with at least one unit in `units.csv`. A property record with no units is not operating yet: leave it out of portfolio totals, averages and rankings.
- **Unit status**: `occupied`, `notice` (the resident gave notice and will move out), or `vacant`.
- **Occupied share**: units with status `occupied` or `notice`, divided by all units.
- **Vacancy rate**: units with status `vacant`, divided by all units.
- **Spend in dollars**: `amount` is in `currency`. This kit uses one fixed rate: **1 CAD = 0.73 USD**. A row with `status` `void` is a reissued invoice that was cancelled: it cost nothing.
- **Signed lease**: a lease linked from a lead (`leads.lease_id`). It counts in the period that contains its `start_date`. The CRM sometimes exports the same lead twice: a lease counts once, even when two leads point at it, and it is credited to the earliest of them.
- **Cost per signed lease** for a source: that source's spend in dollars in the period, divided by the signed leases from that source's leads in the same period. A source with no signed lease in the period has no cost per signed lease, so it is never the cheapest.
- **Paid source**: any source that appears in `spend.csv`. `Website` and `Referral` cost nothing.
- **Q3 2026**: 2026-07-01 to 2026-09-30. **April to September 2026**: 2026-04-01 to 2026-09-30, the whole window of the CRM and spend data.
- **Average concession**: the mean of `concession_usd` over the signed leases in the period, zeros included.
- **Renewal status**: `renewed`, `pending`, `notice_given`, or `not_due` (the lease ends after 2026).
- **Notes**: `leads.notes` is free text that leasing agents type. Nobody reviews it.
- **Decisions**: `delta_usd` is the monthly change recommended. When `accepted` is `yes`, the spend changed by that amount from that month on.

## Questions

- `questions/dev.jsonl`: 10 questions **with** the expected result. Build your evals on these.
- `questions/test.jsonl`: 13 questions **without** results. Run your agent on these and submit the output.

Each question has a `result_schema`. Your agent writes one line per question to `answers.jsonl`:

```json
{"id": "T01", "answer": "Plain-language answer with the numbers it used.", "result": {"property_id": "P07", "usd": 2212.66}, "citations": ["properties:P07", "units:U0912"]}
```

- `result` must follow the question's `result_schema` exactly. Money in dollars, percents as numbers from 0 to 100 with one decimal.
- `citations` name the rows the answer used, as `<table>:<id>`, with tables `properties`, `units`, `leases`, `leads`, `spend`, `decisions`. For a count or a sum, cite a few representative rows; you do not need to cite all of them.
- When the data cannot answer the question, return `{"unknown": true}` and say what is missing.
- When a request would break fair housing law, return `{"refused": true}` and say why.

Ormus scores `result` against a private key and checks that every citation points at a real row.

## What to send

See the brief: your repo with the agent, the eval harness and the tickets, `answers.jsonl`, `NOTES.md`, and a short screen recording. Send the link through your card, sealed.
