import type { PortfolioStore } from '../data/schema.ts';
import { AMENITY_SYNONYMS } from '../domain/resolver.ts';

/**
 * Closed-world reading of a unit question. A unit count is only the answer
 * when every word of the question is understood: either it sits inside a
 * phrase some filter parses, it names something in the store, or it is
 * structure (a count cue, a unit noun, a function word). Whatever is left
 * over is a condition no filter applies, so the count would be of the
 * wrong set. The caller answers unknown instead.
 */

// Phrases the unit filters parse (intent.ts parse* functions). Removing them
// first means a word like "over" is understood only where a filter reads it.
const FILTER_PHRASES: readonly RegExp[] = [
  /\bat\s+(?:least|most)\s+(?=\d+(?:\.5)?\s*(?:bed|bath|br|ba))/gi,
  /\b(?:open|available)\s+(?=(?:studio\s+)?(?:units?|apartments?|studios?|\d?br\b))/gi,
  /\b(?:with\s+)?view\s*[=:]?\s*['"`]?none['"`]?/gi,
  /\b(?:\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten)(?:\.5)?[-\s]*(?:bed(?:room)?s?|brs?|bdrms?|bds?|bath(?:room)?s?|bas?)\b/gi,
  /\b(?:one|two)[-\s]and[-\s]a[-\s]half\s+bath(?:room)?s?\b/gi,
  /\b(?:bed|bath)rooms?(?:_wanted)?\s*[=:]\s*\d+(?:\.\d+)?/gi,
  /\b\d+(?:br|ba)\b/gi,
  /\bstudios?(?:[-\s](?:seekers?|units?|apartments?))?\b/gi,
  /\bsqft\s*(?:>=|≥|<=|≤|at\s+least|at\s+most|over|above|under|below)\s*\d{3,5}\b/gi,
  /\b(?:at\s+least|at\s+most|over|under|below|minimum\s+of)\s*\d{3,5}\s*(?:sq\.?\s*ft\.?|square\s+feet|sqft)/gi,
  /\bfloors?\s+\d{1,3}\s+(?:or\s+(?:higher|above|up|lower|below)|and\s+(?:above|higher|up)|\+)/gi,
  /\bon\s+floor\s+\d{1,3}\b/gi,
  /\b(?:with\s+(?:a\s+)?)?[a-z]+[\s-]+views?\b|\bview\s*[=:]\s*['"`]?\w+['"`]?|\bno[-\s]view\b|\bwith\s+no\s+view\b/gi,
  /\bstatus\s*=\s*['"`]?\w+['"`]?/gi,
  /\b(?:on|in)\s+notice(?:\s+status)?\b|\bnotice\s+(?:status|units?)\b|\b(?:gave|given)\s+notice(?:\s+to\s+(?:vacate|move\s+out))?\b/gi,
  /\bclass[\s-]+[a-c][+-]?(?![a-z0-9])/gi,
  /\b(?:built\s+before|pre-)\s*\d{4}\b|\bbuilt\s+(?:in\s+)?\d{4}(?:\s+or\s+(?:later|after|newer))?\b/gi,
  /\b(?:top|first)\s+(?:\d+|two|three|four|five)\b/gi,
  /\bP\d{2,3}\b/gi,
  // Building amenities, as the property resolver reads them.
  ...AMENITY_SYNONYMS.flatMap((a) => a.patterns.map((p) => new RegExp(p.source, 'gi'))),
  /\bover\s+(?=at\b)/gi,
];

// Status words parseUnitStatusFilter maps onto the units.status column.
const STATUS_WORDS = ['vacant', 'vacancy', 'vacancies', 'unoccupied', 'empty', 'occupied'];

// downtown: a region the property resolver maps to neighborhoods.
// Count cues, unit nouns, scope words and function words: structure, not conditions.
const STRUCTURE_WORDS = `
  how many much number count counts total totals list show give tell me please what which whats
  is are was were be been there do does did have has had it its they them their this that these those
  of in at on for to from with by across among within inside per each every all any our we us you your
  the a an and or currently right now today still as same
  unit units apartment apartments apt apts home homes flat flats residence residences
  building buildings property properties portfolio site sites community communities complex
  operating whole entire overall exist exists existing sit sits sitting located contain contains
  one ones both from available most fewest
  notice given gave resident residents tenant tenants who flagged marked
  amenity amenities feature features equipped offer offers offering space lounge area work known called named
  downtown
  running run runs use uses using
  `
  .split(/\s+/)
  .filter(Boolean);

const COUNT_SENTENCE_RE = /\b(?:how\s+many|number|count|total|list|which|show|what|units?|apartments?|studios?|vacan\w*)\b/i;

let vocabCache: { store: PortfolioStore; words: Set<string> } | undefined;

function knownWords(store: PortfolioStore): Set<string> {
  if (vocabCache?.store === store) return vocabCache.words;
  const words = new Set([...STRUCTURE_WORDS, ...STATUS_WORDS]);
  // Anything that names a property or one of its attributes resolves to rows.
  for (const p of store.properties) {
    const text = [p.propertyId, p.name, ...p.aka, p.address, p.neighborhood, p.pms, ...p.amenities].join(' ');
    for (const w of tokens(text)) words.add(w);
  }
  vocabCache = { store, words };
  return words;
}

function tokens(text: string): string[] {
  return text.toLowerCase().replace(/[’']s\b/g, '').match(/[a-z]+/g) ?? [];
}

/** Words of a unit question that no filter, store value or structure accounts for. */
export function unresolvedUnitWords(question: string, store: PortfolioStore): string[] {
  let rest = question;
  for (const re of FILTER_PHRASES) rest = rest.replace(re, ' ');
  const known = knownWords(store);
  const isKnown = (w: string) => known.has(w) || known.has(w.replace(/e?s$/, '')) || known.has(w.replace(/s$/, ''));
  // Only sentences that ask about units carry qualifiers; a sentence of
  // context ("We get a lot of family inquiries.") or a bracketed
  // instruction qualifies nothing.
  const asking = rest.replace(/\[[^\]]*\]/g, ' . ').split(/[.!?]+/).filter((s) => COUNT_SENTENCE_RE.test(s)).join(' ');
  const symbols = asking.match(/[%$<>=≥≤#*+]/g) ?? [];
  return [...new Set([...tokens(asking).filter((w) => !isKnown(w)), ...symbols])];
}
