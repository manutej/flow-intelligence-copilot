/**
 * Fiscal periods. The exports carry calendar months only, so a fiscal period
 * cannot be mapped to a window, and a question that names one is never
 * answered, whatever calendar words sit beside it ("Q3 FY2026" is fiscal Q3).
 * A fiscal period, in any order: FY/F.Y./F/Y with a year, TD, quarter or half
 * (FY2026, FY 26, F/Y 2026, FY-Q3, FYTD); "fiscal" with a period word or year,
 * an ordinal quarter either side ("fiscal third quarter", "third fiscal
 * quarter"), or a period right before it ("Q3 2026 fiscal", "2026 Q3
 * (fiscal)"); and "financial year". The bare adjective ("fiscal impact",
 * "Fiscally, ...") is not a period, and bare "FY" is left to the resolver.
 */
const SEP = String.raw`[\s.\-'’/_—]*`;
const FY = String.raw`(?<![\p{L}\p{N}])f${SEP}y\.?`;
const FY_PERIOD = String.raw`(?:(?:19|20)?\d{2}(?!\d)|td\b|q[1-4]\b|h[12]\b)`;
const ORDINAL = String.raw`(?:first|second|third|fourth|1st|2nd|3rd|4th)`;
const FISCAL = String.raw`\bfiscal(?:ly)?`;
const FISCAL_PERIOD = String.raw`(?:${ORDINAL}${SEP})?(?:years?|yrs?|quarters?|q[1-4]|halfs?|halves|h[12]|periods?|months?|ytd|(?:19|20)\d{2}|'\d{2})\b`;
const PERIOD_WORD = String.raw`(?:q[1-4]|h[12]|(?:19|20)\d{2}|'\d{2})`;
// A token swallows the period words that qualify it (FY2026 Q3, fiscal year 2026).
const TAIL = String.raw`(?:${SEP}(?:q[1-4]|h[12]|(?:19|20)\d{2}|'\d{2})\b)*`;
export const FISCAL_TOKEN_RE = new RegExp(
  String.raw`(?:${FY}${SEP}${FY_PERIOD}|${FISCAL}${SEP}${FISCAL_PERIOD}|\b${ORDINAL}${SEP}fiscal${SEP}(?:years?|quarters?|halfs?|halves)\b|\b${PERIOD_WORD}${SEP}[(\[]?\s*fiscal(?:ly)?\b|\bfinancial[\s-]+years?\b)${TAIL}`,
  'iu',
);

/** The bare adjective "fiscal": it gives way to a calendar period the question states. */
export const BARE_FISCAL_RE = /\bfiscal(?:ly)?\b/i;

/** "CY2026", "calendar year 2026", "calendar 26": the calendar year, as a bare year the date parser reads. */
export function spellCalendarYear(text: string): string {
  return text.replace(/(?<![\p{L}\p{N}])(?:calendar(?:[\s\-]+year)?|c\.?y\.?)[\s\-'’]*((?:19|20)?\d{2})(?!\d)/giu, (_m, y: string) => ` in ${y.length === 2 ? `20${y}` : y}`);
}

/** An explicit calendar period: a year, a month name, Qn, or a relative period. */
export const CALENDAR_PERIOD_RE =
  /\b(?:19|20)\d{2}\b|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|\bq[1-4]\b|\b(?:last|this|next|past|previous|prior)\s+(?:\d+\s+)?(?:months?|quarters?|years?|weeks?)\b|\bytd\b|\byear[\s-]+to[\s-]+date\b/i;

/** "FY" with no period: a property only after at/for/in ("spend at FY"). */
export const LOCATIVE_FY_RE = /\bat\s+(?:the\s+)?f\.?y\.?(?![\p{L}\p{N}])/iu;
/** Match on NFKC text: any run of spaces, punctuation or symbols may split the letters. */
export const BARE_FY_RE = /(?<![\p{L}\p{N}])f[\s\p{P}\p{S}_]*y\.?(?![\p{L}\p{N}])(?!(?!['’]s\b)[\p{P}\p{S}]?\p{L})/iu;

const FISCAL_TOKEN_GLOBAL = new RegExp(FISCAL_TOKEN_RE.source, 'giu');

/** True when the label is itself a fiscal token ("FY"). */
export function isFiscalToken(label: string): boolean {
  const m = FISCAL_TOKEN_RE.exec(label.trim());
  return m !== null && m[0].length === label.trim().length;
}

/** The text with every fiscal token blanked, so no alias can bind to one. */
export function maskFiscalTokens(text: string): string {
  return text.replace(FISCAL_TOKEN_GLOBAL, (m) => ' '.repeat(m.length));
}

/** The text with every non-locative bare "FY" blanked: only "at FY" names a property. */
export function maskNonLocativeFy(text: string): string {
  return text.replace(/(\bat\s+(?:the\s+)?)?((?<![\p{L}\p{N}])f\.?y\.?(?![\p{L}\p{N}]))/giu, (m, loc: string | undefined, fy: string) => (loc ? m : ' '.repeat(fy.length)));
}
