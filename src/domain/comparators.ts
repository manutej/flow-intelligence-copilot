/**
 * The typed comparator grammar for unit filters (S1R-L1-2, L1-3). A filter
 * is one rule: COMPARATOR x QUANTITY, where the comparator is a typed op
 * (gte, gt, lte, lt, eq, or an inclusive range) and the quantity is a typed
 * value of one field (bedrooms, bathrooms, sqft, floor, rent). Each lexicon
 * is listed once; every comparator composes with every quantity, so no rule
 * exists for one wording of one field. "X or Y" of two comparators is their
 * union: "on or above" is eq | gt = gte. Strict bounds become inclusive
 * integer bounds because the loader admits only whole numbers.
 */

import { CARDINAL, CARDINAL_WORD, ORDINAL, ORDINAL_WORD, TENS_WORD, parseNumber } from './numbers.ts';

export interface IntRange {
  readonly min?: number;
  readonly max?: number;
}

export type Op = 'gte' | 'gt' | 'lte' | 'lt' | 'eq';
export type Field = 'bedrooms' | 'bathrooms' | 'sqft' | 'floor' | 'rent';

// ---- comparator lexicon: one entry per op ----
const GT = String.raw`(?:more|greater|larger|bigger|higher|taller|pricier|costlier|more\s+expensive)\s+than|above|over|exceeding|in\s+excess\s+of|beyond`;
const LT = String.raw`(?:fewer|less|smaller|lower|cheaper|less\s+expensive)\s+than|below|under(?:neath)?|beneath`;
const EQ_HEAD = String.raw`(?:on|at|equal\s+to|exactly)`;
const PREFIX_OPS: ReadonlyArray<readonly [Op, string]> = [
  // "<eq> or <gt>" / "<eq> or <lt>": the union of the two.
  ['gte', String.raw`${EQ_HEAD}\s+or\s+(?:${GT})|(?:${GT})\s+or\s+(?:equal\s+to|at|on)`],
  ['lte', String.raw`${EQ_HEAD}\s+or\s+(?:${LT})|(?:${LT})\s+or\s+(?:equal\s+to|at|on)`],
  ['gte', String.raw`at\s+least|(?:a\s+)?minimum\s+of|min\.?|no\s+(?:fewer|less|smaller|lower)\s+than|not\s+(?:fewer|less|smaller|lower)\s+than|>=|≥|=>`],
  ['lte', String.raw`at\s+most|(?:a\s+)?maximum\s+of|max\.?|no\s+(?:more|greater|larger|bigger|higher)\s+than|not\s+(?:more|greater|larger|bigger|higher)\s+than|up\s+to|<=|≤|=<`],
  ['gt', String.raw`${GT}|>`],
  ['lt', String.raw`${LT}|<`],
];
const SUFFIX_OPS: ReadonlyArray<readonly [Op, string]> = [
  ['gte', String.raw`\+|\s+or\s+(?:more|greater|higher|above|larger|bigger|over|up)|\s+and\s+(?:up|above|over|higher)|\s+(?:minimum|min)`],
  ['lte', String.raw`\s+or\s+(?:fewer|less|lower|below|smaller|under)|\s+and\s+(?:below|under|lower)|\s+(?:maximum|max)`],
];

// ---- quantity lexicon: one entry per field ----
// Numbers come from the shared lexicon (numbers.ts), so digits, number
// words and ordinal words read the same in every field (F-089).
const NUM = `(${CARDINAL})`;
const toNum = parseNumber;

