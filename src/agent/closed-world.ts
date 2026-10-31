import { stripNegatedStatus } from './intent.ts';
import type { PortfolioStore } from '../data/schema.ts';
import { AMENITY_SYNONYMS } from '../domain/resolver.ts';
import { COMPARATOR_PHRASES } from '../domain/comparators.ts';

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
  // "exactly 3 bedrooms" is the exact-value form the bedroom filter reads.
  /\bexactly\b(?=\s+\d)/gi,
  // The rent noun of a rent comparator ("rent between $2,200 and $2,500").
  /\b(?:market\s+)?rents?\b(?=\s+(?:is\s+)?(?:between|from|at\s+least|at\s+most|under|over|below|above|no\s+more|no\s+less|less|more|greater|fewer|up\s+to|\$))/gi,
  // A status set, as parseUnitStatusSet reads it.
  /\bwhose\s+status\s+is\s+(?:occupied|notice|vacant)\s+or\s+(?:occupied|notice|vacant)\b/gi,
  ...COMPARATOR_PHRASES,
  /\b(?:open|available)\s+(?=(?:studio\s+)?(?:units?|apartments?|studios?|\d?br\b))/gi,
  /\b(?:with\s+)?view\s*[=:]?\s*['"`]?none['"`]?/gi,
  /\b(?:\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten)(?:\.5)?[-\s]*(?:bed(?:room)?s?|brs?|bdrms?|bds?|bath(?:room)?s?|bas?)\b/gi,
  /\b(?:one|two)[-\s]and[-\s]a[-\s]half\s+bath(?:room)?s?\b/gi,
  /\b(?:bed|bath)rooms?(?:_wanted)?\s*[=:]\s*\d+(?:\.\d+)?/gi,
  /\b\d+(?:br|ba)\b/gi,
  /\bstudios?(?:[-\s](?:seekers?|units?|apartments?))?\b/gi,
  /\b(?:with\s+(?:a\s+)?)?[a-z]+[\s-]+views?\b|\bview\s*[=:]\s*['"`]?\w+['"`]?|\bno[-\s]view\b|\bwith\s+no\s+view\b/gi,
  /\bstatus\s*=\s*['"`]?\w+['"`]?/gi,
  /\b(?:on|in)\s+notice(?:\s+status)?\b|\bnotice\b|\b(?:gave|given)\s+notice(?:\s+to\s+(?:vacate|move\s+out))?\b/gi,
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

const COUNT_SENTENCE_RE = /\b(?:how\s+many|number|count|total|list|which|show|what|average|avg|mean|units?|apartments?|studios?|homes?|flats?|residences?|vacan\w*)\b/i;

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
  let rest = stripNegatedStatus(question); // "not vacant" is read as a status set
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

/**
 * S2: the TypedQuery has no negated field (no "status != vacant", no "not
 * on floor 3"), so a negator in a unit question can never be bound by any
 * field. It is unbound on every path, average and rate as much as count,
 * except the view-none forms the view filter does read.
 */
const NEGATOR_RE = /\b(?:not|non|excluding|exclude|except|without|other\s+than|besides|neither|nor)\b|n['’]t\b/gi;
const VIEW_NONE_RE = /\b(?:with\s+no|without\s+(?:a\s+)?|no[-\s])views?\b/gi;
export function unboundNegators(question: string): string[] {
  // "not vacant" is bound: it reads as the set of the other statuses.
  return [...new Set(stripNegatedStatus(question).replace(VIEW_NONE_RE, ' ').match(NEGATOR_RE) ?? [])].map((w) => w.toLowerCase());
}
