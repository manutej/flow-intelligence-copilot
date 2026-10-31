import { hashOf } from '../agent/envelope.ts';
import { parseQueryIntent, type ParsedQueryIntent } from '../agent/intent.ts';
import { identifierTokens, statedNumbers, usedInputs } from './inputs.ts';
import { executeCompositionalPlan } from '../agent/planner.ts';
import { verifyAnswerEnvelope } from '../domain/guards.ts';
import type { PortfolioStore } from '../data/schema.ts';

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
  /** How to recompute this item: the validator re-runs it and compares every value. */
  readonly recipe: { readonly question: string; readonly intent: ParsedQueryIntent };
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
// \p{N} with the u flag: any Unicode number, not only ASCII digits (text is NFKC-normalized first)
// \p{Sc} is any currency sign (¥, ₹, €); U+066A is the Arabic percent sign; U+2030/2031 per-mille
const FIGURE_IN_TEXT = /[%\u066A\u2030\u2031]|\p{Sc}|\p{N}/u;
/** Han and Cyrillic numerals are letters (Lo/Ll), so \p{N} misses them. */
const HAN_NUMERALS = /[〇零一二两三四五六七八九十百千万萬亿億兆壹贰貳叁參肆伍陆陸柒捌玖拾佰仟]/u;
const CYRILLIC_NUMBER = /(?<![\p{L}])(?:ноль|нуль|один|одна|одно|два|две|три|четыр|пят|шест|сем|восем|девят|десят|сорок|сто|двест|тысяч|миллион|миллиард|дюжин|пар[аыу])/iu;
/** Labels that contain digits but are not figures: years, ISO dates, quarters, halves, property and draft ids. */
const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
/**
 * Labels that contain digits but are not figures. A year counts as a label only
 * in a date or period context (after a month, quarter, half or FY, or as an ISO
 * date, or after a time word at a clause end or before punctuation), so
 * "There are 2025 leads" and "in 2026 units" are still figures.
 */
const TEMPORAL = 'in|since|during|through|throughout|until|till|before|after|from';
const LABEL_TOKENS = new RegExp(`\\b\\d{4}-\\d{2}(-\\d{2})?\\b|\\b(?:${MONTHS}|[QH][1-4]|FY)\\.?\\s+(19|20)\\d{2}\\b|\\b(?:${TEMPORAL})\\s+(19|20)\\d{2}\\b(?=\\s*(?:[.,;:!?)]|$))|\\b(19|20)\\d{2}\\s+(?:YTD|year-to-date)\\b|\\b[QH][1-4](?:\\b|(?=_))|\\bP\\d{2}\\b|\\bD-[0-9a-f]{8,16}\\b`, 'gi');
/** True when [start, end) of text lies inside a date or period label (Q3 2026, 2026-09-30, since 2025.). */
export function inLabel(text: string, start: number, end: number): boolean {
  for (const m of text.matchAll(LABEL_TOKENS)) if (m.index! <= start && end <= m.index! + m[0].length) return true;
  return false;
}
/**
 * Roman numerals: two or more letters in upper case, or four or more in any case
 * (so "mmxxv" is caught but the words "mix", "did" and "dim" are not).
 */
