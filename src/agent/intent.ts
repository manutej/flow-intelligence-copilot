import { typedQueryErrors } from './typed-query.ts';
import { COMPARATOR_PHRASES } from '../domain/comparators.ts';
import { spellCalendarYear } from '../domain/fiscal.ts';
import { FIXED, isDataWord } from '../domain/vocabulary.ts';
import { mentionsQuantity, statedValues, type Field } from '../domain/comparators.ts';
import { unresolvedUnitWords } from './closed-world.ts';
import { DATE_WINDOWS, type DateWindowSpec } from '../config/rules.ts';
import type {
  DecisionDirection,
  LeaseType,
  PortfolioStore,
  RenewalStatus,
  UnitStatus,
} from '../data/schema.ts';

export type IntentDomain =
  | 'data_quality'
  | 'decisions'
  | 'marketing'
  | 'leases'
  | 'units';

export type IntentMeasure =
  | 'void_and_duplicate_counts'
  | 'decision_lookup'
  | 'decision_cohort_rejected'
  | 'decision_post_spend_comparison'
  | 'decision_outcome_learning'
  | 'reallocation_leases'
  | 'dead_spend_pairs'
  | 'dead_spend_building'
  | 'tour_to_lease_rate'
  | 'apply_rate'
  | 'applied_without_tour'
  | 'applied_and_leased'
  | 'cost_per_lead_and_tour'
  | 'cost_per_lead'
  | 'cost_per_tour'
  | 'lead_count'
  | 'spend_h1_vs_q3'
  | 'spend_total'
  | 'signed_leases_ranking'
  | 'cost_per_signed_lease'
  | 'ending_and_renewed'
  | 'renewal_rate'
  | 'renewal_rate_class_comparison'
  | 'new_vs_renewal_and_concession'
  | 'average_concession'
  | 'rent_at_risk'
  | 'lease_count'
  | 'vacancy_rate'
  | 'occupied_share'
  | 'avg_market_rent_and_sqft'
  | 'avg_market_rent'
  | 'avg_sqft'
  | 'rent_per_sqft'
  | 'unit_count'
  | 'unsupported';

export type IntentAggregation =
  | 'value'
  | 'argmax'
  | 'argmin'
  | 'list'
  | 'compare';

export interface ParsedQueryIntent {
  readonly domain: IntentDomain;
  readonly measure: IntentMeasure;
  readonly aggregation: IntentAggregation;
  readonly topK?: number;
  readonly isWholePortfolioExplicit: boolean;
  readonly isClassComparison: boolean;
  readonly buildingClass?: string;
  readonly yearBuiltMin?: number;
  readonly yearBuiltMax?: number;
  readonly bedrooms?: number;
  readonly bathrooms?: number;
  readonly rentMin?: number;
  readonly rentMax?: number;
  readonly bedroomsMin?: number;
  readonly bedroomsMax?: number;
  readonly bathroomsMin?: number;
  readonly bathroomsMax?: number;
  readonly sqftMin?: number;
  readonly sqftMax?: number;
  readonly floorMin?: number;
  readonly floorMax?: number;
  readonly view?: string;
  readonly unitStatus?: UnitStatus;
  /** A status set ("status is occupied or notice"): the complement of a negated status. */
  readonly unitStatusIn?: readonly UnitStatus[];
  readonly leaseType?: LeaseType;
  readonly renewalStatus?: RenewalStatus;
  readonly dateWindow: DateWindowSpec;
  /** False when no date was named and the default reporting window was used. */
  readonly dateExplicit: boolean;
  readonly leaseStartWindow?: DateWindowSpec;
  readonly leaseEndWindow?: DateWindowSpec;
  readonly mentionedSources: readonly string[];
  readonly paidOnly: boolean;
  readonly decisionIds: readonly string[];
  readonly decisionAccepted?: 'yes' | 'no' | 'all';
  readonly decisionDirection?: DecisionDirection;
}

const LEAD_COUNT_RE =
  /\b(how\s+many\s+(?:[\w.]+\s+){0,2}leads|number\s+of\s+leads|lead\s+(?:count|volume))\b/i;

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseTopKCount(question: string): number | undefined {
  const m =
    question.match(/\b(?:top|first|highest|lowest)\s+(\d+|two|three|four|five)\b/i) ??
    question.match(/\b(two|three|four|five|\d+)\s+(?:highest|lowest|top|largest|biggest)\b/i);
  if (!m) return undefined;
  const raw = m[1].toLowerCase();
  if (raw in NUMBER_WORDS) return NUMBER_WORDS[raw];
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 2 && n <= 10 ? n : undefined;
}

export function parseBedroomCount(question: string): number | undefined {
  if (
    /\b(studios?|studio[-\s]seekers?|studio[-\s]units?|studio[-\s]apartments?|0[-\s]bed(room)?s?|0\s*br\b|bedrooms_wanted\s*=\s*0)\b/i.test(
      question,
    )
  ) {
    return 0;
  }
  const explicitAssign = question.match(
    /\bbedrooms(?:_wanted)?\s*[=:]\s*(\d+)\b/i,
  );
  if (explicitAssign) {
    return Number.parseInt(explicitAssign[1], 10);
  }
  const digitMatch = question.match(
    /\b(\d+)[-\s]*(?:bedrooms?|beds?|brs?|bdrms?|bds?)\b/i,
  );
  if (digitMatch) {
    return Number.parseInt(digitMatch[1], 10);
  }
  const wordMatch = question.match(
    /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)[-\s]+(?:bedrooms?|beds?|brs?)\b/i,
  );
  if (wordMatch) {
    return NUMBER_WORDS[wordMatch[1].toLowerCase()];
  }
  return undefined;
}

export function parseBathroomCount(question: string): number | undefined {
  if (
    /\b(1\.5[-\s]bath(room)?s?|one[-\s]and[-\s]a[-\s]half\s+bath)/i.test(
      question,
    )
  ) {
    return 1.5;
  }
  if (
    /\b(2\.5[-\s]bath(room)?s?|two[-\s]and[-\s]a[-\s]half\s+bath)/i.test(
      question,
    )
  ) {
    return 2.5;
  }
  const explicitAssign = question.match(
    /\bbathrooms?\s*[=:]\s*(\d+(?:\.\d+)?)\b/i,
  );
  if (explicitAssign) {
    return Number.parseFloat(explicitAssign[1]);
  }
  const digitMatch = question.match(
    /\b(\d+(?:\.\d+)?)[-\s]*(?:bathrooms?|baths?|bas?)\b/i,
  );
  if (digitMatch) {
    return Number.parseFloat(digitMatch[1]);
  }
  const wordMatch = question.match(
    /\b(one|two|three|four|five)[-\s]+(?:bathrooms?|baths?)\b/i,
  );
  if (wordMatch) {
    return NUMBER_WORDS[wordMatch[1].toLowerCase()];
  }
  return undefined;
}

export {
  parseBedroomRange,
  parseBathroomRange,
  parseSqftBounds,
  parseFloorBounds,
  parseRentBounds,
} from '../domain/comparators.ts';
import {
  parseBedroomRange,
  parseBathroomRange,
  parseSqftBounds,
  parseFloorBounds,
  parseRentBounds,
} from '../domain/comparators.ts';

/**
 * Dynamically indexes all distinct unit `view` values from `store.units` (`units.csv` `view` column)
 * plus common view tokens so any unseen view (`river`, `harbor`, `skyline`, `mountain`, `garden`, etc.)
 * resolves automatically without hardcoded lists.
 */
export function parseUnitViewFilter(
  question: string,
  store?: PortfolioStore,
): string | undefined {
  if (
    /\b(view\s*[=:]\s*['"`]?none['"`]?|with\s+view\s+['"`]?none['"`]?|no[-\s]view\s+units?|units?\s+with\s+no\s+view|(?:have|has|with)\s+no\s+views?|without\s+(?:a\s+)?views?)\b/i.test(
      question,
    )
  ) {
    return 'none';
  }

  const dynamicViews = store
    ? [...new Set(store.units.map((u) => u.view.trim()))].filter(Boolean)
    : [];
  const candidateViews = [
    ...new Set([
      ...dynamicViews,
      'lake',
      'city',
      'park',
      'courtyard',
      'river',
      'harbor',
      'skyline',
      'mountain',
      'garden',
      'ocean',
      'bay',
      'alley',
    ]),
  ].sort((a, b) => b.length - a.length);

  for (const v of candidateViews) {
    const lower = v.toLowerCase();
    if (lower === 'none') continue;
    const esc = escapeRegExp(lower);
    const viewPat = new RegExp(
      `\\b(?:(?:units?|apartments?|studios?|1br|2br|3br|4br)\\s+with\\s+(?:a\\s+)?${esc}\\s+views?|${esc}[\\s-]+view(?:\\s+units?|\\s+apartments?)?|view\\s*[=:]\\s*['"\`]?${esc}['"\`]?)\\b`,
      'i',
    );
    if (viewPat.test(question)) {
      return lower;
    }
    if (
      lower === 'courtyard' &&
      /\b(courtyard\s+units?|courtyard\s+vacancy)\b/i.test(question)
    ) {
      return 'courtyard';
    }
  }
  return undefined;
}

const STATUS_SET_RE = /\bwhose\s+status\s+is\s+(occupied|notice|vacant)\s+or\s+(occupied|notice|vacant)\b/i;
/** "units whose status is occupied or notice" -> ['notice', 'occupied'] (sorted, distinct). */
const NEG_STATUS_RE = /\b(?:not|aren't|isn't|are\s+not|is\s+not|non-?)\s*(?:currently\s+)?(vacant|occupied|on\s+notice)\b/i;
const ALL_STATUSES: readonly UnitStatus[] = ['notice', 'occupied', 'vacant'];
const STATUS_WORD_RE_LOCAL = /\b(?:vacant|unoccupied|occupied|on\s+notice)\b/i;
/** "not vacant" names the other statuses; stripped before status words are read. */
export const stripNegatedStatus = (q: string) => {
  const rest = q.replace(new RegExp(NEG_STATUS_RE.source, 'gi'), ' ');
  // Only a lone negated status is a set; "not vacant or occupied" stays unbound.
  return (q.match(new RegExp(NEG_STATUS_RE.source, 'gi')) ?? []).length === 1 && !STATUS_WORD_RE_LOCAL.test(rest) ? rest : q;
};
export function parseUnitStatusSet(question: string): UnitStatus[] | undefined {
  const neg = question.match(NEG_STATUS_RE);
  if (neg && stripNegatedStatus(question) !== question) {
    const not = neg[1].toLowerCase().startsWith('on') ? 'notice' : (neg[1].toLowerCase() as UnitStatus);
    return ALL_STATUSES.filter((x) => x !== not);
  }
  const m = question.match(STATUS_SET_RE);
  if (!m) return undefined;
  const set = [...new Set([m[1], m[2]].map((s) => s.toLowerCase() as UnitStatus))].sort();
  return set.length === 2 ? set : undefined;
}

