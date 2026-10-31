/**
 * Panel guards: question shapes the engine answers with a different question's number.
 * Each returns the reason nothing is charted, or null. They run before any chart is picked.
 * - a billing-currency filter or display currency other than USD ("billed in CAD"): spend is
 *   reported in USD with CAD converted at the policy rate, and there is no per-currency answer;
 * - two measures joined in one question ("vacancy and renewal rate"): one answer would drop one;
 * - a building name one or two edits from a real one ("fulton yrds"): unknown building, nearest named.
 */
import type { PortfolioStore } from '../data/schema.ts';
import type { ParsedQueryIntent } from '../agent/intent.ts';
import { editDistance } from '../util/suggest.ts';

const CURRENCY = /\b(?:in|billed\s+in|paid\s+in|invoiced\s+in|denominated\s+in|converted\s+to)\s+(?:CAD|EUR|GBP|MXN|C\$|canadian\s+dollars?|euros?|pounds(?:\s+sterling)?|pesos?)(?![\p{L}])|\b(?:CAD|EUR|GBP|MXN)[-\s](?:billed|invoiced|denominated)\b/iu;
export function currencyGuard(q: string): string | null {
  const m = CURRENCY.exec(q);
  return m ? `The question asks for "${m[0].trim()}". FlowIQ reports spend in USD only (CAD invoices converted at the policy rate) and has no figure filtered by or shown in another currency, so nothing is charted.` : null;
}

/** Measure nouns, one family each; a family is one measure the engine answers on its own. */
const FAMILIES: ReadonlyArray<readonly [string, RegExp]> = [
  ['vacancy', /\bvacan(?:cy|cies|t\s+units?)\b/gi],
  ['occupancy', /\boccupancy\b/gi],
  ['renewal rate', /\brenewal\s+rates?\b/gi],
  ['market rent', /\b(?:market\s+|average\s+)?rents?\b(?!\s+(?:per|psf|roll))/gi],
  ['square footage', /\bsquare\s+f(?:oo|ee)t(?:age)?\b|\bsq\.?\s*ft\b|\bsqft\b/gi],
  ['concessions', /\bconcessions?\b/gi],
  ['cost per lead', /\bcost\s+per\s+lead\b|\bcpl\b/gi],
  ['cost per tour', /\bcost\s+per\s+tour\b|\bcpt\b|(?<=\bcost\s+per\s+lead\s+(?:and|&)\s+(?:per\s+)?)tours?\b/gi],
  ['cost per signed lease', /\bcost\s+per\s+(?:signed\s+)?lease\b|\bcpsl\b/gi],
  ['marketing spend', /\b(?:marketing\s+)?spend\b/gi],
  ['lead count', /\b(?:number\s+of\s+|how\s+many\s+)?leads\b/gi],
  ['tours', /\btours\b/gi],
  ['applications', /\bapplications\b/gi],
];
/** Measures that are themselves two figures; the engine answers both. */
const COMPOUND = new Set(['avg_market_rent_and_sqft', 'new_vs_renewal_and_concession', 'ending_and_renewed', 'spend_h1_vs_q3', 'cost_per_lead_and_tour', 'applied_and_leased', 'reallocation_leases']);
export function twoMeasureGuard(q: string, intent: ParsedQueryIntent | null): string | null {
  if (intent && COMPOUND.has(intent.measure)) return null;
  const hits: Array<{ fam: string; s: number; e: number }> = [];
  for (const [fam, re] of FAMILIES) for (const m of q.matchAll(re)) hits.push({ fam, s: m.index!, e: m.index! + m[0].length });
  hits.sort((a, b) => a.s - b.s);
  for (let i = 0; i + 1 < hits.length; i++) {
    const a = hits[i], b = hits[i + 1];
    if (a.fam === b.fam || b.s < a.e) continue;
    const gap = q.slice(a.e, b.s);
    if (gap.length <= 24 && /^[\s,]*(?:,|&|\band\b|\bplus\b|\bas\s+well\s+as\b)[\s\w-]*$/i.test(gap))
      return `The question asks for two measures (${a.fam} and ${b.fam}). One panel answers one measure, so nothing is charted rather than dropping one; ask for each separately.`;
  }
  return null;
}

const norm = (x: string) => x.toLowerCase().replace(/&/g, 'and').replace(/^the\s+/, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
/** A building name a few edits from a real one, where the question does not also name it exactly. */
export function misspeltBuildingGuard(q: string, store: PortfolioStore): string | null {
  const nq = norm(q), words = nq.split(' ');
  // other names FlowIQ knows (systems, listing sources) are never read as a misspelt building
  const known = new Set([...store.properties.map((p) => (p as { pms?: string }).pms ?? ''), ...store.paidSources, ...store.organicSources, 'yardi', 'realpage', 'entrata', 'appfolio'].map((x) => norm(String(x))));
  const exact = (c: string) => new RegExp(`(?:^| )${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: |$)`).test(nq);
  let best: { span: string; name: string; d: number } | null = null;
  for (const p of store.properties) {
    const names = [p.name, ...((p as { aka?: readonly string[] }).aka ?? [])].map(norm);
    if (names.some(exact)) continue;
    for (const cand of [p.name, ...((p as { aka?: readonly string[] }).aka ?? [])].map(norm).filter((c) => c.length >= (c.includes(' ') ? 5 : 6))) {
      const k = cand.split(' ').length;
      const limit = Math.max(1, Math.floor(cand.length / 5));
      for (let i = 0; i + k <= words.length; i++) {
        const span = words.slice(i, i + k).join(' ');
        if (known.has(span)) continue;
        const d = editDistance(span, cand);
        if (d > 0 && d <= limit && span[0] === cand[0] && (!best || d < best.d)) best = { span, name: p.name, d };
      }
    }
  }
  return best ? `"${best.span}" is not a building FlowIQ knows. The nearest name is ${best.name}; ask again with that name if it is the one you meant.` : null;
}
