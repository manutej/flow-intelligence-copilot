/**
 * One number lexicon for every numeric field (S1R F-089). Cardinals and
 * ordinals are read as digits ("3", "3rd") or words ("three", "third",
 * "twenty-first") up to 99, and parse to the same integer. Comparators and
 * the binding check both build on these patterns, so no field has its own
 * list of number words.
 */
const UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const ORD_UNITS = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth'];
const ORD_TEENS = ['tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth'];
const ORD_TENS = ['', '', 'twentieth', 'thirtieth', 'fortieth', 'fiftieth', 'sixtieth', 'seventieth', 'eightieth', 'ninetieth'];

const WORD_VALUE = new Map<string, number>();
const ORDINAL_VALUE = new Map<string, number>();
UNITS.forEach((w, i) => WORD_VALUE.set(w, i));
TEENS.forEach((w, i) => WORD_VALUE.set(w, 10 + i));
ORD_UNITS.forEach((w, i) => ORDINAL_VALUE.set(w, i));
ORD_TEENS.forEach((w, i) => ORDINAL_VALUE.set(w, 10 + i));
for (let t = 2; t < 10; t++) {
  WORD_VALUE.set(TENS[t], t * 10);
  ORDINAL_VALUE.set(ORD_TENS[t], t * 10);
}

const alt = (xs: string[]) => xs.filter(Boolean).sort((a, b) => b.length - a.length).join('|');
const TENS_ALT = alt(TENS);
/** A bare tens word, which may head a compound ("twenty-first"). */
export const TENS_WORD = `(?:${TENS_ALT})`;
const UNIT_ALT = alt(UNITS.slice(1));
/** A cardinal word, longest first: "twenty-one", "twelve", "two". */
export const CARDINAL_WORD = String.raw`(?:(?:${TENS_ALT})(?:[-\s](?:${UNIT_ALT})\b|(?![-\s](?:${UNIT_ALT}|${alt(ORD_UNITS.slice(1))})\b))|${alt(TEENS)}|${alt(UNITS)})\b`;
/** An ordinal word: "twenty-first", "twelfth", "third". */
export const ORDINAL_WORD = String.raw`(?:(?:${TENS_ALT})[-\s](?:${alt(ORD_UNITS.slice(1))})|${alt(ORD_TENS)}|${alt(ORD_TEENS)}|${alt(ORD_UNITS)})\b`;
/** Digits or a cardinal word. */
export const CARDINAL = String.raw`(?:\d[\d,]*(?:\.\d+)?|${CARDINAL_WORD})`;
/** Digits with an optional ordinal suffix, or an ordinal word. */
export const ORDINAL = String.raw`(?:\d{1,3}(?:st|nd|rd|th)?\b|${ORDINAL_WORD})`;

/** The integer a digit string, cardinal word or ordinal word stands for; NaN otherwise. */
export function parseNumber(raw: string): number {
  const w = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (/^\d/.test(w)) return Number.parseFloat(w.replace(/,/g, '').replace(/(?:st|nd|rd|th)$/, ''));
  const one = WORD_VALUE.get(w) ?? ORDINAL_VALUE.get(w);
  if (one !== undefined) return one;
  const [tens, unit] = w.split(/[-\s]/);
  const t = WORD_VALUE.get(tens);
  const u = WORD_VALUE.get(unit) ?? ORDINAL_VALUE.get(unit);
  return t !== undefined && t >= 20 && t % 10 === 0 && u !== undefined && u > 0 && u < 10 ? t + u : Number.NaN;
}