/** A field's noun, and the forms of "N <noun>" / "<noun> N" its values take. */
interface Quantity {
  readonly noun: string;
  /** Value with the field self-typed (one capture group). */
  readonly value: string;
  readonly integer: boolean;
}
const ORD = `(${ORDINAL}|${CARDINAL_WORD})`;
const QUANTITIES: Readonly<Record<Field, Quantity>> = {
  bedrooms: { noun: String.raw`(?:bed(?:room)?s?|brs?|bdrms?|bds?)\b`, value: String.raw`${NUM}[-\s]*(?:bed(?:room)?s?|brs?|bdrms?|bds?)\b`, integer: true },
  bathrooms: { noun: String.raw`(?:bath(?:room)?s?|bas?)\b`, value: String.raw`${NUM}[-\s]*(?:bath(?:room)?s?|bas?)\b`, integer: false },
  sqft: { noun: String.raw`(?:sq\.?\s*ft\.?|sqft|sf|square\s+f(?:ee|oo)t(?:age)?|size)`, value: String.raw`${NUM}\s*(?:sq\.?\s*ft\.?|sqft|sf\b|ft²|ft2\b|square\s+f(?:ee|oo)t)`, integer: true },
  floor: { noun: String.raw`(?:floors?|stor(?:e)?y|level)\b`, value: String.raw`(?:(?:the\s+)?(?:floors?|level)\s+${ORD}|(?:the\s+)?${ORD}\s+(?:floor|level))\b`, integer: true },
  rent: { noun: String.raw`(?:(?:market|asking|monthly|list)\s+)?(?:rents?|price|renting)\b`, value: String.raw`\$\s?${NUM}(?:\s*(?:\/\s*mo(?:nth)?|a\s+month|per\s+month))?|${NUM}\s+dollars\b`, integer: true },
};

interface Rule {
  readonly re: RegExp;
  readonly apply: (a: number, b?: number) => IntRange;
}

function bound(op: Op, n: number, integer: boolean): IntRange {
  const step = integer ? 1 : 0.5;
  switch (op) {
    case 'gte': return { min: n };
    case 'gt': return { min: n + step };
    case 'lte': return { max: n };
    case 'lt': return { max: n - step };
    case 'eq': return { min: n, max: n };
  }
}

/** Every field's noun: a number or comparator followed by one belongs to it. */
const ALL_NOUNS = (): string => (Object.values(QUANTITIES) as Quantity[]).map((x) => x.noun).join('|');

/**
 * All rule shapes, generated from the two lexicons. Order: ranges and
 * unions, then comparators bound to a noun, then single comparators.
 * Binding is to the nearest noun phrase (S1R F-075): a number followed by
 * some field's noun is that field's value, never another field's bound, and
 * a trailing comparator ("and below") followed by a noun phrase belongs to
 * that phrase, not to the value before it.
 */
