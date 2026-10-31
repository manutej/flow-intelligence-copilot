/**
 * Panel guards: question shapes the engine answers with a different question's number.
 * Each returns the reason nothing is charted, or null. They run before any chart is picked.
 * (A currency other than USD is not a guard: it is routed to the currency tool, see currency.ts.)
 * - two measures joined in one question ("vacancy and renewal rate"): one answer would drop one;
 * - a building name one or two edits from a real one ("fulton yrds"): unknown building, nearest named.
 */
import type { PortfolioStore } from '../data/schema.ts';
import type { ParsedQueryIntent } from '../agent/intent.ts';
import { editDistance } from '../util/suggest.ts';

/** Measure nouns, one family each; a family is one measure the engine answers on its own. */
const FAMILIES: ReadonlyArray<readonly [string, RegExp]> = [
  ['vacancy', /\bvacan(?:cy|cies|t\s+units?)(?:\s+rates?)?\b/gi],
  ['occupancy', /\boccupancy(?:\s+rates?)?\b/gi],
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
/** Measures that are themselves two figures; the engine answers both (cost per lead and per
 * tour is not one: its panel shows cost per lead only, so it is asked for separately). */
const COMPOUND = new Set(['avg_market_rent_and_sqft', 'new_vs_renewal_and_concession', 'ending_and_renewed', 'spend_h1_vs_q3', 'void_and_duplicate_counts', 'applied_and_leased', 'reallocation_leases']);
export function twoMeasureGuard(q: string, intent: ParsedQueryIntent | null): string | null {
  if (intent && COMPOUND.has(intent.measure)) return null;
  // a source named in the question ("Rent.", "Apartments.com") and a filter on a measure
  // ("units with sqft >= 1200") are not measures asked for
  for (const src of intent?.mentionedSources ?? []) q = q.split(src).join(' ');
  q = q.replace(/\b(?:with|of|over|under|above|below|at\s+least|at\s+most)\s+(?:sq\.?\s*ft|sqft|square\s+f(?:oo|ee)t(?:age)?)\s*(?:[<>]=?|≥|≤|of|over|under|above|below|at)/gi, ' ');
  // every measure noun, longest first; a shorter match inside a longer one is the same mention
  const all: Array<{ fam: string; s: number; e: number }> = [];
  for (const [fam, re] of FAMILIES) for (const m of q.matchAll(re)) all.push({ fam, s: m.index!, e: m.index! + m[0].length });
  all.sort((a, b) => (b.e - b.s) - (a.e - a.s) || a.s - b.s);
  const kept: typeof all = [];
  for (const h of all) if (!kept.some((k) => h.s < k.e && k.s < h.e)) kept.push(h);
  // two or more distinct measures anywhere in the question, however they are joined
  const fams = [...new Set(kept.sort((a, b) => a.s - b.s).map((h) => h.fam))];
  if (fams.length >= 2)
    return `The question asks for two measures (${fams.slice(0, -1).join(', ')} and ${fams[fams.length - 1]}). One panel answers one measure, so nothing is charted rather than dropping one; ask for each separately.`;
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
    // the full name stated exactly names the building; a shorter alias stated exactly ("Marlowe")
    // only covers its own words, so a misspelt full name around it still counts
    if (exact(norm(p.name))) continue;
    for (const [ci, cand] of names.entries()) {
      if (cand.length < (cand.includes(' ') ? 5 : 6)) continue;
      const k = cand.split(' ').length;
      const limit = Math.max(1, Math.floor(cand.length / 5));
      for (let i = 0; i + k <= words.length; i++) {
        const span = words.slice(i, i + k).join(' ');
        if (known.has(span)) continue;
        const d = editDistance(span, cand);
        // an alias is shown with the building it names: "Logan Lofts (Kedzie Works)"
        const shown = ci === 0 ? p.name : `${(p as { aka?: readonly string[] }).aka![ci - 1]} (${p.name})`;
        if (d > 0 && d <= limit && span[0] === cand[0] && (!best || d < best.d)) best = { span, name: shown, d };
      }
    }
  }
  return best ? `"${best.span}" is not a building FlowIQ knows. The nearest name is ${best.name}; ask again with that name if it is the one you meant.` : null;
}
