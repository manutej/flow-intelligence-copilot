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
export function usedInputs(intent: ParsedQueryIntent | null | undefined, store: PortfolioStore): Set<number> {
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
  if (intent.measure === 'decision_outcome_learning') { used.add(store.policy.priorSpendUsdBeta0); used.add(store.policy.priorLeasesAlpha0); }
  return used;
}

// a word that names a prior: prior(s), beta (beta0, beta-0, beta zero), β, b0 / b_0
const PRIOR_WORD = /(?<![\p{L}\p{N}])(?:priors?|(?:beta|β)(?:[\s_-]?(?:zero|nought|naught|sub[\s-]?zero)\b|[\p{L}\p{N}_-]*)|b_?0)(?![\p{L}\p{N}])/giu;
const CLAUSE = /[,;.!?()\n→]/u;
const NEAR_TOKENS = 5;

/** Every number (not a date or period label) stated within a few words of a prior word, in the same clause, in every turn. */
export function priorNumbers(input: string, isLabel: (t: string, start: number, end: number) => boolean = () => false): StatedNumber[] {
  const out: StatedNumber[] = [];
  for (const turn of input.split(/\s*→\s*/)) {
    const t = prep(turn), nums = statedNumbers(turn).filter((n) => !isLabel(t, n.start, n.end)); // dates and periods are labels
    for (const w of t.matchAll(PRIOR_WORD)) {
      const ws = w.index!, we = ws + w[0].length;
      for (const n of nums) {
        if (n.start < we && n.end > ws) continue; // part of the prior's name (beta-0, beta zero)
        const gap = n.start >= we ? t.slice(we, n.start) : t.slice(n.end, ws);
        if (CLAUSE.test(gap.replace(/(?<=\d)[,.](?=\d)/g, ''))) continue;
        if (gap.trim().split(/\s+/).filter(Boolean).length <= NEAR_TOKENS) out.push(n);
      }
    }
  }
  return out;
}

/** Words in the question that name things with digits (beta0, P04, X001): echoed verbatim, never as numbers. */
export const identifierTokens = (q: string, intent?: unknown): string[] => {
  const known = JSON.stringify(intent ?? null);
  // short codes (P04, Q3, beta0) always; longer ones (decision X001) only when the computation used that id
  return (prep(q).match(/(?<![\p{L}\p{N}])\p{L}+[_-]?\p{N}+(?![\p{L}\p{N}])/gu) ?? []).filter((w) => /^\D+\d{1,2}$/u.test(w) || known.includes(`"${w}"`));
};

/** The prior inputs a computation used: the learner's policy priors when the learner runs, else none. */
export function usedPriors(intent: ParsedQueryIntent | null | undefined, store: PortfolioStore): Set<number> {
  return intent?.measure === 'decision_outcome_learning' ? new Set([store.policy.priorSpendUsdBeta0, store.policy.priorLeasesAlpha0]) : new Set();
}
