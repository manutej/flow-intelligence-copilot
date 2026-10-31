/**
 * Numeric inputs stated in a question, in normalized form, and the inputs a
 * computation actually used. A chart may echo a stated number only if the
 * computation used it; a number stated next to a prior that the computation did
 * not use makes the panel a clarify card (TENACITY 601bdfa HIGH).
 *
 * This is structural, not a phrase list: every number in every turn is read,
 * and "near a prior" is proximity to a prior keyword in the same clause.
 */
import type { ParsedQueryIntent } from '../agent/intent.ts';
import type { PortfolioStore } from '../data/schema.ts';

export interface StatedNumber { readonly start: number; readonly end: number; readonly value: number; readonly surface: string }

const UNITS: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALE: Record<string, number> = { hundred: 100, thousand: 1e3, k: 1e3, million: 1e6, m: 1e6, mm: 1e6, bn: 1e9, billion: 1e9 };
const WORD = Object.keys(UNITS).join('|');
// a numeral not glued to a preceding letter or digit (so beta0, b0, P04, Q3 are names, not inputs)
const NUMERAL = /(?<![\p{L}\p{N}_])[$#]?\s?\p{N}+(?:,\p{N}{3})*(?:\.\p{N}+)?(?:\s?(?:k|m|mm|bn|thousand|million|billion)(?![\p{L}]))?/giu;
const SPELLED = new RegExp(`\\b(?:${WORD})(?:[\\s-]+(?:${WORD}|hundred|thousand|million|and))*\\b`, 'gi');

const prep = (t: string) => t.normalize('NFKD').replace(/[\p{Cf}\p{Mn}]/gu, '').normalize('NFKC');

function numeralValue(s: string): number | null {
  const m = s.replace(/[$#\s]/g, '').match(/^([\d,]*\d(?:\.\d+)?)([a-z]*)$/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, '')) * (m[2] ? SCALE[m[2].toLowerCase()] ?? NaN : 1);
  return Number.isFinite(n) ? n : null;
}
function spelledValue(s: string): number | null {
  let total = 0, cur = 0, seen = false;
  for (const w of s.toLowerCase().split(/[\s-]+/)) {
    if (w === 'and') continue;
    if (w in UNITS) { cur += UNITS[w]; seen = true; }
    else if (w === 'hundred') cur = (cur || 1) * 100;
    else if (w in SCALE) { total += (cur || 1) * SCALE[w]; cur = 0; }
  }
  return seen ? total + cur : null;
}

/** Every number stated in a text: numerals (with $ , . k m) and spelled-out numbers, normalized. */
export function statedNumbers(raw: string): StatedNumber[] {
  const t = prep(raw), out: StatedNumber[] = [];
  for (const m of t.matchAll(NUMERAL)) { const v = numeralValue(m[0]); if (v !== null) out.push({ start: m.index!, end: m.index! + m[0].length, value: v, surface: m[0].trim() }); }
  for (const m of t.matchAll(SPELLED)) { const v = spelledValue(m[0]); if (v !== null) out.push({ start: m.index!, end: m.index! + m[0].length, value: v, surface: m[0] }); }
  return out.sort((a, b) => a.start - b.start);
}

/** Numbers the computation used: numeric fields and numeric parts of the parsed intent, and the learner priors when the learner runs. */
export function usedInputs(intent: ParsedQueryIntent | null | undefined, _store?: PortfolioStore): Set<number> {
  const used = new Set<number>();
  const walk = (x: unknown, key = ''): void => {
    if (typeof x === 'number') {
      used.add(x);
      // an integer bound is the same input as its strict form: "fewer than 2" is max 1, "more than 2" is min 3
      if (/Max$/.test(key)) used.add(x + 1); else if (/Min$/.test(key)) used.add(x - 1);
    }
    else if (typeof x === 'string') for (const d of x.match(/(?<![\p{L}])\d+(?:\.\d+)?/gu) ?? []) used.add(Number(d));
    else if (Array.isArray(x)) x.forEach((v) => walk(v, key));
    else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) walk(v, k);
  };
  if (!intent) return used;
  walk(intent);
  if (intent.aggregation === 'argmin' || intent.aggregation === 'argmax') used.add(1); // the single best: "ranks #1"
  return used;
}

// ---- stated model settings -------------------------------------------------------------
// A question can state a model setting (the learner's beta0 / alpha0 priors, the CAD rate). Each
// statement is bound to one parameter with a value and a unit and compared with that parameter's
// policy value alone: values are never pooled across parameters and the unit is never dropped.

export type SettingUnit = 'USD' | 'CAD' | 'none' | 'percent' | 'duration';
export interface Parameter {
  readonly id: 'beta0' | 'alpha0' | 'cadRate';
  readonly name: string; // as the clarify card says it
  readonly unit: 'USD' | 'none'; // the unit its policy value is in
  readonly value: (s: PortfolioStore) => number;
  readonly policy: (s: PortfolioStore) => string;
  readonly applies: (intent: ParsedQueryIntent | null | undefined) => boolean; // does the computation use it
}
const learner = (i: ParsedQueryIntent | null | undefined) => i?.measure === 'decision_outcome_learning';
export const PARAMETERS: Record<Parameter['id'], Parameter> = {
  beta0: { id: 'beta0', name: 'prior', unit: 'USD', value: (s) => s.policy.priorSpendUsdBeta0, policy: (s) => `prior beta0 = $${s.policy.priorSpendUsdBeta0} USD`, applies: learner },
  alpha0: { id: 'alpha0', name: 'prior', unit: 'none', value: (s) => s.policy.priorLeasesAlpha0, policy: (s) => `prior alpha0 = ${s.policy.priorLeasesAlpha0} lease`, applies: learner },
  // the loader converts every CAD amount at the policy rate, whatever the question
  cadRate: { id: 'cadRate', name: 'CAD rate', unit: 'none', value: (s) => s.policy.cadToUsdRate, policy: (s) => `CAD rate 1 CAD = ${s.policy.cadToUsdRate} USD`, applies: () => true },
};

// words naming a setting; `prior` alone does not say which prior (the value's unit may)
const SETTING_WORD = new RegExp([
  String.raw`(?<beta0>(?:beta|β)(?:[\s_-]?(?:zero|nought|naught|sub[\s-]?zero)\b|[\p{L}\p{N}_-]*)|b_?0|prior[\s_-]+spend)`,
  String.raw`(?<alpha0>(?:alpha|α)(?:[\s_-]?(?:zero|nought|naught)\b|[\p{L}\p{N}_-]*)|a_?0|prior[\s_-]+leases?|lease[\s_-]+prior)`,
  String.raw`(?<cadRate>(?:cad|fx|exchange|conversion)(?:[\s_/-]*(?:to[\s_-]*)?usd)?[\s_-]*rate|cad[\s_/-]*(?:to[\s_-]*)?usd)`,
  String.raw`(?<prior>priors?)`,
].map((x) => `(?<![\\p{L}\\p{N}])(?:${x})(?![\\p{L}\\p{N}])`).join('|'), 'giu');
// "prior" as a time word: prior period / month / 3 months / to Q3 is not a model setting
const PERIOD = String.raw`(?:days?|weeks?|months?|quarters?|years?|yrs?|hours?|periods?|seasons?|windows?|terms?|cycles?|fy|ytd|mtd|qtd)`;
const TEMPORAL_AFTER = new RegExp(String.raw`^[\s-]*(?:(?:\p{N}+|\p{L}+)[\s-]+)?${PERIOD}\b|^\s+to\s+(?:(?:19|20)\d\d\b|(?![$\p{N}]|usd|us\$|cad\b|c\$))`, 'iu');
// a value has nothing between it and its setting but these separators
const SEP_AFTER = /^(?:[\s=:≈~→\n]|->|=>|\bof\b|\bto\b|\bset\b|\bis\b|\bequals?\b|\bat\b|\bas\b)*$/iu;
const SEP_BEFORE = /^[\s-]*$/u;
const NEAR_TOKENS = 8;

export interface Binding { readonly param: Parameter; readonly value: number; readonly unit: SettingUnit }
export interface SettingReading {
  readonly bindings: readonly Binding[]; // settings stated with a value
  readonly ambiguous: boolean; // a setting word with a number that cannot be read as its value, or a prior of no stated kind
  readonly mismatch: Binding | null; // the first bound value that is not what the computation used
}

type Num = StatedNumber & { unit: SettingUnit };
function unitOf(t: string, n: StatedNumber): SettingUnit {
  const before = t.slice(Math.max(0, n.start - 5), n.start), after = t.slice(n.end, n.end + 14);
  if (/^\s*%|^\s*percent\b|^\s*pct\b/i.test(after)) return 'percent';
  if (new RegExp(String.raw`^[\s-]*${PERIOD}\b`, 'iu').test(after)) return 'duration';
  if (/^[\s-]*(?:cad|c\$|canadian)\b/i.test(after) || /(?:cad|c\$)\s*$/i.test(before + (n.surface.startsWith('$') ? '' : ''))) return 'CAD';
  if (n.surface.startsWith('$') || /^[\s-]*(?:usd|dollars?|bucks)\b/i.test(after) || /(?:usd|us)\s*\$?\s*$/i.test(before)) return 'USD';
  return 'none';
}
// a rank (top 1, #1, rank 1, no. 1) is not a value
const isRank = (t: string, n: StatedNumber) => n.surface.startsWith('#') || /(?:\btop|\bbottom|\brank(?:ed)?|\bno\.?|\bnumber|\bfirst|\blast)\s*$/i.test(t.slice(Math.max(0, n.start - 10), n.start));
// the end of a number with its unit word ("1800 USD", "3 months")
const unitEnd = (t: string, n: StatedNumber) => n.end + (t.slice(n.end).match(new RegExp(String.raw`^(?:[\s-]*(?:%|percent|pct|cad|c\$|usd|dollars?|bucks|${PERIOD})\b|\s*%)?`, 'iu'))?.[0].length ?? 0);

/** Read every stated setting in every turn (turn markers count as separators). */
export function readSettings(input: string, intent: ParsedQueryIntent | null | undefined, store: PortfolioStore, isLabel: (t: string, start: number, end: number) => boolean = () => false): SettingReading {
  const t = prep(input);
  const nums: Num[] = statedNumbers(input).filter((n) => !isLabel(t, n.start, n.end)).map((n) => ({ ...n, unit: unitOf(t, n) }));
  const bindings: Binding[] = []; let ambiguous = false;
  for (const w of t.matchAll(SETTING_WORD)) {
    const g = w.groups!, ws = w.index!, we = ws + w[0].length;
    const kind = (Object.keys(g) as (keyof typeof g)[]).find((k) => g[k] !== undefined)!;
    if (kind === 'prior' && TEMPORAL_AFTER.test(t.slice(we))) continue;
    // "prior beta0=...", "beta0 prior": the named setting carries the value
    if (kind === 'prior' && (/^[\s_-]*(?:beta|β|b_?0|alpha|α|a_?0)/iu.test(t.slice(we)) || /(?:beta|β|alpha|α)[\p{L}\p{N}_-]*[\s_-]*$/iu.test(t.slice(0, ws)))) continue;
    const free = nums.filter((n) => !(n.start < we && n.end > ws)); // beta-0, beta zero name the setting
    const bound = free.find((n) => n.start >= we && SEP_AFTER.test(t.slice(we, n.start)) && n.unit !== 'duration' && !isRank(t, n))
      ?? free.find((n) => n.end <= ws && SEP_BEFORE.test(t.slice(unitEnd(t, n), ws)) && n.unit !== 'duration' && !isRank(t, n));
    if (bound) {
      const param = kind === 'prior' ? (bound.unit === 'USD' || bound.unit === 'CAD' ? PARAMETERS.beta0 : null) : PARAMETERS[kind as Parameter['id']];
      if (param) bindings.push({ param, value: bound.value, unit: bound.unit }); else ambiguous = true; // "a prior of 1": which prior?
      continue;
    }
    // a number near the setting word that is not its value (and not a rank or a duration): cannot tell
    const near = free.some((n) => !isRank(t, n) && n.unit !== 'duration' && (n.start >= we ? t.slice(we, n.start) : t.slice(n.end, ws)).trim().split(/\s+/).filter(Boolean).length <= NEAR_TOKENS);
    if (near) ambiguous = true;
  }
  const matches = (b: Binding) => b.param.applies(intent) && b.value === b.param.value(store) && (b.unit === b.param.unit || (b.unit === 'none' && b.param.unit === 'USD' && b.param.id === 'beta0'));
  return { bindings, ambiguous, mismatch: bindings.find((b) => !matches(b)) ?? null };
}
/** The setting values a computation used, as stated in the question and equal to policy: the only setting numbers a title may echo. */
export function boundPolicyValues(input: string, intent: ParsedQueryIntent | null | undefined, store: PortfolioStore): Set<number> {
  const r = readSettings(input, intent, store);
  return new Set(r.mismatch || r.ambiguous ? [] : r.bindings.map((b) => b.value));
}

/** Words in the question that name things with digits (beta0, P04, X001): echoed verbatim, never as numbers. */
export const identifierTokens = (q: string, intent?: unknown): string[] => {
  const known = JSON.stringify(intent ?? null);
  // short codes (P04, Q3, beta0) always; longer ones (decision X001) only when the computation used that id
  return (prep(q).match(/(?<![\p{L}\p{N}])\p{L}+[_-]?\p{N}+(?![\p{L}\p{N}])/gu) ?? []).filter((w) => /^\D+\d{1,2}$/u.test(w) || known.includes(`"${w}"`));
};