const ROMAN_WORD = /^M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/i;
const ROMAN = { test: (t: string) => (t.match(/\p{L}+/gu) ?? []).some((w) => ROMAN_WORD.test(w) && (w.length >= 4 || (w.length >= 2 && w === w.toUpperCase()))) };
/** Numbers written in words are figures too. */
const NUMBER_WORD_SRC = '\\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|dozen|half|quarter|double|triple|twice|thrice|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|couple|score|nil|several|few|handful|trio|quadruple|dozens|pairs?|myriad)\\b';
const NUMBER_WORDS = new RegExp(NUMBER_WORD_SRC, 'i');
export const UNITS: readonly Unit[] = ['count', '$', '%', 'sqft', 'leases'];
/** Digits the user typed (e.g. "3-bedroom") may be echoed in a title or subtitle; nowhere else. */
const ECHO_KEYS = new Set(['title', 'subtitle']);
/** Whole numeric tokens as the user typed them, with a $ or # prefix and a % suffix kept attached. */
const escRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Remove each echoed token where it stands whole: not inside a longer number or word ("$1800k"), same prefix and suffix. */
const stripEcho = (t: string, echo: ReadonlySet<string>) => {
  const toks = [...echo].filter((x) => /\p{N}/u.test(x)).sort((a, b) => b.length - a.length);
  for (const k of toks) t = t.replace(new RegExp(`(?<![\\p{N}.,$#])${escRe(k)}(?![\\p{L}\\p{N}%]|[.,]\\p{N})`, 'gu'), ' ');
  return t;
};
const carriesFigure = (raw: string, echo: ReadonlySet<string> = new Set()) => {
  // strip format characters (zero-width space, soft hyphen, joiners) and combining marks before matching
  const t = raw.normalize('NFKD').replace(/[\p{Cf}\p{Mn}]/gu, '').normalize('NFKC');
  if (HAN_NUMERALS.test(t) || CYRILLIC_NUMBER.test(t)) return true;
  return ROMAN.test(t.replace(LABEL_TOKENS, '')) || NUMBER_WORDS.test(t.replace(LABEL_TOKENS, '').replace(new RegExp(NUMBER_WORD_SRC, 'gi'), (w) => (echo.has(w.toLowerCase()) ? '' : w))) || FIGURE_IN_TEXT.test(stripEcho(t.replace(LABEL_TOKENS, ''), echo));
};
/** Free-text fields that may carry figures because they are the verified answer bytes or reviewed option text. */
/** Layout settings, not data: the only bare numbers allowed. */
const LAYOUT_NUM = /\.props\.limit$/;
// intent and source are ids, not text: id-shaped, intent equal to the main item's template id, and
// source equal to intent or "guard" (checked below; TENACITY 59be53f MEDIUM).
// unit is checked against the closed UNITS list instead; the rest are bound by panelErrors' full re-pick
const TEXT_EXEMPT = new Set(['answer', 'options', 'restatement', 'question', 'citations']);
/** Template ids such as "marketing.spend_h1_vs_q3.value", or "guard" for guard cards. */
const ID_SHAPE = /^(?:guard|[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){1,3})$/;

