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
const NUM = String.raw`(\d[\d,]*(?:\.\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten)`;
const WORDS: Readonly<Record<string, number>> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const toNum = (raw: string) => WORDS[raw.toLowerCase()] ?? Number.parseFloat(raw.replace(/,/g, ''));

/** A field's noun, and the forms of "N <noun>" / "<noun> N" its values take. */
interface Quantity {
  readonly noun: string;
  /** Value with the field self-typed (one capture group). */
  readonly value: string;
  readonly integer: boolean;
}
const ORD = String.raw`(\d{1,3})(?:st|nd|rd|th)?`;
const QUANTITIES: Readonly<Record<Field, Quantity>> = {
  bedrooms: { noun: String.raw`(?:bed(?:room)?s?|brs?|bdrms?|bds?)\b`, value: String.raw`${NUM}[-\s]*(?:bed(?:room)?s?|brs?|bdrms?|bds?)\b`, integer: true },
  bathrooms: { noun: String.raw`(?:bath(?:room)?s?|bas?)\b`, value: String.raw`${NUM}[-\s]*(?:bath(?:room)?s?|bas?)\b`, integer: false },
  sqft: { noun: String.raw`(?:sq\.?\s*ft\.?|sqft|sf|square\s+f(?:ee|oo)t(?:age)?|size)`, value: String.raw`${NUM}\s*(?:sq\.?\s*ft\.?|sqft|sf\b|ft²|ft2\b|square\s+f(?:ee|oo)t)`, integer: true },
  floor: { noun: String.raw`(?:floors?|stor(?:e)?y|level)\b`, value: String.raw`(?:(?:the\s+)?floors?\s+${ORD}|(?:the\s+)?${ORD}\s+floor)\b`, integer: true },
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

/** All rule shapes, generated from the two lexicons. Order: ranges, unions, then single comparators. */
function rulesFor(q: Quantity): Rule[] {
  const rules: Rule[] = [];
  const r = (src: string, apply: Rule['apply']) => rules.push({ re: new RegExp(src, 'i'), apply });
  const range = (a: number, b = a) => ({ min: Math.min(a, b), max: Math.max(a, b) });
  // Inclusive ranges: "between A and B <q>", "between <noun> A and B", "from A to B <q>", "<noun> between A and B".
  const AND = String.raw`\s*(?:and|to|through|thru|-|–)\s*`;
  const BARE = String.raw`\$?\s?${NUM}`;
  r(String.raw`\b(?:between|from)\s+${BARE}${AND}${q.value}`, range);
  r(String.raw`\b(?:between|from)\s+${q.value}${AND}${q.value}`, range);
  r(String.raw`\b(?:between|from)\s+(?:the\s+)?${q.noun}\s+${BARE}${AND}${BARE}`, range);
  r(String.raw`\b${q.noun}\s+(?:of\s+|is\s+|are\s+)?(?:between|from)\s+${BARE}${AND}${BARE}`, range);
  // "<noun> <cmp> N" first, so the noun is consumed with its comparator:
  // "rent above $2,500", "sqft >= 800", "floor of at least 3".
  for (const [op, c] of PREFIX_OPS) r(String.raw`\b${q.noun}\s*(?:of\s+|is\s+|are\s+)?(?:${c})\s*${BARE}`, (n) => bound(op, n, q.integer));
  // "<cmp> <value>": "at least 2 bedrooms", "on or above floor 5", "under $2,000".
  for (const [op, c] of PREFIX_OPS) r(String.raw`(?:^|[\s(,])(?:${c})\s*${q.value}`, (n) => bound(op, n, q.integer));
  for (const [op, c] of SUFFIX_OPS) {
    // "<value> <cmp>": "2 bedrooms or more", "floor 5 or higher", "900 sq ft or larger".
    r(String.raw`\b${q.value}(?:${c})(?![\w])`, (n) => bound(op, n, q.integer));
    // "N <cmp> <noun>": "2+ bedrooms", "2 or more bedrooms".
    r(String.raw`\b${NUM}(?:${c})[-\s]*${q.noun}`, (n) => bound(op, n, q.integer));
  }
  return rules;
}

const FLOOR_EXACT: Rule = {
  re: new RegExp(String.raw`\bon\s+(?:the\s+)?(?:floor\s+${ORD}|${ORD}\s+floor)\b`, 'i'),
  apply: (n) => ({ min: n, max: n }),
};
const GROUND = /\b(?:on\s+the\s+)?(?:ground|first)\s+floor\b/i;

const RULES: Readonly<Record<Field, readonly Rule[]>> = {
  bedrooms: rulesFor(QUANTITIES.bedrooms),
  bathrooms: rulesFor(QUANTITIES.bathrooms),
  sqft: rulesFor(QUANTITIES.sqft),
  floor: [...rulesFor(QUANTITIES.floor), FLOOR_EXACT],
  rent: rulesFor(QUANTITIES.rent),
};

/** The range a question puts on one field, or undefined when none is stated. */
export function parseRange(q: string, field: Field): IntRange | undefined {
  for (const { re, apply } of RULES[field]) {
    const m = q.match(re);
    if (!m) continue;
    const nums = m.slice(1).filter((g) => g !== undefined).map(toNum);
    if (nums.some((n) => !Number.isFinite(n))) continue;
    return apply(nums[0], nums[1]);
  }
  if (field === 'floor' && GROUND.test(q) && !/\bfirst\s+floor\s+(?:or|and)\b/i.test(q)) return { min: 1, max: 1 };
  return undefined;
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
