/**
 * Fiscal-period tokens. The exports carry calendar months only, so a fiscal
 * period cannot be mapped to a window. A fiscal token takes precedence over
 * an entity alias that spells the same letters: "FY" is never Fulton Yards.
 * Matched in any punctuation: FY2026, FY 2026, FY-2026, FY'26, F.Y. 2026,
 * FYTD, fiscal, financial year.
 */
export const FISCAL_TOKEN_RE = /(?<![\p{L}\p{N}.])f\.?y\.?(?:td\b)?(?!\p{L})|\bfiscal(?:ly)?\b|\bfinancial[\s-]+years?\b/iu;

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