/** Why a spec fails the closed-template and number-fidelity rules; empty when it passes. */
export function specErrors(spec: ChartSpec, ev: Evidence, store?: PortfolioStore): string[] {
  const errs: string[] = [];
  if (!store) errs.push('no store: evidence cannot be recomputed, so nothing is trusted');
  else errs.push(...recomputeErrors(ev, store));
  // the answer text is exempt from the figure rule only because it must be the verified answer bytes
  if (spec.answer !== undefined && store) {
    const main = ev.items.find((i) => i.key === 'main');
    const fresh = main && runRecipe(main, store);
    if (!fresh || fresh.answer !== spec.answer) errs.push('spec.answer: not the recomputed answer text');
  }
  if (!TEMPLATES.includes(spec.template)) errs.push(`template ${String(spec.template)} is not in the closed set`);
  for (const it of ev.items) if (hashOf(it.result) !== it.result_hash) errs.push(`evidence ${it.key}: result hash mismatch`);
  let nums = 0;
  const mainQ = ev.items.find((i) => i.key === 'main')?.recipe?.question ?? '';
  // a title may echo a number from the question only if the computation used it (normalized:
  // $1,800 = 1.8k = eighteen hundred = 1800); TENACITY 601bdfa HIGH
  const mainItem = ev.items.find((i) => i.key === 'main');
  const used = store && mainItem ? usedInputs(mainItem.recipe?.intent, store) : new Set<number>();
  const echo = new Set<string>();
  for (const id of identifierTokens(mainQ, mainItem?.recipe?.intent)) echo.add(id);
  // vague quantity words with no value of their own ("pair", "couple", "first") echo as typed, as before
  const valued = new Set(statedNumbers(mainQ).flatMap((n) => n.surface.toLowerCase().split(/[\s-]+/)));
  for (const w of mainQ.match(new RegExp(NUMBER_WORD_SRC, 'gi')) ?? []) if (!valued.has(w.toLowerCase())) echo.add(w.toLowerCase());
  for (const n of statedNumbers(mainQ)) if (used.has(n.value)) { if (/\p{N}/u.test(n.surface)) echo.add(n.surface); else for (const w of n.surface.toLowerCase().split(/[\s-]+/)) echo.add(w); }
  const walk = (x: unknown, path: string, exempt: boolean): void => {
    if (typeof x === 'number' && LAYOUT_NUM.test(path) && Number.isInteger(x)) return;
    if (typeof x === 'number') { errs.push(`${path}: bare number ${x} has no ref`); return; }
    if (typeof x === 'string' && path.endsWith('.unit')) { if (!(UNITS as readonly string[]).includes(x)) errs.push(`${path}: unit ${JSON.stringify(x)} is not in the closed list`); return; }
    if (path === 'spec.intent' || path === 'spec.source') {
      const main = ev.items.find((i) => i.key === 'main');
      if (typeof x !== 'string' || !ID_SHAPE.test(x)) errs.push(`${path}: not an id: ${JSON.stringify(x)}`);
      else if (path === 'spec.intent' && main && x !== main.template_id) errs.push(`${path}: ${x} is not the main item's id ${main.template_id}`);
      else if (path === 'spec.source' && x !== spec.intent && x !== 'guard') errs.push(`${path}: source must be the intent id or guard`);
      return;
    }
    if (typeof x === 'string') { if (!exempt && carriesFigure(x, ECHO_KEYS.has(path.split('.').pop()!) ? echo : undefined)) errs.push(`${path}: text carries a figure: ${JSON.stringify(x)}`); return; }
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

const sortKeys = (x: unknown): unknown => Array.isArray(x) ? x.map(sortKeys) : x && typeof x === 'object'
  ? Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortKeys(v)])) : x;
function runRecipe(it: EvidenceItem, store: PortfolioStore) {
  if (!it.recipe?.intent) return null;
  const out = executeCompositionalPlan({ id: it.key, type: 'adhoc', question: it.recipe.question } as never, store, { intent: it.recipe.intent });
  return out.envelope.proof && verifyAnswerEnvelope(out.envelope, store).valid ? out.envelope : null;
}

/**
 * Re-executes every evidence item from its recipe through compute() and checks
 * the stored result is byte-identical. A rehashed tamper fails here, because the
 * hash is compared to the fresh result, not to the stored one.
 */
export function recomputeErrors(ev: Evidence, store: PortfolioStore): string[] {
  const errs: string[] = [];
  for (const it of ev.items) {
    if (it.key === 'main' && it.recipe && JSON.stringify(sortKeys(it.recipe.intent)) !== JSON.stringify(sortKeys(parseQueryIntent(it.recipe.question, store))))
      errs.push('evidence main: recipe intent is not the lexicon reading of its question');
    const fresh = runRecipe(it, store);
    if (!fresh) { errs.push(`evidence ${it.key}: recipe does not recompute to a verified answer`); continue; }
    if (fresh.proof?.template_id !== it.template_id) errs.push(`evidence ${it.key}: template id is not the recomputed id`);
    const h = hashOf(fresh.result);
    if (h !== it.result_hash || hashOf(it.result) !== h) errs.push(`evidence ${it.key}: stored result differs from recomputed result`);
  }
  return errs;
}

/** Counts traced numbers in a spec (for fidelity reporting). */
export function countNums(x: unknown): number {
  if (isNum(x)) return 1;
  if (Array.isArray(x)) return x.reduce((a, y) => a + countNums(y), 0);
  if (x && typeof x === 'object') return Object.values(x).reduce((a: number, y) => a + countNums(y), 0);
  return 0;
}
