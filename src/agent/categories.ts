/**
 * Term categories detected by kind rather than by spelling. Each detector is
 * built from a table that defines the category (ISO 4217 via Intl, Unicode
 * currency symbols, number words composed from their parts, period units)
 * over text whose hyphen, dash and space variants are folded to one space,
 * so "end-of-year", "end of year" and "end‑of‑year" are one form.
 */

/** NFKC, straight apostrophes, every dash/hyphen/underscore run and whitespace run to one space. */
export function foldSeparators(text: string): string {
  return text.normalize('NFKC').replace(/[\u2018\u2019\u02BC]/g, "'").replace(/[\p{Pd}_]+/gu, ' ').replace(/\s+/g, ' ');
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The ISO 4217 code table the runtime ships (Intl), with the reporting currency set apart. */
const ISO_CODES: ReadonlySet<string> = new Set(Intl.supportedValuesOf('currency'));
const REPORTING = 'USD';

interface CurrencyLexicon { heads: Set<string>; qualifiers: Set<string>; symbols: Set<string>; letterSymbols: Set<string> }
let LEXICON: CurrencyLexicon | undefined;
/** Currency nouns, qualifiers and symbols, all derived from the ISO table through Intl. */
function lexicon(): CurrencyLexicon {
  if (LEXICON) return LEXICON;
  const names = new Intl.DisplayNames(['en'], { type: 'currency' });
  const heads = new Set<string>(); const qualifiers = new Set<string>(); const symbols = new Set<string>(); const letterSymbols = new Set<string>();
  for (const code of ISO_CODES) {
    const name = names.of(code);
    if (name && !/^[A-Z]{3}$/.test(name) && !/\(|\bunit\b|\bfund\b|\bcode\b|\bgold\b|\bsilver\b|\bplatinum\b|\bpalladium\b|\bspecial\b|\btesting\b|\bunknown\b/i.test(name)) {
      const words = name.toLowerCase().split(/\s+/);
      const head = words[words.length - 1];
      heads.add(head);
      if (code !== REPORTING) for (const w of words.slice(0, -1)) if (w.length > 2) qualifiers.add(w);
    }
    if (code === REPORTING) continue;
    for (const display of ['symbol', 'narrowSymbol'] as const) {
      const sym = new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay: display }).formatToParts(1).find((p) => p.type === 'currency')?.value;
      if (!sym || sym === code || sym === '$' || sym === 'US$') continue;
      (/^\p{L}+\.?$/u.test(sym) ? letterSymbols : symbols).add(sym);
    }
  }
  LEXICON = { heads, qualifiers, symbols, letterSymbols };
  return LEXICON;
}

const plural = (w: string) => `${escape(w)}(?:e?s)?`;
/** A money noun a currency qualifier can govern ("Canadian funds", "Mexican pesos"). */
const MONEY_NOUN = String.raw`(?:funds?|money|currency|cash|terms|dollars?)`;
/** Where a word reads as the unit of an answer ("in X", "into X", "as X", "to X"), closing the clause. */
const UNIT_SLOT_BEFORE = String.raw`(?:\bin|\binto|\bas|\bto|\bper)\s+(?:the\s+)?`;
const UNIT_SLOT_AFTER = String.raw`(?=\s*(?:[?.!,;:)]|please\b|only\b|terms\b|instead\b|$))`;

/**
 * A currency other than the reporting one, anywhere in the question:
 * an upper-case ISO code, a non-dollar Unicode currency symbol (\p{Sc}) or
 * a letter-prefixed dollar ("C$", "HK$"), a currency qualifier with a money
 * noun ("Indian rupees", "Canadian funds"), or, in the unit slot of the
 * question ("in sek?", "in rupees", "in kr"), a lower-case code, a
 * currency noun or a letter symbol. Returns the matched text.
 */
