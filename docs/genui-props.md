# GenUI props contract

This is the final contract between the picker and the renderer (`ui/genui/index.html`). Source of truth: `ChartSpec` in `src/genui/spec.ts`. Shapes follow Design's `genui-spec.md` v0.3 templates.

## Rules for every spec

- `Num = { v: number, ref: "items.<key>.result.<field>" }`. Every figure is a Num that resolves into evidence, and every evidence item is a verified S2 result with its `result_hash`. The only bare number allowed is `ranked_table.props.limit`, which is layout only.
- Evidence is never trusted as stored. Every item carries a `recipe {question, intent}`, and `specErrors(spec, evidence, store)` re-runs each recipe through compute and `verifyAnswerEnvelope`. The stored result must be byte-identical to the fresh one, so a tamper that is rehashed still fails. The main recipe's intent must equal the lexicon reading of its question. `spec.answer` must equal the recomputed answer text. Without a store, the validator rejects everything.
- Text fields hold no figures: no digits and no numbers written as words (three, twelve, hundred, dozen, half and so on). The only digits allowed are labels: ISO months and dates, a year in a period context (after a month, Q1–Q4, H1–H2 or FY), Q1–Q4, H1–H2, P01-style property ids and draft ids. A title or subtitle may also repeat a number the user typed (for example "3-bedroom"). Every `unit` must be one of `count | $ | % | sqft | leases`. Exempt from the figure rule: `answer` (bound as above), plus `options`, `restatement`, `question` and `citations`. The full re-pick in `panelErrors` binds all of those.
- `panelErrors(question, spec, evidence, store)` (picker.ts) is the server-side check. It reruns the picker on the question and requires the whole spec, and every evidence recipe, to be identical. That binds each breakdown item to the item the picker would build.
- Intent gate: the picker charts an intent only when every field matches the deterministic lexicon reading of the question. If the model parse differs from it in any field (measure, window, scope, sources and so on), the user gets a clarify card instead (`intentGate` in picker.ts).
- The renderer formats values exactly as they are, with no rounding (for example `$46,599.90`). Only axis ticks are rounded.
- `Unit = count | $ | % | sqft | leases`. `good_direction = up | down`. A delta is drawn as an arrow, a sign and favorable/unfavorable. Favorable is gold; unfavorable gets a dashed border. No red or green.
- `state = ready | loading | empty | partial | error_data | model_down`. A `partial` spec lists what is absent in `missing`.

## Envelope

`template, title, subtitle?, intent, insight, answer?, state, source, as_of?, missing?, props`

## Props by template

```ts
type Col = { key: string; label: string; unit?: Unit; align: 'left' | 'right' };
export type ChartSpec = Envelope & (
  | { readonly template: 'kpi'; readonly props: { value: Num; unit?: Unit; secondary?: ReadonlyArray<{ label: string; value: Num; unit: Unit }>; good_direction: Dir } }
  | { readonly template: 'kpi_delta'; readonly props: { value: Num; unit?: Unit; prior: Num; vs: string; current_label: string; good_direction: Dir } }
  | { readonly template: 'sorted_bar'; readonly props: { items: ReadonlyArray<{ label: string; value: Num }>; unit?: Unit; sort: 'desc'; highlight: readonly string[]; good_direction: Dir } }
  | { readonly template: 'trend_line'; readonly props: { x: readonly string[]; series: ReadonlyArray<{ name: string; values: readonly Num[]; primary?: boolean }>; unit?: Unit; good_direction: Dir } }
  | { readonly template: 'ranked_table'; readonly props: { columns: readonly Col[]; rows: ReadonlyArray<Record<string, string | Num>>; rank_by?: string; limit: number; total?: Num; total_label?: string; unit?: Unit; highlight?: readonly string[] } }
  | { readonly template: 'stacked_bar'; readonly props: { categories: readonly string[]; total: readonly Num[]; segments: ReadonlyArray<{ name: string; values: readonly Num[] }>; focus: string; rest_label: string; unit?: Unit } }
  | { readonly template: 'grid_heatmap'; readonly props: { rows: readonly string[]; cols: readonly string[]; values: ReadonlyArray<ReadonlyArray<Num | null>>; unit?: Unit } }
  | { readonly template: 'scatter'; readonly props: { points: ReadonlyArray<{ label: string; x: Num; y: Num }>; x: { label: string; unit: Unit }; y: { label: string; unit: Unit }; highlight: readonly string[]; highlight_reason: string } }
  | { readonly template: 'recommendation_card'; readonly props: { title: string; summary: string; impact_level: 'high' | 'med' | 'low'; impacts: ReadonlyArray<{ label: string; value: Num; unit: Unit; good_direction: Dir }>; confidence: null; reasoning: readonly string[]; citations: readonly string[]; actions: ReadonlyArray<'approve' | 'dismiss'> } }
  | { readonly template: 'clarify_card'; readonly props: { mode: 'clarify' | 'unknown' | 'refuse'; question: string; restatement: string; options: ReadonlyArray<{ id: string; label: string }>; allow_free_text: true } }
);
```

