/**
 * The comparator grammar for unit filters. One table drives both the parse
 * (what bound a phrase sets) and the closed-world check (which words a filter
 * has consumed), so the two cannot drift apart. Strict bounds become
 * inclusive ones because the loader admits only whole numbers for bedrooms,
 * bathrooms, sqft, floor and market rent.
 */

export interface IntRange {
  readonly min?: number;
  readonly max?: number;
}

const WORDS: Readonly<Record<string, number>> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const NUM = String.raw`(\d[\d,]*|zero|one|two|three|four|five|six|seven|eight|nine|ten)`;
const toNum = (raw: string) => WORDS[raw.toLowerCase()] ?? Number.parseInt(raw.replace(/,/g, ''), 10);

type Bound = (n: number) => IntRange;
const AT_LEAST: Bound = (n) => ({ min: n });
const AT_MOST: Bound = (n) => ({ max: n });
const ABOVE: Bound = (n) => ({ min: n + 1 });
const BELOW: Bound = (n) => ({ max: n - 1 });
const EXACT: Bound = (n) => ({ min: n, max: n });

// Comparators written in front of the number.
const PREFIX: ReadonlyArray<[string, Bound]> = [
  [String.raw`(?:at\s+least|a\s+minimum\s+of|minimum\s+of|min\.?|no\s+fewer\s+than|no\s+less\s+than|not\s+less\s+than)`, AT_LEAST],
  [String.raw`(?:at\s+most|a\s+maximum\s+of|maximum\s+of|max\.?|no\s+more\s+than|not\s+more\s+than|up\s+to)`, AT_MOST],
  [String.raw`(?:more\s+than|over|above|larger\s+than|bigger\s+than|greater\s+than|higher\s+than)`, ABOVE],
  [String.raw`(?:fewer\s+than|less\s+than|under|below|smaller\s+than|lower\s+than)`, BELOW],
];
// Comparators written after the number ("2+ bedrooms", "2 bedrooms or more").
const SUFFIX: ReadonlyArray<[string, Bound]> = [
  [String.raw`(?:\+|\s+or\s+more|\s+or\s+greater|\s+or\s+higher|\s+or\s+above|\s+and\s+up|\s+and\s+above|\s+and\s+higher)`, AT_LEAST],
  [String.raw`(?:\s+or\s+fewer|\s+or\s+less|\s+or\s+lower|\s+or\s+below|\s+and\s+below|\s+and\s+under)`, AT_MOST],
];

interface Rule {
  readonly re: RegExp;
  readonly bound: Bound;
}

/** Rules for "<cmp> N <noun>", "N<cmp> <noun>" and "N <noun><cmp>". */
function numberNounRules(noun: string): Rule[] {
  return [
    ...PREFIX.map(([c, bound]) => ({ re: new RegExp(String.raw`\b${c}\s+${NUM}[-\s]*${noun}`, 'i'), bound })),
    ...SUFFIX.flatMap(([c, bound]) => [
      { re: new RegExp(String.raw`\b${NUM}${c}[-\s]*${noun}`, 'i'), bound },
      { re: new RegExp(String.raw`\b${NUM}[-\s]*${noun}${c}`, 'i'), bound },
    ]),
  ];
}

/** Rules for "<noun> <cmp> N": "market rent above $2,500", "sqft >= 800". */
function nounNumberRules(noun: string, pre = ''): Rule[] {
  return [
    ...PREFIX.map(([c, bound]) => ({ re: new RegExp(String.raw`\b${noun}\s+(?:of\s+)?${c}\s+${pre}${NUM}`, 'i'), bound })),
    { re: new RegExp(String.raw`\b${noun}\s*(?:>=|≥)\s*${pre}${NUM}`, 'i'), bound: AT_LEAST },
    { re: new RegExp(String.raw`\b${noun}\s*(?:<=|≤)\s*${pre}${NUM}`, 'i'), bound: AT_MOST },
    { re: new RegExp(String.raw`\b${noun}\s*>\s*${pre}${NUM}`, 'i'), bound: ABOVE },
    { re: new RegExp(String.raw`\b${noun}\s*<\s*${pre}${NUM}`, 'i'), bound: BELOW },
  ];
}

const BED = String.raw`(?:bed(?:room)?s?|brs?|bdrms?|bds?)\b`;
const BATH = String.raw`(?:bath(?:room)?s?)\b`;
const SQFT = String.raw`(?:sq\.?\s*ft\.?|sqft|square\s+f(?:ee|oo)t)`;
const RENT = String.raw`(?:(?:market|asking|monthly)\s+)?(?:rents?|renting)`;
const ORD = String.raw`(\d{1,3})(?:st|nd|rd|th)?`;

const FLOOR_RULES: Rule[] = [
  ...SUFFIX.map(([c, bound]) => ({ re: new RegExp(String.raw`\bfloors?\s+${ORD}${c}`, 'i'), bound })),
  ...SUFFIX.map(([c, bound]) => ({ re: new RegExp(String.raw`\b(?:the\s+)?${ORD}\s+floor${c}`, 'i'), bound })),
  ...PREFIX.map(([c, bound]) => ({ re: new RegExp(String.raw`\b${c}\s+(?:the\s+)?(?:floor\s+${ORD}|${ORD}\s+floor)\b`, 'i'), bound })),
  { re: new RegExp(String.raw`\bon\s+(?:the\s+)?(?:floor\s+${ORD}|${ORD}\s+floor)\b`, 'i'), bound: EXACT },
];

const RULES = {
  bedrooms: numberNounRules(BED),
  bathrooms: numberNounRules(BATH),
  sqft: [...numberNounRules(SQFT), ...nounNumberRules('sqft')],
  rent: [...nounNumberRules(RENT, String.raw`\$\s?`), ...nounNumberRules(RENT)],
  floor: FLOOR_RULES,
} as const;

function firstRange(question: string, rules: readonly Rule[]): IntRange | undefined {
  for (const { re, bound } of rules) {
    const m = question.match(re);
    if (m) return bound(toNum(m.slice(1).find((g) => g !== undefined)!));
  }
  return undefined;
}

export const parseBedroomRange = (q: string) => firstRange(q, RULES.bedrooms);
export const parseBathroomRange = (q: string) => firstRange(q, RULES.bathrooms);

export function parseSqftBounds(q: string): { sqftMin?: number; sqftMax?: number } {
  const r = firstRange(q, RULES.sqft);
  return { sqftMin: r?.min, sqftMax: r?.max };
}
export function parseRentBounds(q: string): { rentMin?: number; rentMax?: number } {
  const r = firstRange(q, RULES.rent);
  return { rentMin: r?.min, rentMax: r?.max };
}
export function parseFloorBounds(q: string): { floorMin?: number; floorMax?: number } {
  const r = firstRange(q, RULES.floor);
  return { floorMin: r?.min, floorMax: r?.max };
}

/** Every phrase some comparator rule reads, for the closed-world word check. */
export const COMPARATOR_PHRASES: readonly RegExp[] = Object.values(RULES)
  .flat()
  .map(({ re }) => new RegExp(re.source, 'gi'));
