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
  | 'unit_count';

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
  readonly sqftMin?: number;
  readonly sqftMax?: number;
  readonly floorMin?: number;
  readonly floorMax?: number;
  readonly view?: string;
  readonly unitStatus?: UnitStatus;
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

export function parseSqftBounds(question: string): {
  sqftMin?: number;
  sqftMax?: number;
} {
  const minMatch =
    question.match(
      /\bsqft\s*(?:>=|≥|at\s+least|over|above)\s*(\d{3,5})\b/i,
    ) ??
    question.match(
      /\b(?:at\s+least|over|minimum\s+of)\s*(\d{3,5})\s*(?:sq\.?\s*ft\.?|square\s+feet|sqft)\b/i,
    );
  const maxMatch =
    question.match(
      /\bsqft\s*(?:<=|≤|at\s+most|under|below)\s*(\d{3,5})\b/i,
    ) ??
    question.match(
      /\b(?:under|below|at\s+most)\s*(\d{3,5})\s*(?:sq\.?\s*ft\.?|square\s+feet|sqft)\b/i,
    );
  return {
    sqftMin: minMatch ? Number.parseInt(minMatch[1], 10) : undefined,
    sqftMax: maxMatch ? Number.parseInt(maxMatch[1], 10) : undefined,
  };
}

export function parseFloorBounds(question: string): {
  floorMin?: number;
  floorMax?: number;
} {
  const minMatch = question.match(
    /\bfloors?\s+(\d{1,3})\s+(?:or\s+(?:higher|above|up)|and\s+(?:above|higher|up)|\+)/i,
  );
  const maxMatch = question.match(
    /\bfloors?\s+(\d{1,3})\s+or\s+(?:lower|below)\b/i,
  );
  const exactMatch =
    !minMatch && !maxMatch
      ? question.match(/\bon\s+floor\s+(\d{1,3})\b/i)
      : null;
  if (exactMatch) {
    const f = Number.parseInt(exactMatch[1], 10);
    return { floorMin: f, floorMax: f };
  }
  return {
    floorMin: minMatch ? Number.parseInt(minMatch[1], 10) : undefined,
    floorMax: maxMatch ? Number.parseInt(maxMatch[1], 10) : undefined,
  };
}

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
    /\b(view\s*[=:]\s*['"`]?none['"`]?|with\s+view\s+['"`]?none['"`]?|no[-\s]view\s+units?|units?\s+with\s+no\s+view)\b/i.test(
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

export function parseUnitStatusFilter(question: string): UnitStatus | undefined {
  if (
    /\b(vacant|unoccupied|empty|open\s+(?:units?|apartments?|studios?|1br|2br)|available\s+(?:units?|apartments?|studios?)|status\s*=\s*['"`]?vacant['"`]?)\b/i.test(
      question,
    ) &&
    !/\bvacancy\s+rate\b/i.test(question)
  ) {
    return 'vacant';
  }
  if (
    /\b(on\s+notice|in\s+notice(\s+status)?|notice\s+status|notice\s+units?|units?\s+(?:that\s+)?(?:are\s+)?on\s+notice|units?\s+with\s+notice|status\s*=\s*['"`]?notice['"`]?|(?:units?|apartments?|residents?|tenants?)\b.*(?:gave|given)\s+notice(\s+to\s+vacate|\s+to\s+move\s+out)?)\b/i.test(
      question,
    ) &&
    !/\b(leases?|monthly\s+rent|rent\s+.*at\s+risk|rent\s+exposure|notice_given)\b/i.test(
      question,
    )
  ) {
    return 'notice';
  }
  if (
    /\b(occupied\s+units?|status\s*=\s*['"`]?occupied['"`]?)\b/i.test(
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
export function parseExplicitDateWindow(
  question: string,
  asOfDate = '2026-10-01',
): DateWindowSpec | null {
  const defaultYear = Number.parseInt(asOfDate.slice(0, 4), 10) || 2026;

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

  if (/\b(end(s|ing)?\s+in\s+2026|started\s+in\s+2026|created\s+in\s+2026|in\s+2026)\b/i.test(question)) {
    return DATE_WINDOWS.YEAR_2026;
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

  // A bare year other than the reporting year ("in 2025") is a whole calendar
  // year; it must not silently become the default reporting window.
  const bareYear = question.match(/\b(20\d{2})\b/);
  if (bareYear) {
    const yNum = Number.parseInt(bareYear[1], 10);
    if (yNum !== defaultYear) {
      return buildDynamicDateWindow(`YEAR_${yNum}`, `${yNum}`, yNum, 1, yNum, 12);
    }
  }

  return null;
}

/**
 * Pure semantic parser that extracts a structured `ParsedQueryIntent` AST from
 * any natural-language operator question using dynamic column sets from `store`
 * without checking `qRecord.id` or `result_schema`.
 */
export function parseQueryIntent(
  question: string,
  store: PortfolioStore,
): ParsedQueryIntent {
  const topK = parseTopKCount(question);
  const bedrooms = parseBedroomCount(question);
  const bathrooms = parseBathroomCount(question);
  const { sqftMin, sqftMax } = parseSqftBounds(question);
  const { floorMin, floorMax } = parseFloorBounds(question);
  const view = parseUnitViewFilter(question, store);
  const unitStatus = parseUnitStatusFilter(question);
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
    }

    const paidOnly =
      measure === 'cost_per_signed_lease' ||
      measure === 'dead_spend_building' ||
      measure === 'dead_spend_pairs' ||
      measure === 'reallocation_leases' ||
      measure === 'apply_rate' ||
      /\bpaid\s+(?:listing\s+|ad\s+|marketing\s+)?(?:sources?|channels?)\b/i.test(
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
    const leaseStartWindow =
      hasStartSignal || (isConcessionQuery && dateExplicit && !hasEndSignal)
        ? dateWindow
        : undefined;
    const leaseEndWindow =
      hasEndSignal && !hasStartSignal ? dateWindow : undefined;

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
    /\b(average|avg\.?|mean)\b.*\b(?:market\s+)?rent\b/i.test(question) &&
    /\b(average|avg\.?|mean)\s+sq\.?\s*ft\b/i.test(question)
  ) {
    unitMeasure = 'avg_market_rent_and_sqft';
  } else if (
    (/\b(average|avg\.?|mean)\b/i.test(question) &&
      /\b(market\s+rent|asking\s+rent|rent)\b/i.test(question)) ||
    /\bmarket\s+rent\s+(?:average|mean)\b/i.test(question)
  ) {
    unitMeasure = 'avg_market_rent';
  } else if (/\b(average|avg\.?|mean)\s+sq\.?\s*ft\b/i.test(question)) {
    unitMeasure = 'avg_sqft';
  } else if (/\brent\s+per\s+sq\.?\s*ft\b/i.test(question)) {
    unitMeasure = 'rent_per_sqft';
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
    sqftMin,
    sqftMax,
    floorMin,
    floorMax,
    view,
    unitStatus,
    dateWindow,
    dateExplicit,
    mentionedSources,
    paidOnly: false,
    decisionIds: [],
  };
}
