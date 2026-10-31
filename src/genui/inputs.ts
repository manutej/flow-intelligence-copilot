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
  for (const m of t.matchAll(NUMERAL)) { const v = numeralValue(m[0]); if (v !== null) { const lead = m[0].length - m[0].trimStart().length; out.push({ start: m.index! + lead, end: m.index! + m[0].length, value: v, surface: m[0].trim() }); } }
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

// ---- the strict grammar of a stated setting (allow-list; anything else near a setting word is unreadable) ----
//   statement := word SEP value END | value [-\s]+ word END-free
//   value     := [CUR] NUMBER [CUR [per CAD]]       NUMBER := digits[,ddd][.d+][k]
//   END       := end of turn | , ; ! ? . (not a decimal) | newline | turn marker | and / but / then / while
const CUR = String.raw`(?:usd|us\$|us dollars?|cad|c\$|cad\$|canadian dollars?|dollars?|\$)`;
const VALUE = String.raw`(?:(?<pre>${CUR})\s*)?(?<num>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?<k>\s?k)?(?:[\s-]*(?<post>${CUR})(?<per>\s+per\s+cad)?)?`;
const SEP = String.raw`(?:\s*(?:=|:|≈|~|→|->|=>|\bof\b|\bset\s+to\b|\bto\b|\bis\b|\bat\b|\bequals?\b)\s*|\s+)+`;
const END = String.raw`(?=\s*$|\s*[,;!?\n→)]|\s*\.(?!\d)|\s*(?:->|=>|⟶)|\s+(?:and|but|then|while)\b)`;
const STATEMENT_AFTER = new RegExp(String.raw`^${SEP}${VALUE}${END}`, 'iu');
const STATEMENT_BEFORE = new RegExp(String.raw`(?:^|[\s,;(])${VALUE.replace(/\?<(\w+)>/g, '?<$1>')}[\s-]+$`, 'iu');
const EXCHANGE = new RegExp(String.raw`(?<![\p{L}\p{N}.])1\s*cad\s*=\s*(?<num>\d+(?:\.\d+)?)\s*usd${END}`, 'giu');
const UNITS_OK: Record<Parameter['id'], readonly SettingUnit[]> = { beta0: ['USD', 'none'], alpha0: ['none'], cadRate: ['none', 'USD'] };
function statementValue(g: Record<string, string | undefined>): { value: number; unit: SettingUnit } {
  const value = Number(g.num!.replace(/,/g, '')) * (g.k ? 1e3 : 1);
  const cur = [g.pre, g.post].filter(Boolean).map((c) => (/cad|c\$|canadian/i.test(c!) ? 'CAD' : 'USD'));
  // a currency on both sides must agree; "0.73 USD per CAD" is a rate in USD
  const unit: SettingUnit = cur.length === 0 ? 'none' : new Set(cur).size > 1 ? 'percent' /* never matches a policy unit */ : (cur[0] as SettingUnit);
  return { value, unit: g.per && unit === 'USD' ? 'USD' : g.per ? 'percent' : unit };
}

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
const isRank = (t: string, n: StatedNumber) => n.surface.startsWith('#') || /(?:\btop|\bbottom|\brank(?:ed)?|\bno\.?|\bnumber|\bfirst|\blast|\bwhich)\s*$/i.test(t.slice(Math.max(0, n.start - 10), n.start));
// the end of a number with its unit word ("1800 USD", "3 months")
const unitEnd = (t: string, n: StatedNumber) => n.end + (t.slice(n.end).match(new RegExp(String.raw`^(?:[\s-]*(?:%|percent|pct|cad|c\$|usd|dollars?|bucks|${PERIOD})\b|\s*%)?`, 'iu'))?.[0].length ?? 0);