export function parseUnitStatusFilter(question: string): UnitStatus | undefined {
  if (
    /\b(vacant|vacanc(?:y|ies)|unoccupied|empty|open\s+(?:units?|apartments?|studios?|1br|2br)|available\s+(?:units?|apartments?|studios?)|(?:are|is)\s+(?:currently\s+|now\s+)?available|status\s*=\s*['"`]?vacant['"`]?)\b/i.test(
      question,
    ) &&
    !/\bvacancy\s+rate\b/i.test(question)
  ) {
    return 'vacant';
  }
  if (
    /\b(on\s+notice|in\s+notice(\s+status)?|notice\s+status|notice\s+(?:[\w-]+\s+){0,3}?(?:units?|apartments?|homes?|studios?|flats?)|units?\s+(?:that\s+)?(?:are\s+)?on\s+notice|units?\s+with\s+notice|status\s*=\s*['"`]?notice['"`]?|(?:units?|apartments?|residents?|tenants?)\b.*(?:gave|given)\s+notice(\s+to\s+vacate|\s+to\s+move\s+out)?)\b/i.test(
      question,
    ) &&
    !/\b(leases?|monthly\s+rent|rent\s+.*at\s+risk|rent\s+exposure|notice_given)\b/i.test(
      question,
    )
  ) {
    return 'notice';
  }
  if (
    /\b(occupied\s+(?:[\w-]+\s+){0,3}?(?:units?|apartments?|homes?|studios?|residences?|flats?)|(?:are|is)\s+(?:currently\s+|now\s+)?occupied|status\s*=\s*['"`]?occupied['"`]?)\b/i.test(
      question,
    ) &&
    !/\b(share\s+of|percentage\s+of|occupancy\s+rate)\b/i.test(question)
  ) {
    return 'occupied';
  }
  return undefined;
}

export function parseSourceMentions(
  question: string,
  store: PortfolioStore,
): string[] {
  const allSources = [
    ...new Set([
      ...store.paidSources,
      ...store.organicSources,
      ...store.spend.map((s) => s.source),
      ...store.leads.map((l) => l.source),
    ]),
  ].sort((a, b) => b.length - a.length);
  const found: string[] = [];
  for (const src of allSources) {
    const escaped = escapeRegExp(src);
    const pat = new RegExp(`(?:^|\\b)${escaped}(?:\\b|$|\\s)`, 'i');
    if (pat.test(question)) {
      found.push(src);
    }
  }
  return found;
}

const MONTH_NAME_TO_NUM: Readonly<Record<string, number>> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const MONTH_FULL_NAMES = [
  '',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function buildDynamicDateWindow(
  key: string,
  label: string,
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number,
): DateWindowSpec {
  const months: string[] = [];
  let y = startYear;
  let m = startMonth;
  while (y < endYear || (y === endYear && m <= endMonth)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  const startDate = `${startYear}-${String(startMonth).padStart(2, '0')}-01`;
  const lastDay = lastDayOfMonth(endYear, endMonth);
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { key, label, startDate, endDate, months };
}

export function parseDateWindowFromText(
  question: string,
  asOfDate = '2026-10-01',
): DateWindowSpec {
  return parseExplicitDateWindow(question, asOfDate) ?? DATE_WINDOWS.APR_SEP_2026;
}

/** Returns the window the question names, or null when it names none. */
/** "07/2026" is the ISO month "2026-07". */
export function spellIsoMonths(text: string): string {
  return text.replace(/(?<![\d/])(0?[1-9]|1[0-2])\/(20\d{2})(?![\d/])/g, (_m, mo: string, y: string) => `${y}-${mo.padStart(2, '0')}`);
}
const ISO_RANGE_RE = /\b(20\d{2})-(0[1-9]|1[0-2])(?:-(\d{2}))?(?!\d)(\s*(?:[-\u2013\u2014]|\bto\b|\bthrough\b|\bthru\b|\buntil\b|\btill\b|\b(and)\b)\s*)(20\d{2})-(0[1-9]|1[0-2])(?:-(\d{2}))?(?!\d)/i;

export function parseExplicitDateWindow(
  question: string,
  asOfDate = '2026-10-01',
): DateWindowSpec | null {
  question = spellIsoMonths(spellCalendarYear(question));
  const defaultYear = Number.parseInt(asOfDate.slice(0, 4), 10) || 2026;

  // ISO range: "2026-04 to 2026-06", "between 2026-07-01 and 2026-08-31".
  // Days must sit on month edges; any other day is not a month window.
  const isoRange = ISO_RANGE_RE.exec(question);
  if (isoRange && (isoRange[5]?.toLowerCase() !== 'and' || /\bbetween\s+$/i.test(question.slice(0, isoRange.index)))) {
    const [, y1, m1, d1, , , y2, m2, d2] = isoRange;
    const ys = Number(y1), ms = Number(m1), ye = Number(y2), me = Number(m2);
    if ((!d1 || d1 === '01') && (!d2 || Number(d2) === lastDayOfMonth(ye, me)) && (ys < ye || (ys === ye && ms <= me))) {
      const preset = Object.values(DATE_WINDOWS).find((w) => w.months[0] === `${y1}-${m1}` && w.months[w.months.length - 1] === `${y2}-${m2}`);
      return preset ?? buildDynamicDateWindow(`RANGE_${ys}_${ms}_${ye}_${me}`, `${MONTH_FULL_NAMES[ms]} ${ys} to ${MONTH_FULL_NAMES[me]} ${ye}`, ys, ms, ye, me);
    }
    return null;
  }

  if (/\bthis\s+month\b/i.test(question)) {
    const ym = asOfDate.slice(0, 7);
    const match = Object.values(DATE_WINDOWS).find(
      (w) => w.months.length === 1 && w.months[0] === ym,
    );
    if (match) return match;
    const [yStr, mStr] = ym.split('-');
    const y = Number.parseInt(yStr, 10);
    const m = Number.parseInt(mStr, 10);
    return buildDynamicDateWindow(
      `${MONTH_FULL_NAMES[m].toUpperCase().slice(0, 3)}_${y}`,
      `${MONTH_FULL_NAMES[m]} ${y}`,
      y,
      m,
      y,
      m,
    );
  }

  // Comma-separated 3-month quarter lists: e.g., "Jul, Aug, Sep 2026" or "Jan, Feb, Mar 2027"
  if (
    /\bjul(?:y)?\s*,\s*aug(?:ust)?\s*,?\s*(?:and\s+)?sep(?:t(?:ember)?)?(?:\s*(20\d{2}))?\b/i.test(
      question,
    )
  ) {
    return DATE_WINDOWS.Q3_2026;
  }
  if (
    /\bjan(?:uary)?\s*,\s*feb(?:ruary)?\s*,?\s*(?:and\s+)?mar(?:ch)?(?:\s*(20\d{2}))?\b/i.test(
      question,
    )
  ) {
    return DATE_WINDOWS.Q1_2027;
  }

  // Month-to-Month range: e.g., "April to September 2026", "Apr-Sep 2026", "Jan-Mar 2027", "between April and September 2026"
  const monthRangeMatch = question.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(20\d{2}))?[\s-–—]*(?:(?:to|through|thru|and)[\s-–—]+|[-–—][\s-–—]*)(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s*,?\s*(20\d{2}|'\d{2}))?\b/i,
  );
  if (monthRangeMatch) {
    const m1 = MONTH_NAME_TO_NUM[monthRangeMatch[1].toLowerCase()];
    const m2 = MONTH_NAME_TO_NUM[monthRangeMatch[3].toLowerCase()];
    const rawY2 = monthRangeMatch[4]
      ? monthRangeMatch[4].startsWith("'")
        ? `20${monthRangeMatch[4].slice(1)}`
        : monthRangeMatch[4]
      : undefined;
    const y2 = rawY2
      ? Number.parseInt(rawY2, 10)
      : monthRangeMatch[2]
        ? Number.parseInt(monthRangeMatch[2], 10)
        : m1 === 1 && m2 === 3
          ? defaultYear + 1
          : defaultYear;
    const y1 = monthRangeMatch[2] ? Number.parseInt(monthRangeMatch[2], 10) : y2;

    if (y1 === 2026 && m1 === 4 && y2 === 2026 && m2 === 9) {
      return DATE_WINDOWS.APR_SEP_2026;
    }
    if (y1 === 2027 && m1 === 1 && y2 === 2027 && m2 === 3) {
      return DATE_WINDOWS.Q1_2027;
    }
    if (y1 === 2026 && m1 === 7 && y2 === 2026 && m2 === 9) {
      return DATE_WINDOWS.Q3_2026;
    }
    if (y1 === 2026 && m1 === 4 && y2 === 2026 && m2 === 6) {
      return DATE_WINDOWS.Q2_2026;
    }
    if (y1 === 2026 && m1 === 10 && y2 === 2026 && m2 === 12) {
      return DATE_WINDOWS.Q4_2026;
    }
    return buildDynamicDateWindow(
      `RANGE_${y1}_${m1}_${y2}_${m2}`,
      `${MONTH_FULL_NAMES[m1]} to ${MONTH_FULL_NAMES[m2]} ${y2}`,
      y1,
      m1,
      y2,
      m2,
    );
  }

  // Quarter expressions: "Q1 2027", "Q3 '26", "third quarter of 2026", "1st quarter 2027", "2026 Q3"
  const quarterMatch =
    question.match(/\bq([1-4])(?:\s+of)?(?:\s*,?\s*(20\d{2}|'\d{2}))?(?:\b|$)/i) ??
    question.match(/\b(20\d{2})\s+q([1-4])\b/i) ??
    question.match(
      /\b(first|1st|second|2nd|third|3rd|fourth|4th)\s+quarter(?:\s+of)?(?:\s+(20\d{2}|'\d{2}))?(?:\b|$)/i,
    );
  if (quarterMatch) {
    let qNum = 3;
    let yNum = defaultYear;
    if (/^20\d{2}$/.test(quarterMatch[1])) {
      yNum = Number.parseInt(quarterMatch[1], 10);
      qNum = Number.parseInt(quarterMatch[2], 10);
    } else if (/^[1-4]$/.test(quarterMatch[1])) {
      qNum = Number.parseInt(quarterMatch[1], 10);
      if (quarterMatch[2]) {
        yNum = Number.parseInt(
          quarterMatch[2].startsWith("'")
            ? `20${quarterMatch[2].slice(1)}`
            : quarterMatch[2],
          10,
        );
      } else if (qNum === 1) {
        yNum = defaultYear + 1;
      }
    } else {
      const ord = quarterMatch[1].toLowerCase();
      qNum =
        ord === 'first' || ord === '1st'
          ? 1
          : ord === 'second' || ord === '2nd'
            ? 2
            : ord === 'third' || ord === '3rd'
              ? 3
              : 4;
      if (quarterMatch[2]) {
        yNum = Number.parseInt(
          quarterMatch[2].startsWith("'")
            ? `20${quarterMatch[2].slice(1)}`
            : quarterMatch[2],
          10,
        );
      } else if (qNum === 1) {
        yNum = defaultYear + 1;
      }
    }

    const presetKey = `Q${qNum}_${yNum}`;
    if (presetKey in DATE_WINDOWS) {
      return DATE_WINDOWS[presetKey];
    }
    const startMonth = (qNum - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    return buildDynamicDateWindow(
      presetKey,
      `Q${qNum} ${yNum}`,
      yNum,
      startMonth,
      yNum,
      endMonth,
    );
  }

  if (
    /\b(h1|first\s+half)(\s*20\d{2})?\b/i.test(question) &&
    !/\bvs\.?\s*q3\b/i.test(question) &&
    !/\bversus\s+q3\b/i.test(question)
  ) {
    return DATE_WINDOWS.H1_2026;
  }
  const h2 = question.match(/\b(?:h2|second\s+half)(?:\s+of)?(?:\s*(20\d{2}))?\b/i);
  if (h2) {
    const y = h2[1] ? Number(h2[1]) : defaultYear;
    return buildDynamicDateWindow(`H2_${y}`, `H2 ${y} (July to December ${y})`, y, 7, y, 12);
  }

  // Single Month + optional Year: e.g., "December 2026", "Dec 2026", "August"
  const singleMonthMatch = question.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s*,?\s*(20\d{2}|'\d{2}))?(?:\b|$)/i,
  );
  if (singleMonthMatch) {
    const mNum = MONTH_NAME_TO_NUM[singleMonthMatch[1].toLowerCase()];
    const rawY = singleMonthMatch[2]
      ? singleMonthMatch[2].startsWith("'")
        ? `20${singleMonthMatch[2].slice(1)}`
        : singleMonthMatch[2]
      : undefined;
    const yNum = rawY ? Number.parseInt(rawY, 10) : defaultYear;
    const shortKey = `${MONTH_FULL_NAMES[mNum].toUpperCase().slice(0, 3)}_${yNum}`;
    if (shortKey in DATE_WINDOWS) {
      return DATE_WINDOWS[shortKey];
    }
    return buildDynamicDateWindow(
      shortKey,
      `${MONTH_FULL_NAMES[mNum]} ${yNum}`,
      yNum,
      mNum,
      yNum,
      mNum,
    );
  }

  const isoSingleMonth = question.match(/\b(20\d{2})-(\d{2})(?:-\d{2})?\b/);
  if (isoSingleMonth && !/\bto\b/i.test(question)) {
    const yNum = Number.parseInt(isoSingleMonth[1], 10);
    const mNum = Number.parseInt(isoSingleMonth[2], 10);
    const ym = `${isoSingleMonth[1]}-${isoSingleMonth[2]}`;
    const match = Object.values(DATE_WINDOWS).find(
      (w) => w.months.length === 1 && w.months[0] === ym,
    );
    if (match) return match;
    return buildDynamicDateWindow(
      `${MONTH_FULL_NAMES[mNum].toUpperCase().slice(0, 3)}_${yNum}`,
      `${MONTH_FULL_NAMES[mNum]} ${yNum}`,
      yNum,
      mNum,
      yNum,
      mNum,
    );
  }

  if (/\b(end(s|ing)?\s+in\s+2026|started\s+in\s+2026|created\s+in\s+2026|in\s+2026)\b/i.test(question)) {
    return DATE_WINDOWS.YEAR_2026;
  }

  // A bare year other than the reporting year ("in 2025") is a whole calendar
  // year; it must not silently become the default reporting window.
  // A money amount is not a year: skip numbers after a currency sign or
  // code, inside a larger figure, or before a currency word or k/m suffix.
  const bareYear = question.match(
    /(?<!(?:[$€£]|\busd|\bdollars?)\s*)(?<![\d.,])\b(20\d{2})\b(?![.,]\d)(?!\s*(?:dollars?|bucks|usd|k|m)\b)/i,
  );
  if (bareYear) {
    const yNum = Number.parseInt(bareYear[1], 10);
    if (yNum !== defaultYear) {
      return buildDynamicDateWindow(`YEAR_${yNum}`, `${yNum}`, yNum, 1, yNum, 12);
    }
  }

  return null;
}

// A unit count answers only a question that asks to count or list units
// and whose every word a filter, the store or plain structure accounts for
// (closed-world.ts). Anything else answers unknown, never the total.
// Rent named as a filter ("with rent between $1900 and $2500", "$1900
// rent") is a condition, not the measure; measure cues read the rest.
const RENT_FILTER_RE = /\b(?:market\s+)?rents?\s+(?:of\s+|is\s+|was\s+)?(?=(?:between|at\s+least|at\s+most|under|over|below|above|from|no\s+more\s+than|no\s+less\s+than|less\s+than|more\s+than|greater\s+than|fewer\s+than|up\s+to|\$))|\$\s?\d[\d,]*(?:\.\d+)?\s+(?:in\s+)?rents?\b/gi;
const measureText = (question: string): string => question.replace(RENT_FILTER_RE, ' ');

const UNIT_COUNT_CUE_RE =
  /\b(?:how\s+many|number\s+of|count|total|list|which|show|what)\b|\bvacanc(?:y|ies)\b/i;
const UNIT_NOUN_RE =
  /\b(?:units?|apartments?|apts?|vacanc(?:y|ies)|studios?|flats?|homes|buildings?|properties|(?:one|two|three|four|\d)[-\s]?(?:bed(?:room)?s?|br)\b)/i;

/**
 * Pure semantic parser that extracts a structured `ParsedQueryIntent` AST from
 * any natural-language operator question using dynamic column sets from `store`
 * without checking `qRecord.id` or `result_schema`.
 */
function parseQueryIntentRaw(
  question: string,
  store: PortfolioStore,
): ParsedQueryIntent {
  const topK = parseTopKCount(question);
  // A comparator ("at least 2 bedrooms") is a range, never the exact count.
  const bedRange = parseBedroomRange(question);
  const bathRange = parseBathroomRange(question);
  const bedrooms = bedRange ? undefined : parseBedroomCount(question);
  const bathrooms = bathRange ? undefined : parseBathroomCount(question);
  const bedroomsMin = bedRange?.min, bedroomsMax = bedRange?.max;
  const bathroomsMin = bathRange?.min, bathroomsMax = bathRange?.max;
  const { sqftMin, sqftMax } = parseSqftBounds(question);
  const { rentMin, rentMax } = parseRentBounds(question);
  const { floorMin, floorMax } = parseFloorBounds(question);
  const view = parseUnitViewFilter(question, store);
  const unitStatusIn = parseUnitStatusSet(question);
  const unitStatus = unitStatusIn ? undefined : parseUnitStatusFilter(question);
  const mentionedSources = parseSourceMentions(question, store);
  const explicitWindow = parseExplicitDateWindow(
    question,
    store.policy.asOfDate,
  );
  const dateWindow = explicitWindow ?? DATE_WINDOWS.APR_SEP_2026;
  const dateExplicit = explicitWindow !== null;

  const isClassComparison =
    /\bclass\s+[a-z0-9+-]+\s+(?:vs\.?|versus|compared\s+to)\s+class\s+[a-z0-9+-]+/i.test(
      question,
    );

  // Dynamically match buildingClass from store.properties distinct classes (plus A/B/C/A+/B-)
  const distinctClasses = [
    ...new Set([
      ...store.properties.map((p) => p.buildingClass.toUpperCase()),
      'A+',
      'B-',
      'A',
      'B',
      'C',
    ]),
  ].sort((a, b) => b.length - a.length);
  let buildingClass: string | undefined;
  if (!isClassComparison) {
    for (const cls of distinctClasses) {
      const pat = new RegExp(
        `\\bclass[\\s-]+${escapeRegExp(cls)}(?![a-z0-9+-])`,
        'i',
      );
      if (pat.test(question)) {
        buildingClass = cls;
        break;
      }
    }
  }

  const builtBeforeMatch = question.match(
    /\b(?:built\s+before|pre-)\s*(\d{4})\b/i,
  );
  const builtOnOrAfterMatch = question.match(
    /\bbuilt\s+(?:in\s+)?(\d{4})\s+or\s+(?:later|after|newer)\b/i,
  );
  const yearBuiltMax = builtBeforeMatch
    ? Number.parseInt(builtBeforeMatch[1], 10) - 1
    : undefined;
  const yearBuiltMin = builtOnOrAfterMatch
    ? Number.parseInt(builtOnOrAfterMatch[1], 10)
    : undefined;

  const decisionIdMatches = [
    ...question.matchAll(/\b(X\d{3,4})\b/gi),
  ].map((m) => m[1].toUpperCase());
  const decisionIds = [...new Set(decisionIdMatches)];

  const hasExplicitPropertyCohort =
    /\bP\d{2,3}\b/i.test(question) ||
    /\b(between|among\s+(?:the\s+|our\s+)?(?:buildings|properties)|of\s+(?:the\s+|our\s+)?(?:buildings|properties)|among\s+the\s+ev|between\s+the\s+ev|ev[-\s]charg)/i.test(
      question,
    );

  const isWholePortfolioExplicit =
    /\b(across\s+the\s+(whole\s+|entire\s+)?portfolio|whole\s+portfolio|entire\s+portfolio|portfolio[-\s]wide|in\s+the\s+portfolio|for\s+the\s+portfolio|portfolio\s+total|every\s+paid\s+(?:listing\s+)?source\s+and\s+(?:building|property)\s+pair|every\s+(?:building|property)\s+and\s+paid\s+source\s+pair|across\s+the\s+operating\s+portfolio)\b/i.test(
      question,
    ) ||
    (!hasExplicitPropertyCohort &&
      /\b(which\s+(?:operating\s+)?(?:building|property)\s+(?:gave|offered|had|provided|has|carries|holds|topped|averaged)|what\s+(?:were|are)\s+the\s+(?:\w+\s+)?(?:highest|lowest|top)\s+(?:grossing\s+)?(?:properties|buildings)|across\s+operating\s+buildings|among\s+buildings\s+that\s+are\s+operating)\b/i.test(
        question,
      ) &&
      !/\b(with|offer|have\s+a|has\s+a|on\s+yardi|on\s+entrata|on\s+realpage|on\s+mri|on\s+appfolio|on\s+resman|running\s+on|in\s+the\s+south\s+loop|built\s+in|class\s+[a-z0-9+-]+)\b/i.test(
        question,
      ));

  const aggregation: IntentAggregation = isClassComparison
    ? 'compare'
    : /\b(lowest|least|cheapest|minimum|fewest|best\s+cost|most\s+cost[-\s]effective|most\s+efficient)\b/i.test(
          question,
        )
      ? 'argmin'
      : /\b(highest|most|maximum|biggest|largest|worst|most\s+expensive|costliest|priciest|richest|greatest|topped|tops|higher\s+count|more\s+(?:signed\s+|lead[-\s]driven\s+|lead[-\s]sourced\s+)?leases|signed\s+more|converted\s+more|turned\s+more)\b/i.test(
            question,
          )
        ? 'argmax'
        : /\b(list\s+every|list\s+all|which\s+paid\s+sources|what\s+paid\s+sources)\b/i.test(
              question,
            )
          ? 'list'
          : 'value';

  // 1. Data quality audit (void spend rows + duplicate leads)
  if (
    /\bvoid(ed)?\b/i.test(question) &&
    /\b(duplicates?|repeat\s+entr(y|ies)|re-?entr(y|ies)|same\s+lease|earlier\s+lead)\b/i.test(
      question,
    )
  ) {
    return {
      domain: 'data_quality',
      measure: 'void_and_duplicate_counts',
      aggregation: 'value',
      isWholePortfolioExplicit: true,
      isClassComparison: false,
      dateWindow,
      dateExplicit,
      mentionedSources,
      paidOnly: false,
      decisionIds: [],
    };
  }

  // 2. Budget decisions & FLOW-105 outcome learning
  if (
    decisionIds.length > 0 ||
    /\b(decisions\.csv|decision\s+id|accepted\s*=\s*no|rejected\s+(decreases?|increases?|cuts?)|budget\s+moves?|outcome\s+learn\w*|decisions\s+that\s+learn|shrinkage\s+ranking)\b/i.test(
      question,
    )
  ) {
    const decisionAccepted: 'yes' | 'no' | 'all' =
      /\b(accepted\s*=\s*no|rejected|declined)\b/i.test(question)
        ? 'no'
        : /\baccepted\s*=\s*yes\b/i.test(question)
          ? 'yes'
          : 'all';
    const decisionDirection: DecisionDirection | undefined =
      /\b(decreases?|cuts?|trims?)\b/i.test(question)
        ? 'decrease'
        : /\bincreases?\b/i.test(question)
          ? 'increase'
          : undefined;

    let measure: IntentMeasure = 'decision_outcome_learning';
    if (
      /\bspent\s+more\s+in\s+the\s+months\s+on\s+or\s+after\b/i.test(
        question,
      ) ||
      /\bmonths\s+after\s+\d{4}-\d{2}\b/i.test(question)
    ) {
      measure =
        decisionIds.length === 1
          ? 'decision_lookup'
          : 'decision_post_spend_comparison';
    } else if (
      decisionAccepted === 'no' &&
      /\b(list\s+every|sum\s+the\s+absolute)\b/i.test(question)
    ) {
      measure = 'decision_cohort_rejected';
    } else if (
      decisionIds.length === 1 &&
      !/\b(rank\w*|#1|top\s+channel|lowest\s+posterior|best\s+channel|channel\s+ranking)\b/i.test(
        question,
      )
    ) {
      measure = 'decision_lookup';
    }

    return {
      domain: 'decisions',
      measure,
      aggregation,
      topK,
      isWholePortfolioExplicit,
      isClassComparison,
      buildingClass,
      dateWindow,
      dateExplicit,
      mentionedSources,
      paidOnly: true,
      decisionIds,
      decisionAccepted,
      decisionDirection,
    };
  }

  // 3. Marketing, Spend, Funnel, CPSL, CPL, CPT, Dead Spend, Reallocation
  const isReallocation =
    /\bhow\s+many\s+(?:more|additional|extra|new)?\s*(?:whole\s+)?(?:signed\s+)?leases(?:\s+\([^)]+\))?\s+(?:would|does|could|can)\s+(?:it|that|this|we|that\s+spend|the\s+spend)\s+(?:buy|purchase|get|yield|generate)\b/i.test(
      question,
    ) ||
    (/\b(reallocat\w*|reassign\w*|consolidat\w*|pool\s+the\s+spend|shift\s+(?:the|all).*spend|move\s+(?:the|all).*spend|redirect\s+(?:the|all).*spend|transfer\s+(?:the|all).*spend)\b/i.test(
      question,
    ) &&
      /\b(lowest|cheapest|best|most\s+efficient|cpsl|cost\s+per\s+signed\s+lease|buy|purchase|whole\s+leases)\b/i.test(
        question,
      ));

  const isBleedingMarketing = /\b(?:bleed\w*|wast\w*|burn\w*)\s+(?:money|spend|budget)\s+on\s+(?:marketing|ads?|paid|channels?)\b/i.test(question);
  const isDeadSpendPairs =
    !isReallocation &&
    (isBleedingMarketing || (
    (/\b(pairs?|pairings?|combos?|combinations?|property\/source|building\/source)\b/i.test(question) ||
      /\bwhich\s+paid\s+sources?\s*,?\s*(?:at\s+which\s+buildings?|by\s+building)\b/i.test(
        question,
      ) ||
      /\bwhich\s+buildings?\s+and\s+paid\s+sources?\b/i.test(question)) &&
    /\b(no\s+(?:resulting\s+|signed\s+)?leases?|zero\s+(?:signed\s+)?leases?|0\s+(?:signed\s+)?leases?|signed\s+no\s+leases?|came\s+up\s+empty|without\s+(?:any\s+)?(?:signed\s+)?leases?|dead\s+spend|zero-lease)\b/i.test(
      question,
    )));

  const isSignedLeasesFromLeadsRanking =
    /\b(signed\s+(?:more|the\s+most)\s+(?:lead[-\s]driven\s+|lead[-\s]sourced\s+)?leases|most\s+(?:signed\s+)?leases\s+from\s+leads|more\s+(?:signed\s+)?leases\s+from\s+leads|more\s+leases\s+signed\s+from\s+leads|more\s+lead[-\s]sourced\s+lease\s+signings|converted\s+more\s+leads\s+into\s+signed\s+leases|turned\s+more\s+leads\s+into\s+signed\s+leases|higher\s+count\s+of\s+leases\s+signed\s+from\s+leads)\b/i.test(
      question,
    );

  const isTourToLeaseConversion =
    /\b(tour[-\s]to[-\s]lease|tours?\s+.*\b(?:convert\w*|turned\s+into\s+leases|became\s+leases|signed\s+a\s+lease)|toured\s+.*\b(?:signed|converted|leased)|conversion\s+rate.*(?:zillow|tour)|share\s+of\s+.*tours?\s+.*(?:signed|leased|turned\s+into\s+leases))\b/i.test(
      question,
    );

  const isMarketingOrFunnel =
    isReallocation ||
    isDeadSpendPairs ||
    isSignedLeasesFromLeadsRanking ||
    isTourToLeaseConversion ||
    /\b(cost\s+per\s+(?:signed\s+)?(?:lease|lead|tour)|per\s+signed\s+lease|acquisition\s+cost\s+per|cpsl\b|cpa\b|cpl\b|cpt\b|paid\s+(?:listing\s+|ad\s+|marketing\s+)?(?:sources?|channels?)|listing\s+(?:sources?|channels?)|marketing\s+(?:sources?|channels?)|ad\s+(?:sources?|channels?)|brought\s+no\s+leases|produced\s+no\s+leases|yielded\s+no\s+leases|generated\s+no\s+leases|signed\s+no\s+leases?|zero\s+(?:signed\s+)?leases|0\s+(?:signed\s+)?leases|dead\s+spend|conversion\s+rate|apply\s+rate|applied\s*=\s*true|applied\s+in\s+\w+|posted\s+spend|h1\s+spend\s+versus\s+q3\s+spend)\b/i.test(
      question,
    ) ||
    (mentionedSources.length > 0 &&
      /\b(cost|spend|spent|paid|leases?|leads?|tours?|toured|converted|conversion|cpsl|cpl|cpt)\b/i.test(
        question,
      )) ||
    /\b(spend|spent|ad\s+budget|marketing\s+budget)\b/i.test(question) ||
    LEAD_COUNT_RE.test(question) ||
    /\b(cheapest|best|most\s+efficient|most\s+expensive)\s+(?:paid\s+)?(?:listing\s+|marketing\s+|ad\s+)?(?:sources?|channels?)\b/i.test(
      question,
    );

  if (isMarketingOrFunnel) {
    let measure: IntentMeasure = 'cost_per_signed_lease';
    if (isReallocation) {
      measure = 'reallocation_leases';
    } else if (isDeadSpendPairs) {
      measure = 'dead_spend_pairs';
    } else if (
      /\b(brought\s+no\s+leases|produced\s+no\s+leases|yielded\s+no\s+leases|generated\s+no\s+leases|signed\s+no\s+leases?|zero[-\s]lease|0\s+signed\s+leases)\b/i.test(
        question,
      )
    ) {
      measure = 'dead_spend_building';
    } else if (isTourToLeaseConversion) {
      measure = 'tour_to_lease_rate';
    } else if (/\bapply\s+rate\b/i.test(question)) {
      measure = 'apply_rate';
    } else if (
      /\bapplied\s*=\s*true\b.*\btoured\s*=\s*false\b/i.test(question) ||
      /\bapplied\s+without\s+tour/i.test(question)
    ) {
      measure = 'applied_without_tour';
    } else if (
      /\bapplied\s+in\s+\w+\b.*\bbecame\s+a\s+signed\s+lease\b/i.test(question)
    ) {
      measure = 'applied_and_leased';
    } else if (
      /\bcost\s+per\s+lead\b/i.test(question) &&
      /\bcost\s+per\s+tour\b/i.test(question)
    ) {
      measure = 'cost_per_lead_and_tour';
    } else if (/\b(cost\s+per\s+lead|cpl)\b/i.test(question)) {
      measure = 'cost_per_lead';
    } else if (/\b(cost\s+per\s+tour|cpt)\b/i.test(question)) {
      measure = 'cost_per_tour';
    } else if (LEAD_COUNT_RE.test(question)) {
      measure = 'lead_count';
    } else if (
      /\bh1\s+spend\s+(?:vs\.?|versus)\s+q3\s+spend\b/i.test(question)
    ) {
      measure = 'spend_h1_vs_q3';
    } else if (
      /\b(posted\s+(?:[\w.]+\s+){0,3}spend|total\s+(?:[\w.]+\s+){0,3}spend|what\s+did\s+we\s+spend|what\s+did\s+.*\bcost\b|how\s+much\s+did\s+.*\b(cost|spend)\b)\b/i.test(
        question,
      ) &&
      !/\b(cost\s+per|per\s+signed\s+lease|cpsl|cpa)\b/i.test(question)
    ) {
      measure = 'spend_total';
    } else if (isSignedLeasesFromLeadsRanking) {
      measure = 'signed_leases_ranking';
    } else if (!/\b(cost|cpsl|cpa|cheap\w*|efficien\w*|per\s+(?:signed\s+)?lease|best|worst|lowest|highest)\b/i.test(question)) {
      // Cost per lease is answered only when asked for; plain spend is spend.
      measure = /\b(spend|spent|spending)\b/i.test(question) ? 'spend_total' : 'unsupported';
    }

    const paidOnly =
      measure === 'cost_per_signed_lease' ||
      measure === 'dead_spend_building' ||
      measure === 'dead_spend_pairs' ||
      measure === 'reallocation_leases' ||
      measure === 'apply_rate' ||
      /\bpaid\s+(?:listing\s+|ad\s+|marketing\s+)?(?:sources?|channels?)\b|\bILS(?:es)?\b|\b(?:internet\s+)?listing\s+(?:sites?|services?)\b/i.test(
        question,
      );

    return {
      domain: 'marketing',
      measure,
      aggregation,
      topK,
      isWholePortfolioExplicit:
        isWholePortfolioExplicit ||
        measure === 'reallocation_leases' ||
        measure === 'dead_spend_pairs',
      isClassComparison,
      buildingClass,
      yearBuiltMin,
      yearBuiltMax,
      bedrooms,
      dateWindow,
      dateExplicit,
      mentionedSources,
      paidOnly,
      decisionIds: [],
    };
  }

  // 4. Leases, Renewals, Concessions, and Rent at Risk
  const isRentAtRiskOrLeaseRent =
    (/\b(monthly\s+rent|rent\s+per\s+month|at[-\s]risk\s+monthly\s+rent|monthly\s+rent\s+exposure)\b/i.test(
      question,
    ) &&
      /\b(at\s+risk|exposure|lose|leases?|notice|end|ending|ends|expir\w*|matur\w*|q1\s*2027|2027)\b/i.test(
        question,
      )) ||
    /\b(highest[-\s]grossing|grossing\s+(?:properties|buildings)|rent\s+roll|(?:lease|rental)\s+revenue|total\s+monthly\s+(?:lease\s+)?rent)\b/i.test(
      question,
    );

  const isConcessionQuery =
    /\b(concessions?|move[-\s]in\s+specials?)\b/i.test(question);

  const isLeasesOrRenewals =
    isRentAtRiskOrLeaseRent ||
    isConcessionQuery ||
    /\b(leases?\b.*(end|ending|ends|expir\w*|matur\w*|started|starts|starting|began|commenc\w*|renew\w*|concession\w*|specials?|free\s+rent|at\s+risk|gave\s+notice|given\s+notice|notice\s+given|notice_given|pending|undecided|outstanding|no\s+renewal\s+decision)|lease[-\s]ends|lease\s+expirations?|new[-\s]lease\s+starts|average\s+concession|renewal\s+rate|pending\s+(?:a\s+)?renewal)\b/i.test(
      question,
    );

  if (isLeasesOrRenewals) {
    const isNewVsRenewal = /\bnew\s+(?:vs\.?|versus)\s+renewal\b/i.test(question);
    const leaseType: LeaseType | undefined =
      /\bnew[-\s]leases?\b/i.test(question) && !isNewVsRenewal
        ? 'new'
        : /\brenewal\s+leases?\b/i.test(question) && !isNewVsRenewal
          ? 'renewal'
          : undefined;

    let renewalStatus: RenewalStatus | undefined;
    if (
      /\b(pending|awaiting\s+(?:a\s+)?renewal|undecided|no\s+renewal\s+decision|not\s+had\s+a\s+renewal\s+decision|don't\s+yet\s+have\s+a\s+renewal\s+decision|do\s+not\s+yet\s+have\s+a\s+renewal\s+decision|without\s+a\s+renewal\s+decision|decision\s+still\s+outstanding)\b/i.test(
        question,
      )
    ) {
      renewalStatus = 'pending';
    } else if (
      /\b(resident\s+(?:has\s+|have\s+)?(?:gave|given)\s+notice|residents?\s+(?:who\s+)?(?:has\s+|have\s+)?(?:gave|given)\s+notice|tenants?\s+(?:who\s+)?(?:have\s+)?(?:gave|given)\s+notice|notice\s+given|notice_given|notice[-\s]to[-\s]vacate|gave\s+notice\s+to\s+vacate|non[-\s]renewing)\b/i.test(
        question,
      ) ||
      (/\bat\s+risk\b/i.test(question) && /\bnotice\b/i.test(question))
    ) {
      renewalStatus = 'notice_given';
    }

    const hasStartSignal =
      /\b(started|starts|starting|began|commenc\w*|start\s+dates?|lease\s+starts|new[-\s]lease\s+starts|with\s+a\s+q[1-4]\s+\d{4}\s+start)\b/i.test(
        question,
      );
    const hasEndSignal =
      /\b(end|ending|ends|endings|lease[-\s]ends|expir\w*|matur\w*)\b/i.test(
        question,
      ) || /\bthis\s+month\b/i.test(question);

    // A concession question that names a period ("in Q3 2026") is about
    // leases that started in that period, even without the word "started".
    // Without a named period a concession figure covers the leases that
    // started in the data window its label names, not every lease on file.
    const leaseStartWindow =
      hasStartSignal || (isConcessionQuery && !hasEndSignal)
        ? dateWindow
        : undefined;
    // A renewal rate for a named period is over the leases ending in it.
    const isRenewalRateQuery = /\brenewal\s+rate\b|\brenew(?:ed|al)?\s+(?:share|percent|%)/i.test(question);
    const leaseEndWindow =
      (hasEndSignal || (isRenewalRateQuery && dateExplicit)) && !hasStartSignal ? dateWindow : undefined;

    let measure: IntentMeasure = 'lease_count';
    if (
      /\bhow\s+many\s+of\s+them\s+have\s+renewed\b/i.test(question) &&
      /\bhow\s+many\s+leases\b/i.test(question)
    ) {
      measure = 'ending_and_renewed';
    } else if (isClassComparison && /\brenewal\s+rate\b/i.test(question)) {
      measure = 'renewal_rate_class_comparison';
    } else if (
      /\b(renewal\s+rate|what\s+share\s+of\s+leases.*have\s+renewed)\b/i.test(
        question,
      )
    ) {
      measure = 'renewal_rate';
    } else if (
      /\bnew\s+(?:vs\.?|versus)\s+renewal\b/i.test(question) &&
      /\bconcession\b/i.test(question)
    ) {
      measure = 'new_vs_renewal_and_concession';
    } else if (isConcessionQuery) {
      measure = 'average_concession';
    } else if (isRentAtRiskOrLeaseRent) {
      measure = 'rent_at_risk';
    }

    return {
      domain: 'leases',
      measure,
      aggregation,
      topK,
      isWholePortfolioExplicit,
      isClassComparison,
      buildingClass,
      yearBuiltMin,
      yearBuiltMax,
      bedrooms,
      bathrooms,
      bedroomsMin,
      bedroomsMax,
      bathroomsMin,
      bathroomsMax,
      view,
      floorMin,
      floorMax,
      leaseType,
      renewalStatus,
      dateWindow,
      dateExplicit,
      leaseStartWindow,
      leaseEndWindow,
      mentionedSources,
      paidOnly: false,
      decisionIds: [],
    };
  }

  // 5. Units, Occupancy, Vacancy Rate, Market Rent, and Sqft
  let unitMeasure: IntentMeasure = 'unit_count';
  if (/\bvacancy\s+rate\b/i.test(question)) {
    unitMeasure = 'vacancy_rate';
  } else if (
    /\b(occupied\s+share|share\s+of.*occupied|occupancy\s+rate|occupancy\s+at|percent(?:age)?\s+of.*occupied)\b/i.test(
      question,
    )
  ) {
    unitMeasure = 'occupied_share';
  } else if (
    /\b(average|avg\.?|mean)\b.*\b(?:market\s+)?rent\b/i.test(measureText(question)) &&
    /\b(average|avg\.?|mean)\s+sq\.?\s*ft\b/i.test(question)
  ) {
    unitMeasure = 'avg_market_rent_and_sqft';
  } else if (/\b(average|avg\.?|mean)\s+(?:sq\.?\s*ft|square\s+f(?:oo|ee)t(?:age)?)\b/i.test(question)) {
    unitMeasure = 'avg_sqft';
  } else if (
    (/\b(average|avg\.?|mean)\b/i.test(question) &&
      /\b(market\s+rent|asking\s+rent|rent)\b/i.test(measureText(question))) ||
    /\bmarket\s+rent\s+(?:average|mean)\b/i.test(question)
  ) {
    unitMeasure = 'avg_market_rent';
  } else if (/\b(average|avg\.?|mean)\s+(?:sq\.?\s*ft|square\s+f(?:oo|ee)t(?:age)?)\b|\b(?:sq\.?\s*ft|square\s+f(?:oo|ee)tage)\s+(?:average|mean)\b/i.test(question)) {
    unitMeasure = 'avg_sqft';
  } else if (/\brent\s+per\s+sq\.?\s*ft\b/i.test(question)) {
    unitMeasure = 'rent_per_sqft';
  } else if (!UNIT_COUNT_CUE_RE.test(question) || !UNIT_NOUN_RE.test(question) || unresolvedUnitWords(question, store).length > 0) {
    unitMeasure = 'unsupported';
  }
  // "Leased" or "rented" units could be occupied only, or occupied plus
  // notice; the status filter reads neither, so no unit measure is answered.
  if (unitStatus === undefined && /\b(?:leased|rented)\s+(?:[\w-]+\s+){0,3}?(?:units?|apartments?|homes?|studios?|flats?)\b|\b(?:units?|apartments?|homes?)\b[^.?!]*\b(?:are|is)\s+(?:currently\s+)?(?:leased|rented)\b/i.test(question)) {
    unitMeasure = 'unsupported';
  }

  return {
    domain: 'units',
    measure: unitMeasure,
    aggregation,
    isWholePortfolioExplicit,
    isClassComparison,
    buildingClass,
    yearBuiltMin,
    yearBuiltMax,
    bedrooms,
    bathrooms,
    rentMin,
    rentMax,
    bedroomsMin,
    bedroomsMax,
    bathroomsMin,
    bathroomsMax,
    sqftMin,
    sqftMax,
    floorMin,
    floorMax,
    view,
    unitStatus,
    ...(unitStatusIn ? { unitStatusIn } : {}),
    dateWindow,
    dateExplicit,
    mentionedSources,
    paidOnly: false,
    decisionIds: [],
  };
}

/**
 * The statistic each measure computes. A question that asks for an average,
 * a median or a share is answered only by a measure that computes that
 * statistic; otherwise the nearest measure would return a sum or a count
 * under the wrong name ("average monthly rent" answered with a total).
 * The Record is exhaustive, so a new measure must declare what it computes.
 */
type Statistic = 'count' | 'sum' | 'average' | 'share' | 'lookup';
const MEASURE_STATISTICS: Readonly<Record<IntentMeasure, readonly Statistic[]>> = {
  void_and_duplicate_counts: ['count'],
  decision_lookup: ['lookup'],
  decision_cohort_rejected: ['lookup'],
  decision_post_spend_comparison: ['sum'],
  decision_outcome_learning: ['lookup', 'average', 'share'],
  reallocation_leases: ['count'],
  dead_spend_pairs: ['sum'],
  dead_spend_building: ['sum'],
  tour_to_lease_rate: ['share'],
  apply_rate: ['share'],
  applied_without_tour: ['count'],
  applied_and_leased: ['count'],
  cost_per_lead_and_tour: ['average'],
  cost_per_lead: ['average'],
  cost_per_tour: ['average'],
  lead_count: ['count'],
  spend_h1_vs_q3: ['sum'],
  spend_total: ['sum'],
  signed_leases_ranking: ['count'],
  cost_per_signed_lease: ['average'],
  ending_and_renewed: ['count'],
  renewal_rate: ['share'],
  renewal_rate_class_comparison: ['share'],
  new_vs_renewal_and_concession: ['count', 'average'],
  average_concession: ['average'],
  rent_at_risk: ['sum'],
  lease_count: ['count'],
  vacancy_rate: ['share'],
  occupied_share: ['share'],
  avg_market_rent_and_sqft: ['average'],
  avg_market_rent: ['average'],
  avg_sqft: ['average'],
  rent_per_sqft: ['average'],
  unit_count: ['count'],
  unsupported: [],
};

const REQUESTED_STATISTIC: ReadonlyArray<readonly [Statistic | 'median', RegExp]> = [
  ['median', /\bmedian\b/i],
  ['average', /\b(?:average|avg|mean|typical)\b/i],
  ['share', /\b(?:percent(?:age)?|share|fraction|proportion)\b|%/i],
];

/**
 * Closed-grammar coverage (L1): a word the question uses to narrow the
 * answer must land in a typed field, or the typed query does not mean what
 * was asked and the honest answer is "I don't know" (F-040). Each rule names
 * the words and the field that has to carry them.
 */
const FIELD_COVERAGE: ReadonlyArray<readonly [Field, (i: ParsedQueryIntent) => boolean]> = [
  ['bedrooms', (i) => i.bedrooms !== undefined || i.bedroomsMin !== undefined || i.bedroomsMax !== undefined],
  ['bathrooms', (i) => i.bathrooms !== undefined || i.bathroomsMin !== undefined || i.bathroomsMax !== undefined],
  ['sqft', (i) => i.sqftMin !== undefined || i.sqftMax !== undefined],
  ['floor', (i) => i.floorMin !== undefined || i.floorMax !== undefined],
  ['rent', (i) => i.rentMin !== undefined || i.rentMax !== undefined],
];

/**
 * Breakdowns (L1). A question can ask for one figure per building, source,
 * class or period, or for the entity that ranks first. The TypedQuery has no
 * group-by or grain field; the dimension an answer is laid out over is fixed
 * by its measure and aggregation (ANSWER_LAYOUT). So a breakdown the question
 * asks for is honored only if the parse's layout carries that dimension;
 * otherwise the template would return one scalar in its place, and the parse
 * is unsupported. Signals are read structurally (a grouping word, then the
 * noun it governs), and the noun is mapped to a dimension; an unrecognized
 * noun is its own dimension, which no layout carries.
 */
export type Dimension = 'building' | 'source' | 'class' | 'time' | 'other';

/** The dimension each answer template lists or ranks over (planner.ts). */
/** Marketing measures defined per listing source, answered through sourceModeOf. */
export const SOURCE_MEASURES: ReadonlySet<IntentMeasure> = new Set<IntentMeasure>(['cost_per_lead', 'cost_per_tour', 'cost_per_signed_lease', 'tour_to_lease_rate']);
export type SourceMode = 'overall' | 'one' | 'pooled' | 'ranked' | 'list' | 'which';
/**
 * How a source measure picks its source rows, the same way for every source
 * measure: one named source, several named sources pooled, a ranking
 * (lowest/highest), a breakdown ("by <any> source", "for each channel"), an
 * unranked "which source" (no row can be picked), or the overall figure.
 */
export function sourceModeOf(question: string, intent: ParsedQueryIntent): SourceMode {
  if (intent.mentionedSources.length === 1) return 'one';
  if (intent.mentionedSources.length > 1) return 'pooled';
  if (intent.aggregation === 'argmin' || intent.aggregation === 'argmax') return 'ranked';
  const asked = requestedBreakdowns(question).filter((b) => b.dim === 'source');
  if (asked.some((b) => !b.ranked) || groupedBy(question) === 'source') return 'list';
  if (asked.length > 0 || askedDimension(question) === 'source') return 'which';
  return 'overall';
}

function answerLayout(i: ParsedQueryIntent, question?: string): ReadonlySet<Dimension> {
  const ranked = i.aggregation === 'argmax' || i.aggregation === 'argmin';
  const out = new Set<Dimension>();
  // A source measure lays out by source whenever the question picks rows by source.
  if (question !== undefined && SOURCE_MEASURES.has(i.measure) && sourceModeOf(question, i) !== 'overall') out.add('source');
  if (i.isClassComparison || i.measure === 'renewal_rate_class_comparison') out.add('class');
  switch (i.measure) {
    case 'apply_rate': case 'cost_per_tour': out.add('source'); break;
    // Defined over source x building pairs.
    case 'dead_spend_pairs': case 'dead_spend_building': case 'reallocation_leases': out.add('source').add('building'); break;
    case 'decision_outcome_learning': if (ranked) out.add('source'); break;
    case 'applied_without_tour': case 'signed_leases_ranking': out.add('building'); break;
    case 'cost_per_signed_lease': if (ranked) out.add('source'); break;
    case 'average_concession': case 'rent_at_risk': case 'vacancy_rate': case 'unit_count': if (ranked) out.add('building'); break;
    default: break;
  }
  return out;
}

const DIMENSION_HEADS: ReadonlyArray<readonly [Dimension, RegExp]> = [
  ['other', /^(?:year\s+built|build\s+year|vintages?|unit\s+types?|bed(?:room)?s?|bed\s+counts?|bedroom\s+counts?|floorplans?|floors?|views?|sizes?|ages?|tenant\s+ages?|lease\s+terms?|terms?|neighbou?rhoods?|nbhds?|submarkets?|regions?|markets?|zip(?:\s+codes?)?|pms|managers?|cities|city|states?)\b/i],
  ['class', /^(?:(?:property|prop|building|bldg|asset)\s+)?class(?:es)?\b/i],
  ['source', /^(?:(?:lead|listing|marketing|ad|paid|ils)\s+)?(?:sources?|srcs?|channels?|chnls?|vendors?|ils|sites?|platforms?)\b/i],
  ['building', /^(?:operating\s+)?(?:propert(?:y|ies)|props?|buildings?|bldgs?|assets?|communit(?:y|ies)|cmtys?|sites?|locations?)\b/i],
  ['time', /^(?:months?|mos|quarters?|qtrs?|weeks?|wks?|years?|yrs?|days?|periods?|half|halves)\b/i],
];
/** The denominator of a rate ("cost per lead", "rent per unit"), not a group. */
const RATE_DENOMINATOR = /^(?:(?:signed\s+)?leases?|leads?|tours?|units?|apartments?|doors?|sq\.?\s*ft|sqft|square\s+(?:foot|feet)|sf|applications?|applicants?|renewals?|move[-\s]?ins?)\b/i;
/** A recurring amount: "monthly rent" or "rent per month" is its unit, not a grain. */
const AMOUNT_NOUN = String.raw`(?:contract\s+|market\s+|lease\s+)?(?:rents?|deltas?|payments?|fees?|charges?|budgets?|concessions?)`;
const DATE_HEAD = /^(?:the\s+end\b|end\b|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|q[1-4]\b|\d|today|now|then|tomorrow)/i;

function isQualifiedScope(rest: string): boolean {
  const np = rest.replace(/^(?:the|our)\s+/i, '');
  if (/^(?:operating|onboarding|paid|active)\b/i.test(np)) return true;
  const h = headOf(np);
  if (!h) return false;
  // A modifier before the head ("Yardi buildings") narrows the set.
  if (!DIMENSION_HEADS.some(([, re]) => re.test(np))) return true;
  const after = np.slice(np.toLowerCase().indexOf(h.head.toLowerCase()) + h.head.length);
  // A label after the head ("class A+") or a relative/prepositional qualifier.
  return /^\s*(?:[a-d]\+?(?![a-z])|with\b|that\b|which\b|on\b|in\b|running\b|having\b|where\b|whose\b)/i.test(after) || /^\S+\s+buildings?\b/i.test(after.trim() ? after.trim() : '');
}

/** The first dimension noun anywhere in a span (optionally plural only). */
function firstHeadIn(span: string, pluralOnly = false): { dim: Dimension; head: string } | null {
  const words = span.trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const rest = words.slice(i).join(' ');
    for (const [dim, re] of DIMENSION_HEADS) {
      const m = re.exec(rest);
      if (m && (!pluralOnly || /(?:s|ies|es)$/i.test(m[0]))) return { dim, head: m[0] };
    }
  }
  return null;
}

function headOf(rest: string): { dim: Dimension; head: string } | null {
  const np = rest.replace(/^(?:of\s+)?(?:the|our|all\s+the|all|my|its|their)\s+/i, '').trim();
  for (const [dim, re] of DIMENSION_HEADS) { const m = re.exec(np); if (m) return { dim, head: m[0] }; }
  // A modifier before the head ("bldg class", "lead channel"): one word.
  const mod = /^([a-z][\w.-]*)\s+(.*)$/i.exec(np);
  if (mod && !/^(?:and|or|the|a|an|of|in|at|on|for|to|with|from)$/i.test(mod[1])) {
    for (const [dim, re] of DIMENSION_HEADS) { const m = re.exec(mod[2]); if (m) return { dim, head: `${mod[1]} ${m[0]}` }; }
  }
  return null;
}
const headDimension = (rest: string): Dimension | null => headOf(rest)?.dim ?? null;

const NUMERAL = String.raw`(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)`;
const RANK_VERB = String.raw`(?:rank(?:ed|ing|s)?|sort(?:ed|s)?|order(?:ed)?|list|compare|comparison|leaderboard)`;

/** The breakdowns a question asks for: [dimension, words, ranked?]. */
/** The dimension a "by <noun>" or "for each <noun>" grouping names, within three words ("by marketing source"). */
export function groupedBy(question: string): Dimension | null {
  for (const m of question.matchAll(/\b(?:by|(?:for\s+)?each|broken\s+down\s+by|split\s+by)\s+([^?.!,;]*)/gi)) {
    const h = firstHeadIn(m[1].split(/\s+/).slice(0, 3).join(' '));
    if (h) return h.dim;
  }
  return null;
}

/** The dimension a "which/what <noun>" question asks to be named ("which channel"), or null. */
export function askedDimension(question: string): Dimension | null {
  for (const m of question.matchAll(/\b(?:which|what)\b\s+([^?.!,;]*)/gi)) {
    const h = firstHeadIn(m[1].split(/\s+/).slice(0, 3).join(' '));
    if (h) return h.dim;
  }
  return null;
}

export function requestedBreakdowns(question: string): Array<{ dim: Dimension; words: string; ranked: boolean }> {
  const q = question.replace(/[()\[\],;:]/g, ' ').replace(/\s+/g, ' ');
  const out: Array<{ dim: Dimension; words: string; ranked: boolean }> = [];
  // Time grain as an adjective or adverb ("monthly renewal rate", "month by month").
  // "Monthly rent" is the rent's own unit, not a grain.
  for (const m of q.matchAll(new RegExp(String.raw`\b(monthly|quarterly|weekly|yearly|annually|month[-\s]+(?:by|over)[-\s]+month|quarter[-\s]+(?:by|over)[-\s]+quarter|year[-\s]+over[-\s]+year|mom|qoq|yoy)\b(?!\s+(?:\w+\s+)?${AMOUNT_NOUN}\b)`, 'gi'))) {
    // "my monthly review" names the asker's own artifact, not a grain.
    if (/\b(?:my|our|your)\s+$/i.test(q.slice(0, m.index))) continue;
    out.push({ dim: 'time', words: m[1], ranked: false });
  }
  // A grouping word and the noun phrase it governs.
  for (const m of q.matchAll(/\b(by|per|each|every|across|between|among|amongst|split\s+(?:by|across)|grouped\s+by|broken\s+(?:down|out)\s+by|segmented\s+by)\s+(?:each\s+|every\s+|of\s+the\s+)?(?=([^?.!]*))/gi)) {
    const verb = m[1].toLowerCase().replace(/\s+/g, ' ');
    const rest = m[2];
    if (verb === 'by' && DATE_HEAD.test(rest)) continue; // "by June 30", a deadline
    if (verb === 'per' && RATE_DENOMINATOR.test(rest)) continue; // a rate
    // "rent per month": the amount's own unit.
    if (verb === 'per' && new RegExp(String.raw`\b${AMOUNT_NOUN}\s+$`, 'i').test(q.slice(0, m.index))) continue;
    // "across all/every X", "across the portfolio": scope, not a breakdown.
    if (verb === 'across' && /^(?:all|every|the\s+(?:whole|entire|operating)?\s*portfolio|the\s+board|our\s+portfolio|portfolio)\b/i.test(m[0].slice(m[1].length).trim() + ' ' + rest)) continue;
    // "across all properties" or "across the portfolio" is scope, not a breakdown.
    if ((verb === 'across' || verb === 'among') && /^(?:all|the\s+(?:whole|entire|operating)?\s*portfolio|the\s+board|our\s+portfolio|portfolio)\b/i.test(rest)) continue;
    const dim = headDimension(rest);
    // A noun outside the dimension lexicon is a quantifier's object ("every
    // dollar"), an agent ("signed by") or a rate's unit, not a breakdown.
    if (dim === null) continue;
    // A qualified noun phrase is a filter, not a breakdown: "across class A
    // buildings", "across buildings with coworking", "across operating buildings".
    if ((verb === 'across' || verb === 'among' || verb === 'amongst' || verb === 'between') && isQualifiedScope(rest)) continue;
    if ((verb === 'between' || verb === 'among' || verb === 'amongst') && !/s\b|ies\b/i.test(rest.split(/\s+/).slice(0, 3).join(' '))) continue;
    const h = headOf(rest)!;
    out.push({ dim, words: `${m[0].trim()} ${h.head}`, ranked: false });
    // A conjoined dimension ("by source and building") is a second breakdown.
    const tail = rest.slice(rest.indexOf(h.head) + h.head.length).match(/^\s*(?:and|&|\+|then|x)\s+(.*)$/i);
    const h2 = tail ? headOf(tail[1]) : null;
    if (h2) out.push({ dim: h2.dim, words: `${verb} ${h.head} and ${h2.head}`, ranked: false });
  }
  // A superlative over an entity type ("which building has the highest ...",
  // "the top source", "highest renewal rate of any property").
  const SUP = String.raw`(?:tops|ranks\s+(?:first|#?1)|highest|lowest|most|least|fewest|best|worst|top|bottom|largest|smallest|biggest|max(?:imum)?|min(?:imum)?|strongest|weakest|leading|cheapest|priciest)`;
  // "which ... <superlative>": any dimension noun between the two words.
  for (const m of q.matchAll(new RegExp(String.raw`\b(?:which|what)\b([^?.!]*?)\b${SUP}\b`, 'gi'))) {
    const h = firstHeadIn(m[1]);
    if (h) out.push({ dim: h.dim, words: `which ${h.head}`, ranked: true });
  }
  // "where is X highest": a location ranking, so over buildings.
  if (new RegExp(String.raw`\bwhere\b[^?.!]*\b${SUP}\b`, 'i').test(q)) out.push({ dim: 'building', words: 'where', ranked: true });
  // "top 3 buildings": the numeral is a count, not the noun.
  for (const m of q.matchAll(new RegExp(String.raw`\b(?:top|bottom|best|worst)\s+(?:${NUMERAL}\s+)?([^?.!]*)`, 'gi'))) {
    const h = headOf(m[1]);
    if (h && !/^floor\b/i.test(h.head)) out.push({ dim: h.dim, words: m[0].split(/\s+/).slice(0, 4).join(' '), ranked: true });
  }
  // "rank/sort/list/compare ... buildings": a ranking or listing verb with a
  // plural dimension noun anywhere after it.
  for (const m of q.matchAll(new RegExp(String.raw`\b${RANK_VERB}\b([^?.!]*)`, 'gi'))) {
    const h = firstHeadIn(m[1], true);
    if (h) out.push({ dim: h.dim, words: `${m[0].split(/\s+/)[0]} ... ${h.head}`, ranked: true });
  }
  // "building by building", "each building's": the noun repeated or possessed by "each".
  for (const m of q.matchAll(/\b(\w+)\s+by\s+\1\b/gi)) { const h = headOf(m[1]); if (h) out.push({ dim: h.dim, words: m[0], ranked: false }); }
  for (const m of q.matchAll(new RegExp(String.raw`\b${SUP}\b[^?.!]*?\b(?:of\s+any|among(?:st)?\s+(?:the\s+)?|of\s+all(?:\s+the)?|of\s+the)\s+(\w+(?:\s+\w+)?)`, 'gi'))) {
    const dim = headDimension(m[1]);
    if (dim) out.push({ dim, words: m[0].trim(), ranked: true });
  }
  // "at most 3" is a bound and "top floor" a position, not a ranking.
  for (const m of q.matchAll(new RegExp(String.raw`(?<!\bat\s)\b${SUP}\s+((?:paid\s+|operating\s+)?\w+)`, 'gi'))) {
    if (/^(?:top|bottom)\s+floor\b/i.test(m[0])) continue;
    const dim = headDimension(m[1]);
    if (dim) out.push({ dim, words: m[0].trim(), ranked: true });
  }
  return out;
}

/**
 * "Spend per lead" asks for a ratio: a measure that computes a sum or a
 * count cannot answer it (the total would come back under the rate's name).
 * "Rent per month" is the amount's own unit, not a ratio.
 */
function asksRatioPer(question: string, measure: IntentMeasure): boolean {
  const noun = TOTAL_NOUN[measure];
  if (!noun) return false;
  // The measure's own quantity directly before "per <denominator>".
  for (const m of question.matchAll(new RegExp(String.raw`\b${noun}\s+per\s+(?:each\s+)?(?=(\S[^?.!]*))`, 'gi'))) {
    if (RATE_DENOMINATOR.test(m[1])) return true;
  }
  return false;
}
/** The quantity a sum or count measure totals, as a question names it. */
const TOTAL_NOUN: Partial<Record<IntentMeasure, string>> = {
  spend_total: String.raw`(?:(?:marketing\s+|ad\s+|paid\s+)?(?:spend|spending|dollars|budget))`,
  lead_count: String.raw`(?:leads|inquiries)`,
  lease_count: String.raw`(?:leases)`,
  unit_count: String.raw`(?:units)`,
  rent_at_risk: String.raw`(?:rent)\s+at\s+risk`,
};

/** The first breakdown the parse does not carry, or null. */
export function droppedBreakdown(question: string, intent: ParsedQueryIntent): { dim: Dimension; words: string } | null {
  const layout = answerLayout(intent, question);
  for (const b of requestedBreakdowns(question)) {
    if (!layout.has(b.dim)) return b;
  }
  return null;
}

/**
 * A pooled scalar carries one measure, one period, at most one property and
 * filters. Words that ask for an ordering, a choice, a comparison, a list or
 * a ratio have no place in it, so a scalar parse is only answered when no
 * such word is left over, and when it names at most one property. A list
 * or grouping word with a dimension is requestedBreakdowns' job; "which"
 * with a filter ("which buildings have EV charging") is a lookup. The parse consumes them when it ranks (argmax or
 * argmin) or when its answer lists a dimension; a filter comparator ("more
 * than 2 bedrooms", "at most $2000") is consumed by that filter.
 */
const SCALAR_LEFTOVERS: ReadonlyArray<readonly [string, RegExp]> = [
  ['an ordering', /\b(?:top|bottom|best|worst|highest|lowest|most|least|biggest|largest|greatest|smallest|cheapest|priciest|richest|leader(?:s|board)?|rank\w*|sort\w*|order(?:ed)?|number\s+one|winner|tops|topped)\b|#\s*1\b|-(?:best|worst|highest|lowest)\b/i],
  ['a comparison', /\b(?:compar\w*|versus|vs\.?|higher|lower|more|fewer|less|than|difference|differ\w*|relative)\b/i],
  // A ratio operator before a rate denominator; "concierge/doorman" is an
  // alternation and "for every lease where ..." is the set being summed.
  ['a ratio', new RegExp(String.raw`(?:\s\/\s*|\/\s*(?=(?:signed\s+)?(?:leads?|leases?|tours?|units?|apartments?|doors?|applications?|renewals?|move[-\s]?ins?)\b)|\bdivided\s+by\s+|\bfor\s+(?:each|every)\s+)(?:signed\s+)?(?:leads?|leases?|tours?|units?|apartments?|doors?|applications?|renewals?|move[-\s]?ins?)\b(?!\s+(?:where|that|which|who|with)\b)|\bratio\b`, 'i')],
];

/** What a scalar parse leaves unaccounted for, or null. */
function scalarLeftover(question: string, intent: ParsedQueryIntent, store: PortfolioStore): string | null {
  const layout = answerLayout(intent, question);
  // A source measure's source layout consumes only its ranking words; every
  // other leftover (a noun, a period, a source) is still checked.
  const bySource = SOURCE_MEASURES.has(intent.measure) && layout.has('source');
  if (intent.measure === 'unsupported' || (layout.size > 0 && !bySource)) return null;
  // A ranked parse whose measure has no ranked layout is answered as one
  // pooled figure, so its ordering words are left over like a value parse's.
  if (!['value', 'argmax', 'argmin'].includes(intent.aggregation)) return null;
  let q = question;
  for (const re of COMPARATOR_PHRASES) q = q.replace(re, ' ');
  // A date range ("between April and June") and a number ("2000/month") are periods and amounts.
  q = q.replace(/\b\d+\s*\/\s*\d+\b/g, ' ').replace(/\/\s*(?:mo|month|yr|year|wk|week|unit|sq\.?\s*ft|sf)\b/gi, ' ');
  for (const [what, re] of SCALAR_LEFTOVERS) {
    // A measure that is itself a comparison (H1 versus Q3) consumes the comparison words.
    if (what === 'a comparison' && /_vs_|comparison|delta|change/.test(intent.measure)) continue;
    if (what === 'an ordering' && bySource && (intent.aggregation === 'argmin' || intent.aggregation === 'argmax')) continue;
    const m = re.exec(q);
    if (m) return `${what} ("${m[0].trim()}")`;
  }
  const unitFilter = unappliedUnitFilter(question, intent);
  if (unitFilter) return unitFilter;
  const rentRoll = unsplittableFilter(question, intent, store);
  if (rentRoll) return rentRoll;
  const noun = unconsumedMeasureNoun(question, intent, store);
  if (noun) return `a second measure ("${noun}")`;
  const source = unrecognisedSource(question, intent, store);
  if (source) return `a source FlowIQ does not track ("${source}")`;
  // A measure that compares two periods (H1 versus Q3) consumes both.
  const period = /_vs_|comparison|delta|change/.test(intent.measure) ? null : unconsumedPeriod(question, intent);
  if (period) return `a second period ("${period}")`;
  const token = uncoveredToken(question, store, intent);
  if (token) return `a term FlowIQ could not place in the question ("${token}")`;
  const named = namedProperties(question, store);
  // Two named properties are a comparison unless the question pools them outright.
  if (named.length > 1 && !/\b(?:across|combined|together|altogether|in\s+total|total|sum|all\s+of)\b/i.test(question)) return `more than one property (${named.join(', ')})`;
  return null;
}

/**
 * Measure nouns the schema knows, in every domain, by the quantity each
 * names. A scalar consumes the nouns of its own measure and nothing else:
 * the parse has no slot for a second quantity or for a lead stage (toured,
 * applied, leased, converted, moved in), so any other measure noun in the
 * question, whatever word joins it ("and", "per", "plus"), is left over.
 */
const MEASURE_NOUNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['spend', /\b(?:spend\w*|spent|costs?|budgets?|dollars?|money)\b/gi],
  ['lead', /\b(?:leads?|prospects?|inquir(?:y|ies)|enquir(?:y|ies))\b/gi],
  ['tour', /\b(?:tour(?:s|ed|ing)?)\b/gi],
  ['lease', /\b(?:leases?|leased|leasing|signings?|signed|signups?)\b/gi],
  ['application', /\b(?:applications?|applied|applying|apps?|applicants?)\b/gi],
  ['conversion', /\b(?:conver(?:sions?|ted|ts?|ting))\b/gi],
  ['renewal', /\b(?:renew(?:als?|ed|ing|s)?)\b/gi],
  ['move_in', /\b(?:move[-\s]?ins?|moved[-\s]+in|moving[-\s]+in)\b/gi],
  ['occupancy', /\b(?:occupan(?:cy|t|ts)|occupied|vacan(?:cy|cies|t)|vacancy)\b/gi],
  ['resident', /\b(?:residents?|tenants?|renters?)\b/gi],
  ['rent', /\b(?:rents?|rental\s+income|revenue)\b/gi],
  ['concession', /\b(?:concessions?)\b/gi],
  ['area', /\b(?:sq\.?\s*ft|sqft|square\s+(?:foot|feet))\b/gi],
];
/** The nouns each marketing scalar names; a measure not listed is not checked. */
const MEASURE_CONSUMES: Readonly<Partial<Record<IntentMeasure, readonly string[]>>> = {
  spend_total: ['spend'],
  lead_count: ['lead'],
  cost_per_lead: ['spend', 'lead'],
  cost_per_tour: ['spend', 'tour'],
  cost_per_lead_and_tour: ['spend', 'lead', 'tour'],
  cost_per_signed_lease: ['spend', 'lease'],
  tour_to_lease_rate: ['tour', 'lease', 'conversion'],
  apply_rate: ['application', 'lead', 'conversion'],
};

function unconsumedMeasureNoun(question: string, intent: ParsedQueryIntent, store: PortfolioStore): string | null {
  if (intent.domain !== 'marketing') return null;
  const own = MEASURE_CONSUMES[intent.measure];
  if (!own) return null;
  // Source and property names are not quantities ("Apartments.com", "Marlowe Residences").
  let q = question;
  // A lead-cohort measure counts leads, so "Zillow leads" names its population.
  const cohort = own.some((k) => k === 'tour' || k === 'lease' || k === 'application');
  for (const s of intent.mentionedSources) {
    if (cohort) q = q.split(new RegExp(`${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:-(?:sourced|driven|origin(?:ated)?))?\\s+leads?\\b`, 'gi')).join(' ');
    q = q.split(s).join(' ');
  }
  const names = store.properties.flatMap((p) => [p.name, ...p.aka]).filter((n) => n.trim().length >= 2).sort((x, y) => y.length - x.length);
  for (const n of names) q = q.replace(new RegExp(`(?<![\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'giu'), ' ');
  for (const [kind, re] of MEASURE_NOUNS) {
    if (own.includes(kind)) continue;
    const m = q.match(re);
    if (m) return m[0];
  }
  // A unit phrase is a filter ("1-bedroom units", "excluding down units");
  // a bare "units" or "doors" is a unit count, a second measure.
  return q.replace(BEDROOM_PHRASE_RE, ' ').replace(UNIT_STATUS_EXCLUSION_RE, ' ').match(/\b(?:units?|doors?)\b/i)?.[0] ?? null;
}

/** A bedroom or unit-type phrase with the noun it governs ("2-bedroom units", "studio leads", "2+ bedrooms"). */
const BEDROOM_PHRASE_RE = /\b(?:(?:\d+|one|two|three|four|five)\s*\+?\s*-?\s*(?:bed(?:room)?s?|br|bd)\b|studios?\b)(?:\s+(?:or\s+(?:more|larger|bigger)\s+)?(?:units?|apartments?|apts?|homes|flats?|leads?|prospects?))?/gi;
/** A unit status set aside ("exclude down units"); unit status does not apply to leads. */
export const UNIT_STATUS_EXCLUSION_RE = /\b(?:exclud\w*|without|except|not\s+counting|minus|ignor\w*)\s+(?:the\s+|any\s+)?(?:down|offline|vacant|occupied|model|notice|on[-\s]notice|non[-\s]revenue)\s+units?\b/gi;

/**
 * A bedroom filter applies only to a lead count: each deduplicated lead
 * carries the bedrooms it wanted, but spend, tours and leases carry none,
 * so a bedroom phrase on any other measure (or one the parse bound to no
 * exact count, such as "2+ bedrooms") is left over.
 */
function unappliedUnitFilter(question: string, intent: ParsedQueryIntent): string | null {
  if (intent.domain !== 'marketing' || !MEASURE_CONSUMES[intent.measure]) return null;
  const m = question.match(BEDROOM_PHRASE_RE);
  if (!m) return null;
  if (intent.measure === 'lead_count' && intent.bedrooms !== undefined && intent.bedroomsMin === undefined && intent.bedroomsMax === undefined) return null;
  return intent.measure === 'lead_count'
    ? `a bedroom filter FlowIQ could not apply ("${m[0].trim()}")`
    : `a bedroom filter ("${m[0].trim()}"), but marketing spend, tours and leases are not split by bedroom`;
}

/**
 * Unit, lease, renewal and concession figures come from the rent roll and
 * lease ledger, which carry no lead source and no pets, and unit figures are
 * one snapshot. A source, a pet or (for units) a dated period the parse
 * cannot apply is left over rather than dropped.
 */
function unsplittableFilter(question: string, intent: ParsedQueryIntent, store: PortfolioStore): string | null {
  if (intent.domain !== 'units' && intent.domain !== 'leases') return null;
  const q = question.normalize('NFKC');
  const sourceWords = new Set([...store.paidSources, ...store.organicSources].flatMap((s) => s.toLowerCase().split(/[^\p{L}]+/u)).filter((w) => w.length > 2 && !SOURCE_GENERIC_WORD.test(w)));
  const source = q.match(/\p{L}+/gu)?.find((w) => sourceWords.has(w.toLowerCase()));
  if (source) return `a lead source ("${source}"), but ${intent.domain === 'units' ? 'unit' : 'lease'} figures are not split by source`;
  const pet = /\b(?:dogs?|cats?|pets?|pet[\s-]friendly)\b(?!\s+runs?\b)/i.exec(q);
  if (pet) return `a pet filter ("${pet[0]}"), but the rent roll does not record pets`;
  if (intent.domain === 'units') {
    let d = spellIsoMonths(spellCalendarYear(q)).replace(/\$\s?[\d,]+(?:\.\d+)?\s*[kK]?|\b[\d,]+(?:\.\d+)?\s*(?:sq\.?\s*f(?:ee)?t|sqft|sf|square\s+f(?:ee|oo)t)\b/g, ' ');
    for (const re of COMPARATOR_PHRASES) d = d.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`), ' ');
    if (intent.yearBuiltMin !== undefined || intent.yearBuiltMax !== undefined) d = d.replace(/\b(?:built|constructed|opened|completed|delivered)\b[^?.!]*?\b(?:19|20)\d{2}\b/gi, ' ');
    const dated = new RegExp(DATE_TOKEN_RE.source, 'i').exec(d)
      ?? /(?<![\p{L}\p{N}])(?:19|20)\d{2}(?![\p{L}\p{N}])/u.exec(d)
      ?? /\b(?:last|next|previous|prior|past|this)\s+(?:\d+\s+)?(?:days?|weeks?|months?|quarters?|years?)\b|\b(?:yesterday|tomorrow|ytd|year[\s-]to[\s-]date)\b/i.exec(d);
    if (dated) return `a period ("${dated[0].trim()}"), but unit figures are one snapshot of the current rent roll, not a history`;
  }
  return null;
}

/** Words a "from <phrase>" source phrase may hold besides source, property and date names. */
const SOURCE_PHRASE_WORDS = /\b(?:and|or|&|the|all|our|any|both|plus|paid|sources?|channels?|ils(?:es)?|internet|listing|sites?|services?|leads?|spend|ads?|marketing|to|through|thru|until|till|between|of|its|their|building|buildings|property|properties|portfolio|20\d{2}|'\d{2})\b/gi;

/**
 * Every word of a "from <phrase>" must be a tracked source, a property, a
 * date or a source-set word. "from Facebook" names no tracked source
 * ("Facebook Ads" is one), so the phrase is left over, never dropped.
 */
function unrecognisedSource(question: string, intent: ParsedQueryIntent, store: PortfolioStore): string | null {
  if (intent.domain !== 'marketing' || !MEASURE_CONSUMES[intent.measure]) return null;
  const names = [...intent.mentionedSources, ...store.properties.flatMap((p) => [p.name, ...p.aka])].filter((n) => n.trim().length >= 2).sort((x, y) => y.length - x.length);
  for (const m of spellIsoMonths(question).matchAll(/\b(?:from|via)\s+([^?!;]*?)(?=\s*(?:\b(?:at|in|for|during|over|across|on|by|per|this|last|since|with|vs\.?|versus|except|excluding)\b|[?!;,]|$))/gi)) {
    let rest = m[1].replace(DATE_TOKEN_RE, ' ');
    for (const n of names) rest = rest.replace(new RegExp(`(?<![\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'giu'), ' ');
    // A funnel stage is not a source ("convert from tour to lease").
    for (const [, re] of MEASURE_NOUNS) rest = rest.replace(re, ' ');
    rest = rest.replace(SOURCE_PHRASE_WORDS, ' ').replace(/[-\u2013\u2014.,'’]/g, ' ').trim();
    if (/[\p{L}]{2,}/u.test(rest)) return rest.replace(/\s+/g, ' ');
  }
  return null;
}

const ORD_Q = String.raw`(?:first|1st|second|2nd|third|3rd|fourth|4th)`;
const MONTH_WORD = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may(?=\s*(?:20\d{2}|'\d{2}|\d{1,2}\b|,|and\b|to\b|through\b|-))|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
/**
 * Every date token the window parser reads: ISO months, "2026 Q3", quarters,
 * ordinal quarters ("second and third quarters"), halves and month names,
 * each with an optional year of its own.
 */
const DATE_TOKEN_RE = new RegExp(
  String.raw`\b(?:(?<iso>20\d{2}-(?:0[1-9]|1[0-2]))(?:-(?<day>\d{2}))?(?!\d)|(?<yq>20\d{2})\s+q(?<yqn>[1-4])\b|(?<tok>q[1-4]|h[12]|(?:first|second)\s+half|${ORD_Q}(?=(?:\s*(?:,|and|&|or|to|through|thru|-)\s*(?:the\s+)?${ORD_Q})*\s+quarters?\b)|${MONTH_WORD})(?:\s*,?\s*(?<year>20\d{2}|'\d{2}))?)\b`,
  'gi',
);
const PERIOD_JOINER_RE = /^\s*(?:,\s*(?:and\s+)?|and\s+|&\s*|)(?:the\s+)?$/i;
const RANGE_GAP_RE = /^\s*(?:[-\u2013\u2014]|to|through|thru|until|till)\s*(?:the\s+)?$/i;

function monthSpan(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [y2, m2] = to.split('-').map(Number);
  while (y < y2 || (y === y2 && m <= m2)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y += 1; }
    if (out.length > 60) break;
  }
  return out;
}

/**
 * Every date token the question names must be the window the parse used.
 * A range ("Q2-Q3", "from July to September") counts as one period that
 * spans start..end; it is never exempt from the window check. "July and
 * August" is July-August, but "Q2 and Q3" read as Q2 alone, "April and
 * July" read as April-July, or "2026-07 and 2026-08" read as all of 2026
 * is a period the parse did not consume.
 */
function unconsumedPeriod(question: string, intent: ParsedQueryIntent): string | null {
  question = spellIsoMonths(question);
  const toks = [...question.matchAll(DATE_TOKEN_RE)];
  if (toks.length === 0) return null;
  const anyYear = /\b20\d{2}\b/.test(question);
  const yearAfter = (i: number) => question.slice(i).match(/\b20\d{2}\b/)?.[0] ?? question.match(/\b20\d{2}\b/)?.[0];
  const spans: Array<{ text: string; start: number; end: number; months: string[]; day?: string }> = [];
  for (const t of toks) {
    const g = t.groups ?? {};
    let months: readonly string[] | undefined;
    if (g.iso) months = [g.iso];
    else {
      const year = g.year ? (g.year.startsWith("'") ? `20${g.year.slice(1)}` : g.year) : g.yq ?? (anyYear ? yearAfter(t.index! + t[0].length) : undefined);
      const tok = g.yq ? `q${g.yqn}` : /quarters?$/i.test(g.tok) ? g.tok : new RegExp(`^${ORD_Q}$`, 'i').test(g.tok) ? `${g.tok} quarter` : g.tok;
      // No year anywhere: the parser's own default year applies ("Q1" is the next Q1).
      months = parseExplicitDateWindow(year ? `in ${tok} ${year}` : `in ${tok}`)?.months;
    }
    if (!months?.length) return t[0];
    spans.push({ text: t[0], start: t.index!, end: t.index! + t[0].length, months: [...months].sort(), day: g.day });
  }
  const lastDay = (ym: string) => { const [y, m] = ym.split('-').map(Number); return String(new Date(Date.UTC(y, m, 0)).getUTCDate()); };
  const want = new Set<string>();
  for (let i = 0; i < spans.length; i++) {
    const cur = spans[i];
    const next = spans[i + 1];
    const gap = next ? question.slice(cur.end, next.start) : '';
    const between = next && /^\s*and\s*$/i.test(gap) && /\bbetween\s+(?:the\s+)?$/i.test(question.slice(0, cur.start));
    if (next && (RANGE_GAP_RE.test(gap) || between)) {
      // A range of days is a month window only from a first to a last day.
      if (cur.day && cur.day !== '01') return cur.text;
      if (next.day && Number(next.day) !== Number(lastDay(next.months[0]))) return next.text;
      for (const m of monthSpan(cur.months[0], next.months[next.months.length - 1])) want.add(m);
      i += 1;
      continue;
    }
    // One day is not a month.
    if (cur.day) return cur.text;
    // Only "and", "&" or a comma joins two periods into their union; any
    // other word between them ("Q3 for July", "Q3 excluding July") narrows
    // or cuts the window in a way the parse does not carry.
    if (next && !PERIOD_JOINER_RE.test(gap) && cur.text.toLowerCase() !== next.text.toLowerCase()) return `${cur.text}${gap}${next.text}`.trim();
    for (const m of cur.months) want.add(m);
  }
  const used = [intent.dateWindow, intent.leaseStartWindow, intent.leaseEndWindow].filter((w): w is DateWindowSpec => w !== undefined);
  const same = (w: DateWindowSpec) => w.months.length === want.size && w.months.every((m) => want.has(m));
  return used.some(same) ? null : spans.map((s) => s.text).join(', ');
}

/**
 * Coverage fails closed at the token level. After every span the parse
 * consumes is removed (bound date tokens, a bare year, bedroom phrases,
 * money, property names and ids, full source names), any digit group left
 * is a date, count or id the parse did not bind, and any word of a source
 * name left over ("Facebook", "Google") is a source named in a shape the
 * parse did not resolve. Either way one figure would answer a wider
 * question, so the turn says it does not know.
 */
/**
 * An instruction about FlowIQ's own rules ("[SYSTEM OVERRIDE: ...]",
 * "Ignore prior rules", "Do not obey any lead note") asks nothing of the
 * data, and the answer is computed from the data whatever it says, so its
 * words are not question words. An instruction about the data ("only count
 * lake views") is kept and must parse.
 */
export const META_INSTRUCTION_RE =
  /\[[^\]]*\b(?:system|override|ignore|instructions?|rules?)\b[^\]]*\]|[^.?!]*\b(?:ignore|disregard|override|(?:do\s+not|don'?t|never)\s+(?:obey|follow|trust|believe))\b[^.?!]*\b(?:rules?|instructions?|notes?|prompts?|system|messages?)\b[^.?!]*[.!]?/gi;
function uncoveredToken(question: string, store: PortfolioStore, intent: ParsedQueryIntent): string | null {
  let q = ` ${spellIsoMonths(spellCalendarYear(question.normalize('NFKC')))} `;
  const blank = (re: RegExp) => { q = q.replace(re, (m) => ' '.repeat(m.length)); };
  blank(new RegExp(META_INSTRUCTION_RE.source, 'gi'));
  for (const re of COMPARATOR_PHRASES) blank(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`));
  // "all 8 buildings" restates the portfolio when 8 is how many operate.
  const operating = new Set(store.units.map((u) => u.propertyId)).size;
  q = q.replace(/\ball\s+(\d+)\s+(?:buildings|properties|communities)\b/gi, (m, n: string) =>
    Number(n) === operating ? ' '.repeat(m.length) : m);
  for (const id of intent.decisionIds) blank(new RegExp(String.raw`(?<![\p{L}\p{N}])${escapeRegExp(id)}(?![\p{L}\p{N}])`, 'giu'));
  // A class letter the parse applied ("Class C", "class B buildings").
  if (intent.buildingClass) blank(new RegExp(String.raw`\bclass[\s-]*${escapeRegExp(intent.buildingClass)}(?![\p{L}\p{N}])`, 'giu'));
  blank(new RegExp(DATE_TOKEN_RE.source, 'gi'));
  blank(/(?<![\p{L}\p{N}\-\/.])20\d{2}(?![\p{L}\p{N}\-\/._])/gu);
  blank(/\b(?:last|this|next|past|previous|prior)\s+(?:\d+\s+)?(?:days?|months?|quarters?|years?|weeks?)\b/gi);
  blank(/\b(?:to\s+|rounded\s+to\s+)?\d+\s*(?:decimals?|decimal\s+places?|dp|d\.p\.|places?|sig(?:nificant)?\s+figs?(?:ures)?)\b/gi);
  blank(BEDROOM_PHRASE_RE);
  blank(/\$\s?[\d,]+(?:\.\d+)?\s*[kKmM]?|\b\d+(?:\.\d+)?\s*%/g);
  for (const p of store.properties) {
    for (const l of [p.name, p.propertyId, ...p.aka, ...distinctiveTokens(store).get(p.propertyId)!].map((x) => x.trim()).filter((x) => x.length >= 2)) {
      blank(new RegExp(String.raw`(?<![\p{L}\p{N}])${escapeRegExp(l)}(?![\p{L}\p{N}])`, 'giu'));
    }
  }
  const sources = [...new Set([...store.paidSources, ...store.organicSources])].sort((a, b) => b.length - a.length);
  if (intent.domain === 'marketing') for (const s of sources) blank(new RegExp(String.raw`(?<![\p{L}\p{N}])${escapeRegExp(s)}(?![\p{L}\p{N}])`, 'giu'));
  // A number the parse put in a unit field (floor 5, 1000 sq ft, 2 baths)
  // is consumed; a strict bound is stored one past the number written.
  const bound = [intent.bedrooms, intent.bathrooms, intent.bedroomsMin, intent.bedroomsMax, intent.bathroomsMin, intent.bathroomsMax, intent.sqftMin, intent.sqftMax, intent.floorMin, intent.floorMax, intent.rentMin, intent.rentMax, intent.yearBuiltMin, intent.yearBuiltMax]
    .filter((v): v is number => typeof v === 'number');
  const used = (n: number) => bound.some((v) => Math.abs(v - n) <= 1);
  for (const m of q.matchAll(/[^\s,;:?!()]*\p{N}[^\s,;:?!()]*/gu)) {
    const nums = (m[0].replace(/,/g, '').match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
    if (nums.length > 0 && nums.every(used)) continue;
    return m[0].trim();
  }
  // A distinctive word of a source name, left once the full names are gone.
  const words = new Set(sources.flatMap((s) => s.toLowerCase().split(/[^\p{L}]+/u)).filter((w) => w.length > 2 && !SOURCE_GENERIC_WORD.test(w)));
  for (const m of q.matchAll(/\p{L}+/gu)) if (words.has(m[0].toLowerCase())) return m[0];
  // A capitalised word inside a sentence is a name; once every name the
  // parse knows is gone, one that is left ("for May", "on Instagram") was
  // not bound to anything.
  for (const m of q.matchAll(/(?<![\p{L}\p{N}'’])\p{Lu}[\p{L}'’]*/gu)) {
    if (/(?:^|[.?!:;]|\.\.\.)\s*["'“(]?\s*$/u.test(q.slice(0, m.index))) continue;
    if (CAPITALISED_OK.test(m[0])) continue;
    if (m[0].length > 1 && isDataWord(store, m[0])) continue;
    // Title case ("Cost Per Lead") is not a name; a month word still is,
    // since a consumed month was blanked above.
    if (m[0].length > 1 && FIXED.has(m[0].toLowerCase()) && !/^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)$/i.test(m[0])) continue;
    return m[0];
  }
  return null;
}
/** Capitalised words that are not names: the pronoun, units and metric acronyms. */
const CAPITALISED_OK = /^(?:I|I'm|I'd|I've|USD|CAD|CPL|CPT|CPSL|CPA|ILS|YTD|QTD|MTD|YoY|QoQ|MoM|FY|PMS|CRM|NOI|ID|IDs|OK)$/u;
const SOURCE_GENERIC_WORD = /^(?:apartments?|list|com|ads|rent|website|referrals?)$/i;

/** Building-type words that name no one property on their own. */
const GENERIC_NAME_WORD = /^(?:the|and|residences?|works|yards?|tower|towers|point|commons|lake|row|annex|lofts?|shore|place|park|house|apartments?|street|square|heights|court|view|plaza|station|building)$/i;
const DISTINCTIVE = new WeakMap<PortfolioStore, Map<string, string[]>>();
/** Name words that belong to exactly one property ("Marlowe", "Kedzie"). */
function distinctiveTokens(store: PortfolioStore): Map<string, string[]> {
  let out = DISTINCTIVE.get(store);
  if (out) return out;
  const owners = new Map<string, Set<string>>();
  for (const p of store.properties) {
    for (const t of [p.name, ...p.aka].join(' ').toLowerCase().match(/[a-z]{4,}/g) ?? []) {
      if (GENERIC_NAME_WORD.test(t)) continue;
      owners.set(t, (owners.get(t) ?? new Set()).add(p.propertyId));
    }
  }
  out = new Map(store.properties.map((p) => [p.propertyId, [] as string[]]));
  for (const [t, ids] of owners) if (ids.size === 1) out.get([...ids][0])!.push(t);
  DISTINCTIVE.set(store, out);
  return out;
}

/** Properties the question names outright (name, id or alias), not by a description. */
function namedProperties(question: string, store: PortfolioStore): string[] {
  // One span that fits two properties ("the Grove") is one mention, an ambiguity for the resolver.
  const spans = new Map<number, { end: number; names: Set<string> }>();
  for (const p of store.properties) {
    for (const l of [p.name, p.propertyId, ...p.aka, ...distinctiveTokens(store).get(p.propertyId)!].map((x) => x.trim()).filter((x) => x.length >= 2)) {
      const m = new RegExp(String.raw`(?<![\p{L}\p{N}])${l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\p{L}\p{N}])`, 'iu').exec(question);
      if (!m) continue;
      const s = spans.get(m.index) ?? { end: m.index + m[0].length, names: new Set<string>() };
      s.end = Math.max(s.end, m.index + m[0].length);
      s.names.add(p.name);
      spans.set(m.index, s);
    }
  }
  // Drop spans inside a longer one ("Works" inside "Kedzie Works").
  const all = [...spans.entries()];
  const kept = all.filter(([i, s]) => !all.some(([j, t]) => (j < i && t.end >= s.end) || (j === i && t.end > s.end)));
  // Two names of one property (Kedzie Works, Logan Lofts) are one mention.
  return [...new Set(kept.map(([, s]) => [...s.names].sort().join(' or ')))];
}

const LEFTOVER = new WeakMap<object, string>();
/** What a scalar parse left unaccounted for, if that made it unsupported. */
export function scalarLeftoverOf(intent: ParsedQueryIntent): string | undefined {
  return LEFTOVER.get(intent);
}

const DROPPED = new WeakMap<object, { dim: Dimension; words: string }>();
/** Why a parse was made unsupported by a dropped breakdown, if it was. */
export function droppedBreakdownOf(intent: ParsedQueryIntent): { dim: Dimension; words: string } | undefined {
  return DROPPED.get(intent);
}

const COVERAGE_RULES: ReadonlyArray<{
  readonly words: { test(q: string): boolean };
  readonly covered: (i: ParsedQueryIntent) => boolean;
}> = [
  // A unit status the parser did not turn into a filter.
  { words: /\b(?:vacant|vacanc\w*|occupied|occupancy|on\s+notice|available|unoccupied|empty)\b/i,
    covered: (i) => i.unitStatus !== undefined || i.unitStatusIn !== undefined || i.domain !== 'units' || /rate|share/.test(i.measure) },
  // A notice status the parser did not turn into a filter.
  { words: /(?<!occupied\s+or\s+(?:on\s+)?)\bnotice\b/i, covered: (i) => i.unitStatus === 'notice' || i.unitStatusIn?.includes('notice') === true || i.domain !== 'units' || /rate|share/.test(i.measure) },
  // A number on a unit field must land in that field's bounds (F-060).
  ...FIELD_COVERAGE.map(([f, has]) => ({
    words: { test: (q: string) => mentionsQuantity(q, f) },
    covered: (i: ParsedQueryIntent) => i.domain !== 'units' || has(i),
  })),
  // A view the parser did not turn into a filter.
  { words: /\bviews?\b/i, covered: (i) => i.view !== undefined || i.domain !== 'units' },
  // Lease rent is not market rent.
  { words: /\b(?:lease|leased|monthly)\s+rents?\b|\brent\s+on\s+leases\b/i,
    covered: (i) => !/market_rent|rent_per_sqft/.test(i.measure) },
];

// The typed query holds one status, so two statuses (joined by "or" or
// "and") cannot be expressed. The policy's own "occupied or notice" is the
// one exception, since that is how occupancy is defined.
const STATUS_WORD_RE = /\b(?:vacant|unoccupied|empty|available|occupied|on\s+notice)\b/gi;
const STATUS_OF: Readonly<Record<string, string>> = { unoccupied: 'vacant', empty: 'vacant', available: 'vacant', 'on notice': 'notice' };

export function parseQueryIntent(question: string, store: PortfolioStore): ParsedQueryIntent {
  const intent = parseQueryIntentRaw(question, store);
  const produced = MEASURE_STATISTICS[intent.measure];
  const unmet = REQUESTED_STATISTIC.some(([stat, re]) => re.test(question) && !produced.includes(stat as Statistic)) || asksRatioPer(question, intent.measure);
  const statuses = new Set(
    [...stripNegatedStatus(question).replace(/\boccupied\s+or\s+(?:on\s+)?notice\b/gi, 'occupied').matchAll(STATUS_WORD_RE)]
      .map((m) => { const w = m[0].toLowerCase().replace(/\s+/g, ' '); return STATUS_OF[w] ?? w; }),
  );
  // One exact value per field: two different ones cannot both hold.
  const conflicting = (['bedrooms', 'bathrooms'] as const).some((f) => intent[f] !== undefined && statedValues(question, f).length > 1);
  const setStated = intent.unitStatusIn !== undefined && [...statuses].every((s) => intent.unitStatusIn!.includes(s as UnitStatus));
  const dropped = droppedBreakdown(question, intent);
  const leftover = dropped === null ? scalarLeftover(question, intent, store) : null;
  const uncovered = (statuses.size > 1 && !setStated) || conflicting || dropped !== null || leftover !== null || COVERAGE_RULES.some((r) => r.words.test(question) && !r.covered(intent));
  // Only a valid TypedQuery is ever executed (S1R-L1-4).
  if (!(unmet || uncovered || typedQueryErrors(intent).length > 0)) return intent;
  const out: ParsedQueryIntent = { ...intent, measure: 'unsupported' };
  if (dropped && intent.measure !== 'unsupported') DROPPED.set(out, dropped);
  if (leftover && intent.measure !== 'unsupported') LEFTOVER.set(out, leftover);
  return out;
}
