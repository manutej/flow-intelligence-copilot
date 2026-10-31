/**
 * Fiscal-period tokens. The exports carry calendar months only, so a fiscal
 * period cannot be mapped to a window. Only a token that names a period is
 * fiscal: FY/F.Y./F/Y with a year, TD, quarter or half (FY2026, FY 26,
 * F/Y 2026, FY-Q3, FYTD), "fiscal" with a period word or year, and
 * "financial year". Bare "fiscal" (fiscal impact) and bare "FY" are not
 * periods; bare FY stays free to name Fulton Yards.
 */
const SEP = String.raw`[\s.\-'’/_—]*`;
const FY = String.raw`(?<![\p{L}\p{N}])f${SEP}y\.?`;
const FY_PERIOD = String.raw`(?:(?:19|20)?\d{2}(?!\d)|td\b|q[1-4]\b|h[12]\b)`;
const FISCAL_PERIOD = String.raw`(?:years?|yrs?|quarters?|q[1-4]|halfs?|halves|h[12]|periods?|months?|ytd|(?:19|20)\d{2}|'\d{2})\b`;
// A token swallows the period words that qualify it (FY2026 Q3, fiscal year 2026).
const TAIL = String.raw`(?:${SEP}(?:q[1-4]|h[12]|(?:19|20)\d{2}|'\d{2})\b)*`;
export const FISCAL_TOKEN_RE = new RegExp(
  String.raw`(?:${FY}${SEP}${FY_PERIOD}|\bfiscal(?:ly)?${SEP}${FISCAL_PERIOD}|\bfinancial[\s-]+years?\b)${TAIL}`,
  'iu',
);

/** The bare word "fiscal": a fiscal reading only when no calendar period is stated. */
export const BARE_FISCAL_RE = /\bfiscal(?:ly)?\b/i;

/** An explicit calendar period: a year, a month name, Qn, or a relative period. */
export const CALENDAR_PERIOD_RE =
  /\b(?:19|20)\d{2}\b|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|\bq[1-4]\b|\b(?:last|this|next|past|previous|prior)\s+(?:\d+\s+)?(?:months?|quarters?|years?|weeks?)\b|\bytd\b|\byear[\s-]+to[\s-]+date\b/i;

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
