/**
 * Currency asks, read structurally: an ISO 4217 code (any code Intl knows), a currency symbol
 * (\p{Sc}, with a country prefix such as C$ or CA$), or a currency's English name from
 * Intl.DisplayNames ("Canadian dollar", "euro"). USD, US$ and a bare $ are the reporting
 * currency and are not an ask. A CAD *rate* setting ("CAD rate of 0.73", "1 CAD = 0.73 USD",
 * "after CAD rate conversion") is a setting, read elsewhere, and is not an ask.
 * mode 'filter': "billed / invoiced / paid in CAD", "CAD-billed", "CAD invoices": rows whose
 * currency column is that code. mode 'convert': anything else ("in CAD", "(CAD)", "CAD spend").
 */
export interface CurrencyAsk { readonly code: string; readonly surface: string; readonly mode: 'filter' | 'convert' }

const CODES: readonly string[] = (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('currency');
const CODE_SET = new Set(CODES);
const names = new Intl.DisplayNames(['en'], { type: 'currency' });
const symbolOf = (c: string, display: 'symbol' | 'narrowSymbol') => {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency: c, currencyDisplay: display }).formatToParts(1).find((p) => p.type === 'currency')?.value ?? ''; } catch { return ''; }
};
/** symbol → code, for symbols that name one currency (CA$, €, £, ¥ → JPY, MX$ ...) */
const SYMBOL = new Map<string, string>();
for (const c of CODES) { const s = symbolOf(c, 'symbol'); if (s && s !== c && !SYMBOL.has(s)) SYMBOL.set(s, c); }
SYMBOL.set('$', 'USD'); SYMBOL.set('US$', 'USD');
/** lower-case English names, longest first (canadian dollar → CAD) */
const NAMES = CODES.map((c) => [String(names.of(c) ?? '').toLowerCase(), c] as const).filter(([n, c]) => n && n !== c.toLowerCase()).sort((a, b) => b[0].length - a[0].length);

const SETTING = /\b[A-Z]{3}\s*(?:-\s*)?(?:to\s*-?\s*USD\s+)?(?:rate|conversion|exchange\s+rate|fx\s+rate)\b|\b\d[\d.,]*\s*[A-Z]{3}\s*=\s*\$?[\d.,]+\s*(?:USD)?|\b[A-Z]{3}\s+converted\s+at\b|\bconverted\s+at\s+[\d.,]+/g;
const FILTER_BEFORE = /\b(?:billed|invoiced|paid|charged|denominated)\s+in\s+$/i;
const FILTER_AFTER = /^[-\s]*(?:billed|invoiced|denominated|invoices?|bills?|rows?)\b/i;
/** a currency position: "in / into / to / as / , / ( CODE", or "CODE spend / amounts / ) / please / -billed" or the end */
const CODE_BEFORE = /(?:\b(?:in|into|to|as)|[,(])\s*$/i;
const CODE_AFTER = /^(?:\s*(?:\)|[?.!]|$)|[-\s]+(?:marketing\s+)?(?:spend|spending|amounts?|figures?|totals?|terms|please|billed|invoiced|denominated|invoices?|bills?|rows?|dollars?|equivalent|value)\b)/i;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function currencyAsk(question: string): CurrencyAsk | null {
  const q = question.replace(SETTING, (m) => ' '.repeat(m.length));
  const hits: Array<{ code: string; s: number; e: number }> = [];
  // a bare code counts in a currency position only, so an acronym that happens to be a code
  // ("IRR for Granite Park", "ALL buildings") is not read as one
  for (const m of q.matchAll(/(?<![\p{L}\p{N}])([A-Z]{3})(?![\p{L}\p{N}])/gu)) {
    if (!CODE_SET.has(m[1])) continue;
    const before = q.slice(0, m.index!), after = q.slice(m.index! + 3);
    if (CODE_BEFORE.test(before) || CODE_AFTER.test(after)) hits.push({ code: m[1], s: m.index!, e: m.index! + 3 });
  }
  for (const m of q.matchAll(/([A-Z]{1,3})?(\p{Sc})/gu)) {
    const [all, pre = '', sym] = m;
    const code = SYMBOL.get(pre + sym) ?? (pre ? CODES.find((c) => c.startsWith(pre) && symbolOf(c, 'narrowSymbol') === sym) : SYMBOL.get(sym)) ?? null;
    if (code) hits.push({ code, s: m.index!, e: m.index! + all.length });
    else hits.push({ code: `${pre}${sym}`, s: m.index!, e: m.index! + all.length }); // a symbol we cannot place is still an ask
  }
  const lower = q.toLowerCase().replace(/-/g, ' ');
  for (const [n, c] of NAMES) for (const m of lower.matchAll(new RegExp(`(?<![\\p{L}])${esc(n)}s?(?![\\p{L}])`, 'gu'))) hits.push({ code: c, s: m.index!, e: m.index! + m[0].length });
  const ask = hits.filter((h) => h.code !== 'USD').sort((a, b) => a.s - b.s)[0];
  if (!ask) return null;
  const surface = question.slice(ask.s, ask.e);
  const filter = FILTER_BEFORE.test(q.slice(0, ask.s)) || FILTER_AFTER.test(q.slice(ask.e));
  return { code: ask.code, surface, mode: filter ? 'filter' : 'convert' };
}

/** The question with the currency ask removed, so the engine answers the USD question beneath it. */
export function withoutCurrency(question: string, ask: CurrencyAsk): string {
  const s = esc(ask.surface);
  return question
    .replace(new RegExp(`\\b(?:billed|invoiced|paid|charged|denominated|expressed|shown|converted|reported)?\\s*(?:in|into|to)\\s+${s}(?:\\s*(?:please|terms))?`, 'i'), '')
    .replace(new RegExp(`\\(\\s*${s}\\s*\\)`), '')
    .replace(new RegExp(`,?\\s*${s}\\s+please`, 'i'), '')
    .replace(new RegExp(`${s}[-\\s]*(?:billed|invoiced|denominated)?\\s*`), '')
    .replace(/\s+([?.,!])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}