export function foreignCurrency(question: string, isDomainTerm: (w: string) => boolean): string | null {
  const q = foldSeparators(question);
  const { heads, qualifiers, symbols, letterSymbols } = lexicon();
  for (const m of q.matchAll(/(?<![\p{L}\p{N}])\p{Lu}{3}(?![\p{L}\p{N}])/gu)) {
    if (m[0] !== REPORTING && ISO_CODES.has(m[0]) && !isDomainTerm(m[0])) return m[0];
  }
  for (const m of q.matchAll(/(?<!\p{L})(\p{L}{1,3})?(\p{Sc})/gu)) {
    const [t, prefix, sym] = m;
    if (sym === '$' && (!prefix || /^us$/i.test(prefix))) continue;
    return t;
  }
  for (const s of symbols) if (q.includes(s)) return s;
  const qual = [...qualifiers].map(escape).join('|');
  const head = [...heads].filter((h) => h !== 'dollar').map(plural).join('|');
  const named = new RegExp(String.raw`\b(?:${qual})\s+(?:(?:${head})|${MONEY_NOUN})\b`, 'iu').exec(q);
  if (named) return named[0];
  const lowerCodes = [...ISO_CODES].filter((c) => c !== REPORTING).map((c) => c.toLowerCase()).join('|');
  const letters = [...letterSymbols].map(escape).join('|');
  const slot = new RegExp(String.raw`${UNIT_SLOT_BEFORE}((?:${lowerCodes})|(?:${head})|(?:${letters}))${UNIT_SLOT_AFTER}`, 'iu').exec(q);
  if (slot && !isDomainTerm(slot[1])) return slot[1];
  return null;
}

/** Units a period can be named by, including quarter and half labels and month names. */
const PERIOD_UNIT = String.raw`(?:fiscal\s+)?(?:years?|yrs?|quarters?|qtrs?|q[1-4]|months?|weeks?|days?|periods?|fy|halves|half|h[12]|jan(?:uary)?|feb(?:ruary)?|march|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
/** Words that pick one point out of a period. */
const PERIOD_POINT = String.raw`(?:end(?:ing)?|close|closing|start|beginning|open(?:ing)?|last\s+day|first\s+day)`;
/**
 * A point in time at an edge of a period: "<unit>['s] end|close|start",
 * "<point> of [the] <unit>", or the EOx, BOx, YE and QE abbreviations.
 */
export const PERIOD_POINT_RE = new RegExp(String.raw`\b${PERIOD_UNIT}(?:'s)?\s+(?:end(?:ing)?|close|closing|start)\b|\b${PERIOD_POINT}\s+of\s+(?:the\s+|this\s+|that\s+)?${PERIOD_UNIT}\b|\b(?:eo|bo)[ymqwd]\b|\b[yq]e\b`, 'i');
export function periodPoint(question: string): string | null {
  return PERIOD_POINT_RE.exec(foldSeparators(question))?.[0] ?? null;
}

/**
 * A period that runs to "now": an extent preposition with a now-deixis
 * ("to date", "up to now", "till today", "as of the present"), "so/thus
 * far", or the *TD abbreviations (y.t.d, fytd, wtd).
 */
const TO_DATE_RE = /(?<![\p{L}\p{N}])f?[ymqwd]\.?\s?t\.?\s?d\.?(?![\p{L}\p{N}])|\b(?:to|till|til|until|up\s+to|upto|up\s+until|through|thru|as\s+of)\s+(?:date|now|today|present|the\s+present|this\s+point|the\s+moment)\b|\b(?:so|thus)\s+far\b/iu;
export function toDatePeriod(question: string): string | null {
  return TO_DATE_RE.exec(foldSeparators(question))?.[0] ?? null;
}

/** Number words composed from their parts (one…nineteen, twenty…ninety, twenty four), plus a/an/half. */
const ONES = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
export const NUMBER_WORD = String.raw`(?:\d+|a|an|half|(?:${TENS.join('|')})(?:[\s-]?(?:${ONES.join('|')}))?|${TEENS.join('|')}|${ONES.join('|')})`;
