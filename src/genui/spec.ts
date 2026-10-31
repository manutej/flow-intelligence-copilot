import { hashOf } from '../agent/envelope.ts';

/**
 * GenUI ChartSpec: a closed set of templates. The picker fills a spec from
 * verified evidence only. Every number in a spec is a Num {v, ref}: ref is a
 * path into the evidence and v must equal the value found there exactly.
 * Bare numbers, or text that smuggles a figure ($, %, decimals), are rejected.
 */
export const TEMPLATES = ['kpi', 'kpi_delta', 'sorted_bar', 'trend_line', 'ranked_table', 'stacked_bar',
  'grid_heatmap', 'scatter', 'recommendation_card', 'clarify_card'] as const;
export type Template = (typeof TEMPLATES)[number];
export type Unit = 'count' | '$' | '%' | 'sqft' | 'leases';

export interface Num { readonly v: number; readonly ref: string }
/** One verified result: an answering envelope that passed verifyAnswerEnvelope. */
export interface EvidenceItem {
  readonly key: string;
  readonly label: string;
  readonly template_id: string;
  readonly result: Readonly<Record<string, unknown>>;
  readonly result_hash: string;
  readonly citations: readonly string[];
}
export interface Evidence { readonly items: readonly EvidenceItem[] }

export type PanelState = 'ready' | 'loading' | 'empty' | 'partial' | 'error_data' | 'model_down';
type Dir = 'up' | 'down';
interface Envelope {
  readonly title: string; readonly subtitle?: string; readonly intent: string; readonly insight: string; readonly answer?: string;
  readonly state: PanelState; readonly source: string; readonly as_of?: string; readonly missing?: readonly string[];
}
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

/** Resolves "items.<key>.result.<path>" in the evidence. */
export function resolveRef(ev: Evidence, ref: string): unknown {
  const [head, key, rest, ...path] = ref.split('.');
  if (head !== 'items' || rest !== 'result') return undefined;
  let cur: unknown = ev.items.find((i) => i.key === key)?.result;
  for (const p of path) cur = cur == null ? undefined : (cur as Record<string, unknown>)[p];
  return cur;
}

const isNum = (x: unknown): x is Num => !!x && typeof x === 'object' && 'v' in x && 'ref' in x && Object.keys(x).length === 2;
const FIGURE_IN_TEXT = /[$%]|\d[\d,]*\.\d|\d{1,3}(,\d{3})+/;
/** Free-text fields that may carry figures because they are the verified answer bytes or reviewed option text. */
/** Layout settings, not data: the only bare numbers allowed. */
const LAYOUT_NUM = /\.props\.limit$/;
const TEXT_EXEMPT = new Set(['answer', 'options', 'restatement', 'question', 'unit', 'citations']);

/** Why a spec fails the closed-template and number-fidelity rules; empty when it passes. */
export function specErrors(spec: ChartSpec, ev: Evidence): string[] {
  const errs: string[] = [];
  if (!TEMPLATES.includes(spec.template)) errs.push(`template ${String(spec.template)} is not in the closed set`);
  for (const it of ev.items) if (hashOf(it.result) !== it.result_hash) errs.push(`evidence ${it.key}: result hash mismatch`);
  let nums = 0;
  const walk = (x: unknown, path: string, exempt: boolean): void => {
    if (typeof x === 'number' && LAYOUT_NUM.test(path) && Number.isInteger(x)) return;
    if (typeof x === 'number') { errs.push(`${path}: bare number ${x} has no ref`); return; }
    if (typeof x === 'string') { if (!exempt && FIGURE_IN_TEXT.test(x)) errs.push(`${path}: text carries a figure: ${JSON.stringify(x)}`); return; }
    if (isNum(x)) {
      nums++;
      const got = resolveRef(ev, x.ref);
      if (typeof got !== 'number' || !Number.isFinite(x.v) || got !== x.v) errs.push(`${path}: ${x.v} does not equal ${x.ref} (${JSON.stringify(got)})`);
      return;
    }
    if (Array.isArray(x)) { x.forEach((y, i) => walk(y, `${path}[${i}]`, exempt)); return; }
    if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) walk(v, `${path}.${k}`, exempt || TEXT_EXEMPT.has(k));
  };
  walk(spec, 'spec', false);
  if (spec.template !== 'clarify_card' && nums === 0) errs.push('a chart spec must carry at least one traced number');
  return errs;
}

/** Counts traced numbers in a spec (for fidelity reporting). */
export function countNums(x: unknown): number {
  if (isNum(x)) return 1;
  if (Array.isArray(x)) return x.reduce((a, y) => a + countNums(y), 0);
  if (x && typeof x === 'object') return Object.values(x).reduce((a: number, y) => a + countNums(y), 0);
  return 0;
}
