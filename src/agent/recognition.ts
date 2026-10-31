import type { DateWindowSpec } from '../config/rules.ts';
import type { PortfolioStore } from '../data/schema.ts';
import { resolvePropertiesFromText } from '../domain/resolver.ts';
import { isDataWord } from '../domain/vocabulary.ts';

/**
 * Recognition checks that run before the planner commits to an answer.
 * Each returns a reason string when the question names something the
 * exports do not contain, so the planner can say "I don't know" instead of
 * falling through to an unfiltered count.
 */

const BUILDING_SUFFIX_RE =
  /\b(towers?|residences|lofts?|yards|commons|point|annex|apartments|place|plaza|court|gardens|heights|house|flats|square|station|shores?|terrace|manor|village|park|landing|crossing|building)\b/i;

const CAPITALISED_PHRASE_RE =
  /\b(?:at|for|does|in|of|from|to|about)\s+(?:[Tt]he\s+)?((?:[A-Z][\w&'.-]*\s+)*[A-Z][\w&'.-]*)/g;

function knownLabels(store: PortfolioStore): Set<string> {
  const known = new Set<string>();
  const add = (s: string) => {
    const k = s.trim().toLowerCase();
    if (k) known.add(k);
    const stripped = k.replace(/^the\s+/, '');
    if (stripped) known.add(stripped);
  };
  for (const p of store.properties) {
    add(p.name);
    for (const a of p.aka) add(a);
    add(p.neighborhood);
  }
  for (const s of [...store.paidSources, ...store.organicSources]) add(s);
  return known;
}

/** Returns a building-like proper name that matches no property, alias, or neighborhood. */
export function findUnknownBuildingReference(
  question: string,
  store: PortfolioStore,
): string | null {
  // An explicit property id ("(P08)") names the building outright.
  if (/\bP\d{2,3}\b/.test(question)) return null;
  const known = knownLabels(store);
  const knownWords = new Set(
    [...known].flatMap((label) => label.split(/\s+/)),
  );
  for (const m of question.matchAll(CAPITALISED_PHRASE_RE)) {
    // Stop at sentence punctuation and drop a possessive ("the Point's").
    const phrase = m[1]
      .split(/[?.,!;:](?:\s|$)/)[0]
      .replace(/[?.,!;:]+$/, '')
      .replace(/['’]s$/i, '');
    if (!BUILDING_SUFFIX_RE.test(phrase)) continue;
    if (known.has(phrase.toLowerCase())) continue;
    // Descriptive combinations of known words ("South Loop Point") are fine;
    // a word no property uses ("Lakeview Tower") is not.
    const words = phrase.toLowerCase().split(/\s+/);
    if (words.every((w) => knownWords.has(w))) continue;
    return phrase;
  }
  return null;
}

const LOCATIVE_RE =
  /\b(?:[Aa]t|[Ff]or|[Dd]oes|[Ii]n|[Oo]f|[Ff]rom|[Tt]o|[Aa]bout)\s+(?:[Tt]he\s+)?((?:[A-Z][\w&'.-]*\s+)*[A-Z][\w&'.-]*)/g;

/**
 * The planner's last check before it scopes a figure: a capitalised place
 * the question names that resolves to no building. Wider than
 * findUnknownBuildingReference, which also gates the clarifier's readings:
 * it reads title case ("At The Clarendon Annex In Q3"), "at <Name>" without
 * a building suffix ("at Printer Row"), and name words from two different
 * buildings ("Clarendon Annex"). Any of these would otherwise fall back to
 * one building or the whole portfolio.
 */
export function findUnresolvedPlace(question: string, store: PortfolioStore): string | null {
  const plain = findUnknownBuildingReference(question, store);
  if (plain) return plain;
  if (/\bP\d{2,3}\b/.test(question)) return null;
  const known = knownLabels(store);
  const knownWords = new Set([...known].flatMap((label) => label.split(/\s+/)));
  for (const m of question.matchAll(LOCATIVE_RE)) {
    const phrase = m[1]
      .split(/[?.,!;:](?:\s|$)/)[0]
      .replace(/[?.,!;:]+$/, '')
      .replace(/['’]s$/i, '')
      .split(/\s+(?:in|for|at|of|from|to|about|on|during|by|with|over|and|or|vs\.?|versus)\b/i)[0];
    if (!phrase || known.has(phrase.toLowerCase())) continue;
    const words = phrase.toLowerCase().split(/\s+/);
    const owners = words
      .filter((w) => w !== 'the')
      .map((w) => store.properties.filter((p) => [p.name, ...p.aka].some((n) => n.toLowerCase().split(/\s+/).includes(w))))
      .filter((o) => o.length > 0);
    if (owners.length > 1 && !owners[0].some((p) => owners.every((o) => o.includes(p)))) return phrase;
    if (BUILDING_SUFFIX_RE.test(phrase)) {
      if (words.every((w) => knownWords.has(w))) continue;
      return phrase;
    }
    if (!/^at\b/i.test(m[0])) continue;
    if (words.some((w) => w.length > 1 && !knownWords.has(w) && !isDataWord(store, w))) return phrase;
  }
  return findLowerCasePlace(question, store, known, knownWords);
}

const LOWER_LOCATIVE_RE =
  /\b(?:at|for|in|of|from|about)\s+(?:the\s+)?([\p{L}&'’.-]+(?:\s+[\p{L}&'’.-]+){0,3})/giu;
const GENERIC_PLACE_WORD = /^(?:the|and|&|buildings?|apartments?|units?|propert(?:y|ies)|communit(?:y|ies)|homes?)$/i;
const PLACE_STOP_RE =
  /^(?:in|for|at|of|from|to|about|on|during|by|with|over|and|or|vs\.?|versus|than|per|across|this|last|next|since|between|before|after|as|when|vs)$/i;

/**
 * Case does not decide whether a phrase names a place: "at printer row"
 * names one as surely as "at Printer Row". A phrase that uses a building
 * name word ("row", "annex", "clarendon") but does not resolve to exactly
 * one property, because a word in it belongs to no property or its name
 * words belong to different properties, is unresolved.
 */
function findLowerCasePlace(
  question: string,
  store: PortfolioStore,
  known: Set<string>,
  knownWords: Set<string>,
): string | null {
  const nameWords = (w: string) =>
    store.properties.filter((p) => [p.name, ...p.aka].some((n) => n.toLowerCase().split(/\s+/).includes(w)));
  for (const m of question.normalize('NFKC').matchAll(LOWER_LOCATIVE_RE)) {
    const raw = m[1].split(/[?,!;:]|\.(?:\s|$)/u)[0].replace(/['’]s\b/gi, '').trim();
    const words: string[] = [];
    for (const w of raw.toLowerCase().split(/\s+/)) {
      if (!w || PLACE_STOP_RE.test(w)) break;
      words.push(w.replace(/[.'’]+$/u, ''));
    }
    if (words.length === 0) continue;
    const phrase = words.join(' ');
    if (known.has(phrase)) continue;
    // A trailing generic noun ("the Lake property") is not part of the name.
    while (words.length > 1 && GENERIC_PLACE_WORD.test(words[words.length - 1]) && words[words.length - 1] !== 'the') words.pop();
    // Only a phrase that ends on a word of some building's name reads as a
    // place; a generic noun ("apartments", "building") or "the" does not.
    const last = words[words.length - 1];
    if (GENERIC_PLACE_WORD.test(last) || nameWords(last).length === 0) continue;
    // The place is the run of words up to that name word; earlier data
    // words ("occupancy at kedzie works") are not part of it.
    let start = words.length - 1;
    while (start > 0 && (knownWords.has(words[start - 1]) || !isDataWord(store, words[start - 1]))) start--;
    const place = words.slice(start);
    if (known.has(place.join(' '))) continue;
    const owners = place.map(nameWords).filter((o) => o.length > 0);
    if (owners.length > 1 && !owners[0].some((p) => owners.every((o) => o.includes(p)))) return place.join(' ');
    if (place.some((w) => w.length > 1 && !knownWords.has(w) && !isDataWord(store, w))) return place.join(' ');
    // Every word fits one building, but the resolver bound none of the
    // buildings it fits ("the Lake property"): the figure would fall back
    // to the whole portfolio.
    if (owners.length > 0) {
      const matched = new Set(resolvePropertiesFromText(store, question, { includeOnboarding: true }).matched.map((p) => p.propertyId));
      if (!owners[0].some((p) => matched.has(p.propertyId))) return place.join(' ');
    }
  }
  return null;
}

const CHANNEL_WORDS_RE =
  /\b(tik\s?tok|instagram|snapchat|pinterest|linkedin|twitter|reddit|youtube|bing(?:\s+ads)?|craigslist|yelp|nextdoor|hotpads|trulia|zumper|padmapper|rentcafe|apartment\s+guide|realtor\.com|billboards?|radio|television|tv\s+ads?|print\s+ads?|newspapers?|direct\s+mail|mailers?|flyers?|podcasts?)\b/i;

/** Returns a marketing channel the question names that never appears in spend or leads. */
export function findUntrackedChannel(
  question: string,
  store: PortfolioStore,
): string | null {
  const m = question.match(CHANNEL_WORDS_RE);
  if (!m) return null;
  const term = m[1].toLowerCase();
  const tracked = [...store.paidSources, ...store.organicSources].map((s) =>
    s.toLowerCase(),
  );
  return tracked.some((s) => s.includes(term)) ? null : m[1];
}

export interface DateCoverage {
  readonly startDate: string;
  readonly endDate: string;
}

function span(dates: readonly string[]): DateCoverage {
  const sorted = [...dates].filter(Boolean).sort();
  return { startDate: sorted[0] ?? '', endDate: sorted[sorted.length - 1] ?? '' };
}

function monthEnd(ym: string): string {
  const [y, m] = ym.split('-').map((n) => Number.parseInt(n, 10));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(last).padStart(2, '0')}`;
}

/** Date coverage of each table, read from the loaded rows rather than hardcoded. */
export function dataCoverage(store: PortfolioStore): {
  readonly marketing: DateCoverage;
  readonly leaseStarts: DateCoverage;
  readonly leaseEnds: DateCoverage;
} {
  const months = span([
    ...store.spend.map((s) => s.month),
    ...store.leads.map((l) => l.createdMonth),
  ]);
  return {
    marketing: {
      startDate: months.startDate ? `${months.startDate}-01` : '',
      endDate: months.endDate ? monthEnd(months.endDate) : '',
    },
    leaseStarts: span(store.leases.map((l) => l.startDate)),
    leaseEnds: span(store.leases.map((l) => l.endDate)),
  };
}

export function windowOverlaps(
  window: DateWindowSpec,
  coverage: DateCoverage,
): boolean {
  return window.startDate <= coverage.endDate && window.endDate >= coverage.startDate;
}

export function describeCoverage(coverage: DateCoverage): string {
  return `${coverage.startDate} to ${coverage.endDate}`;
}

const UNIT_SIGNAL_RE =
  /\b(units?|apartments?|studios?|bedrooms?|[1-4]\s?br|[1-4]-bed\w*|homes?|doors?|vacan\w*|occupied|occupancy|on\s+notice|inventory|sq\.?\s*ft|square\s+feet|floor)\b/i;

/** True when the question names something the units table can count. */
export function hasUnitSignal(question: string): boolean {
  return UNIT_SIGNAL_RE.test(question);
}

export const UNKNOWN_HINT =
  'Try a question about units, occupancy, leases, renewals, concessions, leads, or marketing spend, e.g. "vacant units at the Tower" or "cost per signed lease at Kedzie Works in Q3 2026".';
