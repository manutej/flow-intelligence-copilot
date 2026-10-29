import type { DateWindowSpec } from '../config/rules.ts';
import type { PortfolioStore } from '../data/schema.ts';

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
