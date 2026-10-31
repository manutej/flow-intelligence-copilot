/**
 * Numeric inputs stated in a question, in normalized form, and the inputs a
 * computation actually used. A chart may echo a stated number only if the
 * computation used it; a number stated next to a prior that the computation did
 * not use makes the panel a clarify card (TENACITY 601bdfa HIGH).
 *
 * This is structural, not a phrase list: every number in every turn is read,
 * and "near a prior" is proximity to a prior keyword in the same clause.
 */
import { UNIT_NOUN_RE, type ParsedQueryIntent } from '../agent/intent.ts';
import { FLOW_PORTFOLIO_SCHEMA } from '../schema.ts';
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
      // the learner with no setting stated (Q77 governs). The learner's settings declare what they
      // can be stated in: a currency (beta0, the CAD rate), a duration, a percent, leases or
      // pseudo-observations (alpha0), or a bare value. A number in an earlier non-standalone turn
      // that is bare or carries one of those units may be a prior ("Use 4 instead", "4 months"),
      // so it clarifies, whatever the wording. A number attached to a noun no setting can be
      // stated in ("2 meetings", "3 properties") cannot be a prior value and is not read.
      if (first < 0 && learner(intent)) {
        const all = nums.filter((n) => n.start >= a && n.end <= b && !isRank(t, n));
        // a magnitude word with no numeral ("make it a thousand", "half a dozen months") is a value too
        for (const m of t.slice(a, b).matchAll(MAGNITUDE)) {
          const st = a + m.index!, en = st + m[0].length;
          if (!all.some((n) => n.start < en && n.end > st)) all.push({ start: st, end: en, value: NaN, surface: m[0], unit: 'none' } as Num);
        }
        for (const m of t.slice(a, b).matchAll(FOREIGN_NUMBER)) {
          const st = a + m.index!, en = st + m[0].length;
          if (SETTING_UNIT.test(t.slice(en, b)) && !all.some((n) => n.start < en && n.end > st)) all.push({ start: st, end: en, value: NaN, surface: m[0], unit: 'none' } as Num);
        }
        // a standalone or request parse may consume a number only for its own slot: a plain count
        // the parse reads (deleting it changes the parse), never a currency, time or percent value
        let stripped = t.slice(a, b);
        for (const n of [...all].sort((x, y) => y.start - x.start)) stripped = stripped.slice(0, n.start - a) + ' ' + stripped.slice(n.end - a);
        const parsed = sa || !!subject?.(stripped);
        const slot = (n: Num) => parsed && !Number.isNaN(n.value) && n.unit === 'none' && !!parse && parse(t.slice(a, n.start) + t.slice(n.end, b)) !== turnBase;
        if (all.some((n) => !slot(n as Num) && settingCandidate(t, a, b, n as Num))) ambiguous = true;
      }
    });
  }
  const equal = (b: Binding) => b.value === b.param.value(store) && UNITS_OK[b.param.id].includes(b.unit);
  // the policy value stated where the computation does not use that setting ("Is beta0 3250?"): neutral
  if (bindings.some((b) => equal(b) && !b.param.applies(intent))) ambiguous = true;
  return { bindings, ambiguous, mismatch: bindings.find((b) => !equal(b)) ?? null };
}
const MAGNITUDE = /(?<![\p{L}\p{N}])(?:half\s+)?(?:an?\s+)?(?:dozen|hundred|thousand|million|billion)s?(?![\p{L}\p{N}])/giu;
// The units the learner settings declare (see PARAMETERS, SettingUnit), written in EN/ES/FR/DE:
// any currency (codes, inflections, slang), a duration (with abbreviations), a percent, and
// alpha0's leases / pseudo-observations. "units" is the generic word for a count of the setting.
const SETTING_UNIT = new RegExp(String.raw`^[\s-]*(?:\p{Sc}|${CUR}|\p{Lu}{3}(?![\p{L}])|d[oó]l\p{L}*|dlls?|dls|usd\p{L}*|eur(?:os?)?|pesos?|pounds?|libras?|yen|francs?|francos?|cents?|centavos?|grand|bucks?|credits?|${PERIOD}|mos?|mths?|mnths?|wks?|hrs?|yrs?|d[ií]as?|semanas?|meses|mes|a[nñ]os?|jours?|semaines?|mois|ans?|ann[ée]es?|tage?n?|wochen?|monate?n?|jahren?|%|percent|pct|por\s*ciento|pour\s*cent|prozent|(?:pseudo[\s-]*)?(?:leases?|observations?|observaciones?|observación|beobachtungen?|obs|counts?|arrendamientos?|contratos?|contrats?|baux|bail|mietvertr[äa]ge?|vertr[äa]ge?)|units?|unidades?|unit[ée]s?|einheiten?)(?![\p{L}\p{N}])`, 'iu');
// number words with no English spelling the numeral reader knows (ES/FR/DE): read only with a unit
const FOREIGN_NUMBER = /(?<![\p{L}\p{N}])(?:uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|doce|veinte|treinta|cien|mil|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|douze|vingt|trente|cent|mille|eins|ein|eine|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|zwölf|zwanzig|dreißig|hundert|tausend)(?![\p{L}\p{N}])/giu;
// Closed-class grammar words (articles, auxiliaries, pronouns, prepositions, particles), EN/ES/FR/DE.
// They never name what a number counts.
const FUNCTION_WORD = /^(?:a|an|the|is|are|was|were|be|been|am|'s|would|will|should|could|can|may|might|must|do|does|did|has|have|had|for|to|of|in|on|at|as|by|with|from|into|than|then|and|or|but|so|if|it|its|that|this|these|those|them|me|us|you|him|her|here|there|now|instead|please|pls|plz|more|less|fewer|again|too|also|only|just|rather|actually|maybe|perhaps|really|ok|okay|yes|no|y|o|de|del|la|el|los|las|un|una|en|por|para|con|que|es|aquí|allí|ahí|eso|esto|favor|et|ou|le|les|du|des|une|pour|avec|est|ça|cela|ici|là|svp|und|oder|der|die|das|den|dem|ein|eine|für|mit|ist|bitte|hier|da|dort|statt)$/iu;
// Positive counting frames, closed class: a determiner or possessive right before the number
// ("the 12 numbers", "my 2 teams"), or a subject pronoun and its verb (with an optional
// preposition) right before it ("we had 2 meetings", "I looked at 5 reports").
const DETERMINER = /^(?:the|these|those|my|our|your|his|her|their|its|all|both|los|las|mis|tus|sus|nuestros|nuestras|estos|estas|esos|esas|les|mes|tes|ses|nos|vos|leurs|ces|die|meine|deine|seine|ihre|unsere|eure|diese)$/iu;
const SUBJECT = /^(?:i|we|you|they|he|she|yo|nosotros|ellos|je|nous|on|ils|elles|ich|wir|sie|er)$/iu;
const PREPOSITION = /^(?:at|to|for|on|in|with|about|over|through|a|en|con|sur|avec|dans|à|an|auf|mit|in)$/iu;
// Backstop only: an edit or opinion verb denies the subject-verb frame and the pronoun "one";
// it can only make a turn clarify, never chart.
const EDIT_CUE = /(?<![\p{L}\p{N}])(?:use|using|make|set|try|go|pick|take|choose|want|change|switch|let'?s|instead|actually|rather|more|less|lower|higher|raise|reduce|increase|decrease|halve|double|should|meant?|say|assume|suppose|prefer|pretend|treat|think|thought|guess|guessed|believe|reckon|feel|figure|figured|bet|hope|expect|know|would|said|says|told|tell|usa|usar|pon|poner|mejor|cambia|vez|creo|pienso|mets|mettons|utilise|plutôt|fait|pense|crois|nimm|nehme|setze|verwende|lieber|stattdessen|eigentlich|denke|glaube)(?![\p{L}\p{N}])/iu;
// nouns the grammar and schema already know: the parser's unit nouns and the schema's record kinds
const SCHEMA_NOUNS = new Set(FLOW_PORTFOLIO_SCHEMA.stalks.flatMap((s) => [s.name.toLowerCase(), s.name.toLowerCase().replace(/s$/, '')]));
const knownNoun = (surface: string, w: string) => SCHEMA_NOUNS.has(w.toLowerCase()) || new RegExp(`^(?:${UNIT_NOUN_RE.source})$`, 'iu').test(`${surface} ${w}`) || new RegExp(`^(?:${UNIT_NOUN_RE.source})$`, 'iu').test(w);
const content = (w: string | undefined) => !!w && /^\p{L}+$/u.test(w) && !FUNCTION_WORD.test(w);
function countingFrame(t: string, a: number, n: Num): boolean {
  const clause = t.slice(a, n.start).split(/[,;:!?.]/u).pop()!, w = clause.split(/\s+/u).filter(Boolean);
  if (DETERMINER.test(w.at(-1) ?? '')) return true;
  if (EDIT_CUE.test(clause)) return false;
  const k = PREPOSITION.test(w.at(-1) ?? '') ? w.length - 2 : w.length - 1; // the verb
  if (k < 0) return false;
  if (/^(?:j|n)'\p{L}+$/iu.test(w[k])) return true; // "j'ai"
  return k >= 1 && SUBJECT.test(w[k - 1]) && /^\p{L}+$/u.test(w[k]);
}
// can this number, in this turn, be the value of a learner setting? Fail closed: it is let off
// only on positive evidence that it counts a noun no setting is stated in, a known noun or a
// counting frame, or as the modifier pronoun "one" ("a quick one"). Anything else is bare.
function settingCandidate(t: string, a: number, b: number, n: Num): boolean {
  if (Number.isNaN(n.value) || n.unit !== 'none') return true;
  const after = t.slice(n.end, b);
  if (SETTING_UNIT.test(after)) return true;
  const words = /^[\s-]*[,;:!?.]/u.test(after) ? [] : after.split(/[\s,;:!?.()]+/u).filter(Boolean);
  // "one more question": a quantifier between the count and its noun
  const head = /^(?:more|other|extra|last|further)$/iu.test(words[0] ?? '') ? words[1] : words[0];
  if (content(head) && !SETTING_UNIT.test(' ' + head) && (knownNoun(n.surface, head!) || countingFrame(t, a, n))) return false;
  if (/^one$/iu.test(n.surface) && /^\s*(?:$|[,;:!?.])/u.test(after)) {
    const prev = t.slice(a, n.start).match(/(\p{L}+)\s*$/u)?.[1];
    if (prev && !FUNCTION_WORD.test(prev) && !EDIT_CUE.test(t.slice(a, b))) return false; // "quick one"
  }
  return true;
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