/** Read every stated setting in every turn (turn markers count as separators). */
export function readSettings(input: string, intent: ParsedQueryIntent | null | undefined, store: PortfolioStore, isLabel: (t: string, start: number, end: number) => boolean = () => false, parse?: (turn: string) => string, standalone?: (turn: string) => boolean, subject?: (turn: string) => boolean): SettingReading {
  const t = prep(input);
  const nums: Num[] = statedNumbers(input).filter((n) => !isLabel(t, n.start, n.end)).map((n) => ({ ...n, unit: unitOf(t, n) }));
  const bindings: Binding[] = []; let ambiguous = false; const consumed: [number, number][] = [];
  for (const w of t.matchAll(SETTING_WORD)) {
    const g = w.groups!, ws = w.index!, we = ws + w[0].length;
    const kind = (Object.keys(g) as (keyof typeof g)[]).find((k) => g[k] !== undefined)!;
    if (kind === 'prior' && TEMPORAL_AFTER.test(t.slice(we))) continue;
    // "prior beta0=...", "beta0 prior": the named setting carries the value
    if (kind === 'prior' && (/^[\s_-]*(?:beta|β|b_?0|alpha|α|a_?0)/iu.test(t.slice(we)) || /(?:beta|β|alpha|α)[\p{L}\p{N}_-]*[\s_-]*$/iu.test(t.slice(0, ws)))) continue;
    const free = nums.filter((n) => !(n.start < we && n.end > ws)); // beta-0, beta zero name the setting
    // a number that runs past the setting's name ("beta zero one") is not a stated value we can read
    if (nums.some((n) => n.start < we && n.end > we)) { ambiguous = true; continue; }
    // fail closed: only a statement that parses fully under the strict grammar binds a value
    const after = STATEMENT_AFTER.exec(t.slice(we)), before = after ? null : STATEMENT_BEFORE.exec(t.slice(0, ws));
    const st = after ?? before;
    if (st) consumed.push(after ? [we, we + after[0].length] : [before!.index, ws]);
    if (st) {
      const v = statementValue(st.groups!);
      const param = kind === 'prior' ? (v.unit !== 'none' ? PARAMETERS.beta0 : null) : PARAMETERS[kind as Parameter['id']];
      // "per CAD" makes a rate: only the CAD rate is one
      if (param && st.groups!.per && param.id !== 'cadRate') { ambiguous = true; continue; }
      if (param) bindings.push({ param, value: v.value, unit: v.unit }); else ambiguous = true; // "a prior of 1": which prior?
      continue;
    }
    // a number near the setting word that is not its value (and not a rank or a duration): cannot tell
    const near = free.some((n) => !isRank(t, n) && n.unit !== 'duration' && (n.start >= we ? t.slice(we, n.start) : t.slice(n.end, ws)).trim().split(/\s+/).filter(Boolean).length <= NEAR_TOKENS);
    if (near) ambiguous = true;
  }
  // the rate written as an exchange, with no setting word: "1 CAD = 0.73 USD"
  for (const m of t.matchAll(EXCHANGE)) { bindings.push({ param: PARAMETERS.cadRate, value: Number(m.groups!.num), unit: 'USD' }); consumed.push([m.index!, m.index! + m[0].length]); }
  // accounting, by mention: once a setting is stated (or the computation is the learner, whose
  // priors a user can state), each number in a setting turn and in the charted turn must be a
  // mention something consumed: a setting statement, or (charted turn only) the parser, tested by
  // deleting that one mention and re-parsing. Two mentions with the same value are different
  // mentions. After a setting turn, every turn up to the charted one must parse as a standalone
  // question; anything else ("halve it", "mejor 1800", "go lower please") may change the setting
  // and gets the neutral card. Turns before the first setting turn are not read (Q77 rule).
  if (bindings.length || learner(intent)) {
    const isConsumed = (n: StatedNumber) => consumed.some(([a, b]) => n.start >= a && n.end <= b);
    const turns: [number, number][] = []; let at = 0;
    for (const m of t.matchAll(/\s*→\s*/g)) { turns.push([at, m.index!]); at = m.index! + m[0].length; }
    turns.push([at, t.length]);
    const last = turns.length - 1, [fs, fe] = turns[last];
    const base = parse?.(t.slice(fs, fe));
    const parserUsed = (n: StatedNumber) => parse ? parse(t.slice(fs, n.start) + t.slice(n.end, fe)) !== base : usedInputs(intent).has(n.value);
    const isSetting = ([a, b]: [number, number]) => [...t.matchAll(SETTING_WORD)].some((w) => w.index! >= a && w.index! < b) || consumed.some(([x]) => x >= a && x < b);
    const first = turns.findIndex(isSetting);
    turns.forEach(([a, b], i) => {
      const own = nums.filter((n) => n.start >= a && n.end <= b && !isRank(t, n) && n.unit !== 'duration');
      if (i === last) { if (own.some((n) => !isConsumed(n) && !parserUsed(n))) ambiguous = true; return; }
      if (isSetting([a, b])) { if (own.some((n) => !isConsumed(n))) ambiguous = true; return; }
      // standalone exempts a turn only from the referring check: its own numbers must still be read
      // by its own parse (delete that mention and re-parse), else they are left over
      const sa = standalone?.(t.slice(a, b)) ?? false, turnBase = parse?.(t.slice(a, b));
      const leftover = own.filter((n) => !(parse && parse(t.slice(a, n.start) + t.slice(n.end, b)) !== turnBase));
      if (first >= 0 && i > first) { if (!sa || leftover.length) ambiguous = true; return; }
      // the learner with no setting stated (Q77 governs): any number in an earlier non-standalone
      // turn, durations included, may be a prior ("Use 4 instead", "use 4 months"), so it clarifies
      // unless the turn is clearly non-editing; only then is a count ("3 properties") or the
      // pronoun "one" exempt. When unsure, clarify.
      if (first < 0 && learner(intent)) {
        const all = nums.filter((n) => n.start >= a && n.end <= b && !isRank(t, n));
        // a magnitude word with no numeral ("make it a thousand", "half a dozen months") is a value too
        for (const m of t.slice(a, b).matchAll(MAGNITUDE)) {
          const st = a + m.index!, en = st + m[0].length;
          if (!all.some((n) => n.start < en && n.end > st)) all.push({ start: st, end: en, value: NaN, surface: m[0] } as Num);
        }
        const pool = sa ? all.filter((n) => leftover.includes(n) || n.unit === 'duration' && !(parse && parse(t.slice(a, n.start) + t.slice(n.end, b)) !== turnBase)) : all;
        // a request parse (Q77): with its numbers deleted, the turn still names something the parser
        // or the property resolver reads, and no number carries a currency, time or percent unit.
        // Its numbers belong to that parse and the cue check does not apply. A turn that only names
        // a value and a unit ("1800 dollars instead") reads as nothing once the value is gone.
        let stripped = t.slice(a, b);
        for (const n of [...all].sort((x, y) => y.start - x.start)) stripped = stripped.slice(0, n.start - a) + ' ' + stripped.slice(n.end - a);
        const request = !!subject?.(stripped) && all.every((n) => !Number.isNaN(n.value) && (n as Num).unit === 'none');
        const used = (n: StatedNumber) => !!parse && parse(t.slice(a, n.start) + t.slice(n.end, b)) !== turnBase;
        if (request ? all.some((n) => !used(n) && !entityCount(t, a, b, n, false)) : pool.some((n) => !entityCount(t, a, b, n))) ambiguous = true;
      }
    });
  }
  const equal = (b: Binding) => b.value === b.param.value(store) && UNITS_OK[b.param.id].includes(b.unit);
  // the policy value stated where the computation does not use that setting ("Is beta0 3250?"): neutral
  if (bindings.some((b) => equal(b) && !b.param.applies(intent))) ambiguous = true;
  return { bindings, ambiguous, mismatch: bindings.find((b) => !equal(b)) ?? null };
}
const MAGNITUDE = /(?<![\p{L}\p{N}])(?:half\s+)?(?:an?\s+)?(?:dozen|hundred|thousand|million|billion)s?(?![\p{L}\p{N}])/giu;
// Data entities a count may name with no setting stated: the portfolio's record nouns the schema
// and grammar know (properties, buildings) and what an answer is made of (charts, numbers, rows).
// Units are an entity only inside a request parse, which the standalone path already reads.
const ENTITY = /^\s+(?:properties|property|buildings|building|charts|chart|numbers|number|rows|row)(?![\p{L}\p{N}])/iu;
// Backstop only: an edit cue anywhere in the turn (EN/ES/FR/DE) denies the count exemption. It can
// only make a turn clarify, never chart.
const EDIT_CUE = /(?<![\p{L}\p{N}])(?:use|using|make|set|try|go|change|switch|let'?s|instead|actually|rather|more|less|lower|higher|raise|reduce|increase|decrease|halve|double|should|meant?|say|usa|usar|pon|poner|mejor|cambia|vez|mets|mettons|utilise|plutôt|fait|nimm|setze|verwende|lieber|stattdessen|eigentlich)(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(?:more|less|más|menos|plus|moins|mehr|weniger)(?!\s*\p{L})/iu;
// a number passes only as the plain count of a data entity, in a turn with no edit cue; currency,
// time, percent and magnitude words never pass, and anything uncertain clarifies
function entityCount(t: string, a: number, b: number, n: StatedNumber, cue = true): boolean {
  if (Number.isNaN(n.value) || (n as Num).unit !== undefined && (n as Num).unit !== 'none') return false;
  return ENTITY.test(t.slice(n.end, b)) && !(cue && EDIT_CUE.test(t.slice(a, b)));
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