function rulesFor(q: Quantity): Rule[] {
  const rules: Rule[] = [];
  const r = (src: string, apply: Rule['apply']) => rules.push({ re: new RegExp(src, 'i'), apply });
  const range = (a: number, b = a) => ({ min: Math.min(a, b), max: Math.max(a, b) });
  // A union "A or B" is the interval only when it has no gap; otherwise it
  // is no interval, and min > max makes the typed-query check refuse it.
  const union = (a: number, b = a) => (Math.abs(a - b) <= (q.integer ? 1 : 0.5) ? range(a, b) : { min: Math.max(a, b), max: Math.min(a, b) });
  const NOT_OTHER_NOUN = String.raw`(?![\d,.]*\s*(?:-\s*)?(?:${ALL_NOUNS()}))`;
  const AND = String.raw`\s*(?:and|to|through|thru|-|–)\s*`;
  // A number with no noun of its own: "$2,500", "the 3rd".
  const BARE = q.integer ? `(?:the\\s+)?\\$?\\s?(${CARDINAL}(?:st|nd|rd|th)?|${ORDINAL_WORD})` : String.raw`(?:the\s+)?\$?\s?${NUM}`;
  const LEAD = String.raw`(?<![\w$.])`;
  // Inclusive ranges: "between A and B <q>", "A to B <q>", "<noun>s A-B", "from the Ath to the Bth <q>".
  r(String.raw`\b(?:between|from)\s+${BARE}${AND}${q.value}`, range);
  r(String.raw`\b(?:between|from)\s+${q.value}${AND}${q.value}`, range);
  r(String.raw`\b(?:between|from)\s+(?:the\s+)?${q.noun}\s+${BARE}${AND}${BARE}${NOT_OTHER_NOUN}`, range);
  r(String.raw`\b${q.noun}\s+(?:of\s+|is\s+|are\s+)?(?:between|from)\s+${BARE}${AND}${BARE}${NOT_OTHER_NOUN}`, range);
  r(String.raw`${LEAD}${BARE}${AND}${q.value}`, range);
  r(String.raw`\b${q.noun}\s+${BARE}${AND}${BARE}${NOT_OTHER_NOUN}`, range);
  // Unions: "2 or 3 bedrooms", "floor 4 or 5".
  r(String.raw`${LEAD}${BARE}\s*-?\s*(?:or|\/)\s*${q.value}`, union);
  r(String.raw`\b${q.noun}\s+${BARE}\s+or\s+${BARE}${NOT_OTHER_NOUN}`, union);
  // "<noun> <cmp> N": "rent above $2,500", "sqft >= 800", "floor of at least 3".
  for (const [op, c] of PREFIX_OPS) r(String.raw`\b${q.noun}\s*(?:of\s+|is\s+|are\s+)?(?:${c})\s*${BARE}${NOT_OTHER_NOUN}`, (n) => bound(op, n, q.integer));
  // "<noun> of N": "rent of $2,000" is that value exactly.
  r(String.raw`\b${q.noun}\s+(?:of|is|=|at)\s+${BARE}${NOT_OTHER_NOUN}(?!\s*(?:or|and|to|-)\s)`, (n) => bound('eq', n, q.integer));
  // "<cmp> <value>": "at least 2 bedrooms", "on or above floor 5", "under $2,000".
  for (const [op, c] of PREFIX_OPS) r(String.raw`(?:^|[\s(,])(?:${c})\s*${q.value}`, (n) => bound(op, n, q.integer));
  const NOT_NOUN_PHRASE = String.raw`(?!\s*(?:the\s+)?(?:[$\d]|${ALL_NOUNS()}))`;
  for (const [op, c] of SUFFIX_OPS) {
    // "<value> <cmp>": "2 bedrooms or more", "floor 5 or higher", "$2,500 or more".
    r(String.raw`${LEAD}${q.value}(?:${c})(?![\w])${NOT_NOUN_PHRASE}`, (n) => bound(op, n, q.integer));
    // "N <cmp> <noun>": "2+ bedrooms", "2 or more bedrooms".
    r(String.raw`\b${NUM}(?:${c})[-\s]*${q.noun}`, (n) => bound(op, n, q.integer));
  }
  return rules;
}

const FLOOR_EXACT: Rule = {
  re: new RegExp(String.raw`\bon\s+(?:the\s+)?(?:(?:floor|level)\s+${ORD}|${ORD}\s+(?:floor|level))\b`, 'i'),
  apply: (n) => ({ min: n, max: n }),
};
// "first" is the ground floor only when no tens word makes it "twenty-first".
const GROUND = new RegExp(String.raw`\b(?:on\s+the\s+)?(?:ground|(?<!${TENS_WORD}[-\s])first)\s+floor\b`, 'i');

const RULES: Readonly<Record<Field, readonly Rule[]>> = {
  bedrooms: rulesFor(QUANTITIES.bedrooms),
  bathrooms: rulesFor(QUANTITIES.bathrooms),
  sqft: rulesFor(QUANTITIES.sqft),
  floor: [...rulesFor(QUANTITIES.floor), FLOOR_EXACT],
  rent: rulesFor(QUANTITIES.rent),
};

/**
 * The range a question puts on one field, or undefined when none is stated.
 * Every comparator on the field composes: each match is consumed and the
 * ranges intersect, so "above 700 sq ft and 900 sq ft or less" is 701..900.
 * A contradiction ("2 bedrooms and 3 bedrooms") yields min > max, which the
 * typed-query check rejects rather than answering one half.
 */