Tooltips (`data-tip`) are shown on heatmap cells, scatter points and trend points. For `recommendation_card`, `confidence` is always `null` and the card shows "Not scored". Approve calls `POST /api/actions`, which creates a draft in state `pending_approval`. Nothing is sent or executed.

## Server

| Route | Purpose |
|-------|---------|
| Every POST and DELETE | needs `content-type: application/json` (else 415), a loopback Host with an equal Origin, and the `x-genui-csrf` token from index.html's `genui-csrf` meta tag (else 403) |
| `POST /api/ask {question}` | panel `{id, question, spec, errors, parse_path, model_down}` |
| `GET/POST /api/panels`, `DELETE /api/panels/:id` | JSON store (`GENUI_STORE`, default `.genui/`) |
| `POST /api/panels` | 422 unless the spec equals the server's re-pick for its question |
| `POST /api/actions {panel_id}` | draft from a saved recommendation panel only. It re-validates, and the id is `D-` plus the first 8 hex of the spec's sha256, so it is idempotent: the same spec returns the same draft. This replaces the Design draft's `D-0142` style below. |
| `GET /api/action-center` | `{template:'action_center', state, drafts}` |
| `POST /api/actions/D-xxxxxxxx/intent {kind:'set_state', to}` or `{kind:'undo'}` | approved or rejected only from draft or pending_approval; undo restores the previous state |

<!-- Proposed section for docs/genui-props.md (feat/genui-dashboard). Draft from genui-design v0.3. Paste as-is; do not treat as merged. -->
## Action Center (surface 11: draft review queue)

Backed by the typed draft actions in `feat/s3-registry`. **Records only:** nothing is sent or executed, and role claims in the payload are ignored.

### Types
```ts
type DraftState = "draft" | "pending_approval" | "approved" | "rejected";
// "approved" = the record's state only. It never implies execution.

interface CitedValue {
  label: string;              // "Avg. effective rent"
  value: number;              // 1842 (raw; renderer formats)
  unit: "%" | "$" | "count" | "pts";
  source: { template_id: string; template: string; field: string }; // link back to chart value
}

interface DraftAction {
  id: string;                 // "D-0142"
  action_type: string;        // typed by registry, e.g. "renewal_offer_change"
  target: { label: string; entity_id?: string };
  question: string;           // user question it was created from
  state: DraftState;
  created_at: string;         // ISO 8601 with offset
  updated_at?: string;
  draft_text: string;         // full preview, plain text
  cites: CitedValue[];
  prev_state?: DraftState;    // enables Undo
}

interface ActionCenterProps {
  template: "action_center";
  state: "ready" | "loading" | "empty" | "data_error" | "partial";
  drafts: DraftAction[];
  selected_id?: string;
  filter?: "all" | DraftState;
  error?: { source: string; code: string; message: string };          // data_error
  coverage?: { have: number; total: number; missing_ids: string[] };  // partial
  example?: boolean;
}

// UI -> engine intents (state change only; no side effects)
type ActionCenterIntent =
  | { kind: "set_state"; id: string; to: "approved" | "rejected" }   // only from draft|pending_approval
  | { kind: "undo"; id: string };                                    // restores prev_state
```

### Rules
- Approve button label: **"Mark approved — nothing is sent"**. Reject: **"Reject"**.
- State tags: `○ DRAFT` (dotted), `◷ PENDING APPROVAL` (dashed), `● MARKED APPROVED · NOT SENT` (solid), `✕ REJECTED` (struck through).
- Banned wording: sent, executed, applied, done, live, deployed, published, "✓ Approved".
- Actions are disabled for drafts listed in `coverage.missing_ids`.

### Example
```json
{"template":"action_center","state":"ready","example":true,"selected_id":"D-0142","drafts":[
 {"id":"D-0142","action_type":"renewal_offer_change","target":{"label":"Tower A · 41 expiring leases"},
  "question":"Should we raise renewals at Tower A?","state":"pending_approval","created_at":"2026-10-30T19:12:00-06:00",
  "draft_text":"Proposed: raise renewal offers by 3% for leases expiring Dec–Feb at Tower A.",
  "cites":[{"label":"Avg. effective rent","value":1842,"unit":"$","source":{"template_id":"t2","template":"kpi_delta","field":"value"}}]}]}
```