export function parseRange(q: string, field: Field): IntRange | undefined {
  let rest = q;
  let out: { min?: number; max?: number } | undefined;
  const meet = (r: IntRange) => {
    out = {
      ...(r.min !== undefined || out?.min !== undefined ? { min: Math.max(r.min ?? -Infinity, out?.min ?? -Infinity) } : {}),
      ...(r.max !== undefined || out?.max !== undefined ? { max: Math.min(r.max ?? Infinity, out?.max ?? Infinity) } : {}),
    };
  };
  for (let guard = 0; guard < 8; guard++) {
    let hit = false;
    for (const { re, apply } of RULES[field]) {
      const m = rest.match(re);
      if (!m) continue;
      const nums = m.slice(1).filter((g) => g !== undefined).map(toNum);
      if (nums.some((n) => !Number.isFinite(n))) continue;
      meet(apply(nums[0], nums[1]));
      rest = rest.slice(0, m.index) + ' '.repeat(m[0].length) + rest.slice((m.index ?? 0) + m[0].length);
      hit = true;
      break;
    }
    if (!hit) break;
  }
  if (out === undefined && field === 'floor' && GROUND.test(q) && !/\bfirst\s+floor\s+(?:or|and)\b/i.test(q)) return { min: 1, max: 1 };
  return out as IntRange | undefined;
}

/**
 * True when the question puts a number next to a field's noun ("floors 9 to
 * 12", "650 sq ft"), i.e. it constrains that field. The coverage gate then
 * demands the typed query carry the field (S1R-L1-1, F-060).
 */
export function mentionsQuantity(q: string, field: Field): boolean {
  const n = QUANTITIES[field].noun;
  const num = String.raw`(?<![A-Za-z])(?:\$\s?)?(?:\d[\d,]*(?:\.\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b`;
  const near = String.raw`[^.?!\d]{0,14}?`;
  // A number that types itself as another field ("one-bedroom") is not this one's.
  let rest = q.replace(/\bP\d{2,3}\b/gi, ' ');
  for (const other of Object.keys(QUANTITIES) as Field[]) {
    if (other !== field) rest = rest.replace(new RegExp(QUANTITIES[other].value, 'gi'), ' ');
  }
  return new RegExp(String.raw`${num}${near}\b${n}|\b${n}${near}${num}`, 'i').test(rest);
}

/** Distinct values the question states for a field ("2 bedrooms ... 3 bedrooms" is two). */
export function statedValues(q: string, field: Field): number[] {
  return [...new Set([...q.matchAll(new RegExp(QUANTITIES[field].value, 'gi'))].map((m) => toNum(m.slice(1).find((g) => g !== undefined) ?? '')).filter(Number.isFinite))];
}

export const parseBedroomRange = (q: string) => parseRange(q, 'bedrooms');
export const parseBathroomRange = (q: string) => parseRange(q, 'bathrooms');
export function parseSqftBounds(q: string): { sqftMin?: number; sqftMax?: number } {
  const r = parseRange(q, 'sqft');
  return { sqftMin: r?.min, sqftMax: r?.max };
}
export function parseRentBounds(q: string): { rentMin?: number; rentMax?: number } {
  const r = parseRange(q, 'rent');
  return { rentMin: r?.min, rentMax: r?.max };
}
export function parseFloorBounds(q: string): { floorMin?: number; floorMax?: number } {
  const r = parseRange(q, 'floor');
  return { floorMin: r?.min, floorMax: r?.max };
}

/** Every phrase some comparator rule reads, for the closed-world word check. */
export const COMPARATOR_PHRASES: readonly RegExp[] = [
  ...Object.values(RULES).flat().map(({ re }) => new RegExp(re.source, 'gi')),
  new RegExp(GROUND.source, 'gi'),
];
