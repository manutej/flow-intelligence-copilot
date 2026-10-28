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
  readonly isWholePortfolioExplicit: boolean;
  readonly isClassComparison: boolean;
  readonly buildingClass?: 'A' | 'B';
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
  readonly leaseStartWindow?: DateWindowSpec;
  readonly leaseEndWindow?: DateWindowSpec;
  readonly mentionedSources: readonly string[];
  readonly paidOnly: boolean;
  readonly decisionIds: readonly string[];
  readonly decisionAccepted?: 'yes' | 'no' | 'all';
  readonly decisionDirection?: DecisionDirection;
}

const MONTH_NAME_TO_KEY: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly key: keyof typeof DATE_WINDOWS;
}> = [
  { pattern: /\bapril\s*2026\b/i, key: 'APR_2026' },
  { pattern: /\bmay\s*2026\b/i, key: 'MAY_2026' },
  { pattern: /\bjune\s*2026\b/i, key: 'JUN_2026' },
  { pattern: /\bjuly\s*2026\b/i, key: 'JUL_2026' },
  { pattern: /\baugust(\s*2026)?\b/i, key: 'AUG_2026' },
  { pattern: /\bseptember(\s*2026)?\b/i, key: 'SEP_2026' },
  { pattern: /\boctober(\s*2026)?\b/i, key: 'OCT_2026' },
  { pattern: /\bnovember(\s*2026)?\b/i, key: 'NOV_2026' },
  { pattern: /\bdecember(\s*2026)?\b/i, key: 'DEC_2026' },
];

export function parseBedroomCount(question: string): number | undefined {
  if (
    /\b(studios?|studio[-\s]seekers?|0[-\s]bedroom|bedrooms_wanted\s*=\s*0)\b/i.test(
      question,
    )
  ) {
    return 0;
  }
  if (
    /\b(one[-\s]bedrooms?|1[-\s]bedrooms?|1\s*br\b|1\s*bed\b|bedrooms_wanted\s*=\s*1)\b/i.test(
      question,
    )
  ) {
    return 1;
  }
  if (
    /\b(two[-\s]bedrooms?|2[-\s]bedrooms?|2\s*br\b|2\s*bed\b|bedrooms_wanted\s*=\s*2)\b/i.test(
      question,
    )
  ) {
    return 2;
  }
  if (
    /\b(three[-\s]bedrooms?|3[-\s]bedrooms?|3\s*br\b|3\s*bed\b|bedrooms_wanted\s*=\s*3)\b/i.test(
      question,
    )
  ) {
    return 3;
  }
  return undefined;
}

export function parseBathroomCount(question: string): number | undefined {
  if (/\b(1\.5[-\s]bath(room)?s?|one[-\s]and[-\s]a[-\s]half\s+bath)/i.test(question)) {
    return 1.5;
  }
  if (/\b(two[-\s]bath(room)?s?|2[-\s]bath(room)?s?|2\s*ba\b)\b/i.test(question)) {
    return 2;
  }
  if (/\b(one[-\s]bath(room)?s?|1[-\s]bath(room)?s?|1\s*ba\b)\b/i.test(question)) {
    return 1;
  }
  return undefined;
}

export function parseSqftBounds(question: string): {
  sqftMin?: number;
  sqftMax?: number;
} {
  const minMatch =
    question.match(
      /\bsqft\s*(?:>=|≥|at\s+least|over|above)\s*(\d{3,4})\b/i,
    ) ??
    question.match(
      /\b(?:at\s+least|over|minimum\s+of)\s*(\d{3,4})\s*(?:sq\.?\s*ft\.?|square\s+feet|sqft)\b/i,
    );
  const maxMatch =
    question.match(
      /\bsqft\s*(?:<=|≤|at\s+most|under|below)\s*(\d{3,4})\b/i,
    ) ??
    question.match(
      /\b(?:under|below|at\s+most)\s*(\d{3,4})\s*(?:sq\.?\s*ft\.?|square\s+feet|sqft)\b/i,
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
    /\bfloors?\s+(\d{1,2})\s+(?:or\s+(?:higher|above|up)|and\s+(?:above|higher|up)|\+)/i,
  );
  const maxMatch = question.match(
    /\bfloors?\s+(\d{1,2})\s+or\s+(?:lower|below)\b/i,
  );
  const exactMatch =
    !minMatch && !maxMatch
      ? question.match(/\bon\s+floor\s+(\d{1,2})\b/i)
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

export function parseUnitViewFilter(question: string): string | undefined {
  if (
    /\b(units?\s+with\s+a\s+lake\s+view|lake[-\s]view\s+units?|view\s*[=:]\s*['"`]?lake['"`]?)\b/i.test(
      question,
    )
  ) {
    return 'lake';
  }
  if (
    /\b(units?\s+with\s+a\s+city\s+view|city[-\s]view\s+units?|view\s*[=:]\s*['"`]?city['"`]?)\b/i.test(
      question,
    )
  ) {
    return 'city';
  }
  if (
    /\b(units?\s+with\s+a\s+park\s+view|park[-\s]view\s+units?|view\s*[=:]\s*['"`]?park['"`]?)\b/i.test(
      question,
    )
  ) {
    return 'park';
  }
  if (
    /\b(units?\s+with\s+a\s+courtyard\s+view|courtyard[-\s]view\s+units?|courtyard\s+units?|courtyard\s+vacancy|view\s*[=:]\s*['"`]?courtyard['"`]?)\b/i.test(
      question,
    )
  ) {
    return 'courtyard';
  }
  if (
    /\b(view\s*[=:]\s*['"`]?none['"`]?|with\s+view\s+['"`]?none['"`]?|no[-\s]view\s+units?|units?\s+with\s+no\s+view)\b/i.test(
      question,
    )
  ) {
    return 'none';
  }
  return undefined;
}

export function parseUnitStatusFilter(question: string): UnitStatus | undefined {
  if (
    /\b(vacant|open\s+units?)\b/i.test(question) &&
    !/\bvacancy\s+rate\b/i.test(question)
  ) {
    return 'vacant';
  }
  if (
    /\b(on\s+notice|notice\s+units?)\b/i.test(question) &&
    !/\b(leases?|resident\s+gave\s+notice|notice_given)\b/i.test(question)
  ) {
    return 'notice';
  }
  if (
    /\boccupied\s+units?\b/i.test(question) &&
    !/\bshare\s+of\b/i.test(question)
  ) {
    return 'occupied';
  }
  return undefined;
}

export function parseSourceMentions(
  question: string,
  store: PortfolioStore,
): string[] {
  const allSources = [...store.paidSources, ...store.organicSources].sort(
    (a, b) => b.length - a.length,
  );
  const found: string[] = [];
  for (const src of allSources) {
    const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pat = new RegExp(`(?:^|\\b)${escaped}(?:\\b|$|\\s)`, 'i');
    if (pat.test(question)) {
      found.push(src);
    }
  }
  return found;
}

export function parseDateWindowFromText(
  question: string,
  asOfDate = '2026-10-01',
): DateWindowSpec {
  if (/\bthis\s+month\b/i.test(question)) {
    const ym = asOfDate.slice(0, 7);
    const match = Object.values(DATE_WINDOWS).find(
      (w) => w.months.length === 1 && w.months[0] === ym,
    );
    if (match) {
      return match;
    }
  }
  if (/\bapr(?:il)?[\s-]+(?:to[\s-]+)?sep(?:tember)?(?:\s*2026)?\b/i.test(question)) {
    return DATE_WINDOWS.APR_SEP_2026;
  }
  if (/\bq1\s*2027\b/i.test(question)) {
    return DATE_WINDOWS.Q1_2027;
  }
  if (/\bq2\s*2026\b/i.test(question) || /\bapril[-\s]+to[-\s]+june\b/i.test(question)) {
    return DATE_WINDOWS.Q2_2026;
  }
  if (/\bq3\s*2026\b/i.test(question) || /\bjuly[-\s]+to[-\s]+september\b/i.test(question)) {
    return DATE_WINDOWS.Q3_2026;
  }
  if (/\bq4\s*2026\b/i.test(question)) {
    return DATE_WINDOWS.Q4_2026;
  }
  if (/\bh1(\s*2026)?\b/i.test(question) && !/\bvs\.?\s*q3\b/i.test(question) && !/\bversus\s+q3\b/i.test(question)) {
    return DATE_WINDOWS.H1_2026;
  }
  for (const m of MONTH_NAME_TO_KEY) {
    if (m.pattern.test(question)) {
      return DATE_WINDOWS[m.key];
    }
  }
  if (/\b(end(s|ing)?\s+in\s+2026)\b/i.test(question)) {
    return DATE_WINDOWS.YEAR_2026;
  }
  const isoSingleMonth = question.match(/\b(202[67]-\d{2})(?:-\d{2})?\b/);
  if (isoSingleMonth && !/\bto\b/i.test(question)) {
    const ym = isoSingleMonth[1];
    const match = Object.values(DATE_WINDOWS).find(
      (w) => w.months.length === 1 && w.months[0] === ym,
    );
    if (match) {
      return match;
    }
  }
  return DATE_WINDOWS.APR_SEP_2026;
}

/**
 * Pure semantic parser that extracts a structured `ParsedQueryIntent` AST from
 * any natural-language operator question without checking `qRecord.id` or `result_schema`.
 */
export function parseQueryIntent(
  question: string,
  store: PortfolioStore,
): ParsedQueryIntent {
  const bedrooms = parseBedroomCount(question);
  const bathrooms = parseBathroomCount(question);
  const { sqftMin, sqftMax } = parseSqftBounds(question);
  const { floorMin, floorMax } = parseFloorBounds(question);
  const view = parseUnitViewFilter(question);
  const unitStatus = parseUnitStatusFilter(question);
  const mentionedSources = parseSourceMentions(question, store);
  const dateWindow = parseDateWindowFromText(question, store.policy.asOfDate);

  const isClassComparison =
    /\bclass\s+a\s+(?:vs\.?|versus|compared\s+to)\s+class\s+b\b/i.test(
      question,
    );
  const classMatch = !isClassComparison
    ? question.match(/\bclass[\s-]+([ab])\b/i)
    : null;
  const buildingClass = classMatch
    ? (classMatch[1].toUpperCase() as 'A' | 'B')
    : undefined;

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
    /\bP0[1-9]\b/i.test(question) ||
    /\b(between|among\s+the\s+buildings|of\s+the\s+buildings)\b/i.test(question);

  const isWholePortfolioExplicit =
    /\b(across\s+the\s+(whole\s+)?portfolio|whole\s+portfolio|portfolio\s+total|every\s+paid\s+source\s+and\s+building\s+pair|which\s+building\s+gave\s+the\s+(highest|lowest))\b/i.test(
      question,
    ) ||
    (!hasExplicitPropertyCohort &&
      /\bwhich\s+building\s+has\s+the\s+(highest|lowest)\b/i.test(question));

  const aggregation: IntentAggregation = isClassComparison
    ? 'compare'
    : /\b(lowest|least|cheapest|minimum|fewest)\b/i.test(question)
      ? 'argmin'
      : /\b(highest|most|maximum|more\s+leases)\b/i.test(question)
        ? 'argmax'
        : /\b(list\s+every|which\s+paid\s+sources)\b/i.test(question)
          ? 'list'
          : 'value';

  // 1. Data quality audit (void spend rows + duplicate leads)
  if (/\bvoid\b/i.test(question) && /\bduplicates?\b/i.test(question)) {
    return {
      domain: 'data_quality',
      measure: 'void_and_duplicate_counts',
      aggregation: 'value',
      isWholePortfolioExplicit: true,
      isClassComparison: false,
      dateWindow,
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
      isWholePortfolioExplicit,
      isClassComparison,
      buildingClass,
      dateWindow,
      mentionedSources,
      paidOnly: true,
      decisionIds,
      decisionAccepted,
      decisionDirection,
    };
  }

  // 3. Marketing, Spend, Funnel, CPSL, CPL, CPT, Dead Spend, Reallocation
  const isMarketingOrFunnel =
    /\b(cost\s+per\s+(signed\s+lease|lead|tour)|cpsl\b|cpl\b|cpt\b|paid\s+sources?|listing\s+source|brought\s+no\s+leases|produced\s+no\s+leases|signed\s+no\s+lease|dead\s+spend|tour-to-lease|conversion\s+rate|apply\s+rate|applied\s*=\s*true|applied\s+in\s+\w+|signed\s+more\s+leases\s+from\s+leads|how\s+many\s+more\s+leases\s+would\s+(it|that)\s+buy|posted\s+spend|h1\s+spend\s+versus\s+q3\s+spend)\b/i.test(
      question,
    ) ||
    (mentionedSources.length > 0 &&
      /\b(cost|spend|spent|paid|leases?|leads?|cpsl|cpl)\b/i.test(question));

  if (isMarketingOrFunnel) {
    let measure: IntentMeasure = 'cost_per_signed_lease';
    if (/\bhow\s+many\s+more\s+leases\s+would\s+(it|that)\s+buy\b/i.test(question)) {
      measure = 'reallocation_leases';
    } else if (
      /\blist\s+every\s+paid\s+source\s+and\s+building\s+pair\s+that\s+produced\s+no\s+leases\b/i.test(
        question,
      )
    ) {
      measure = 'dead_spend_pairs';
    } else if (
      /\b(brought\s+no\s+leases|produced\s+no\s+leases|zero-lease)\b/i.test(
        question,
      )
    ) {
      measure = 'dead_spend_building';
    } else if (/\btour-to-lease\b/i.test(question)) {
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
    } else if (/\bcost\s+per\s+lead\b/i.test(question)) {
      measure = 'cost_per_lead';
    } else if (/\bcost\s+per\s+tour\b/i.test(question)) {
      measure = 'cost_per_tour';
    } else if (
      /\bh1\s+spend\s+(?:vs\.?|versus)\s+q3\s+spend\b/i.test(question)
    ) {
      measure = 'spend_h1_vs_q3';
    } else if (
      /\b(posted\s+(?:[\w.]+\s+){0,3}spend|total\s+(?:[\w.]+\s+){0,3}spend|what\s+did\s+we\s+spend|what\s+did\s+.*\bcost\b|how\s+much\s+did\s+.*\b(cost|spend)\b)\b/i.test(
        question,
      ) &&
      !/\bcost\s+per\b/i.test(question)
    ) {
      measure = 'spend_total';
    } else if (/\bsigned\s+more\s+leases\s+from\s+leads\b/i.test(question)) {
      measure = 'signed_leases_ranking';
    }

    const paidOnly =
      measure === 'cost_per_signed_lease' ||
      measure === 'dead_spend_building' ||
      measure === 'dead_spend_pairs' ||
      measure === 'reallocation_leases' ||
      measure === 'apply_rate' ||
      /\bpaid\s+sources?\b/i.test(question);

    return {
      domain: 'marketing',
      measure,
      aggregation,
      isWholePortfolioExplicit,
      isClassComparison,
      buildingClass,
      yearBuiltMin,
      yearBuiltMax,
      bedrooms,
      dateWindow,
      mentionedSources,
      paidOnly,
      decisionIds: [],
    };
  }

  // 4. Leases, Renewals, Concessions, and Rent at Risk
  const isLeasesOrRenewals =
    /\b(leases?\b.*(end|ending|started|starts|renew\w*|concession\w*|at\s+risk|gave\s+notice|notice_given|pending)|average\s+concession|monthly\s+rent\s+is\s+at\s+risk|monthly\s+rent\s+on\s+leases|renewal\s+rate)\b/i.test(
      question,
    );

  if (isLeasesOrRenewals) {
    const leaseType: LeaseType | undefined =
      /\bnew\s+leases\b/i.test(question) &&
      !/\bnew\s+(?:vs\.?|versus)\s+renewal\b/i.test(question)
        ? 'new'
        : undefined;

    let renewalStatus: RenewalStatus | undefined;
    if (/\bpending(\s+a\s+renewal)?\b/i.test(question)) {
      renewalStatus = 'pending';
    } else if (
      /\b(resident\s+gave\s+notice|notice_given)\b/i.test(question) ||
      (/\bat\s+risk\b/i.test(question) && /\bnotice\b/i.test(question))
    ) {
      renewalStatus = 'notice_given';
    }

    const hasStartSignal = /\b(started|starts|lease\s+starts)\b/i.test(question);
    const hasEndSignal =
      /\b(end|ending|ends|endings)\b/i.test(question) ||
      /\bthis\s+month\b/i.test(question);

    const leaseStartWindow = hasStartSignal ? dateWindow : undefined;
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
    } else if (/\baverage\s+concession\b/i.test(question)) {
      measure = 'average_concession';
    } else if (
      /\b(monthly\s+rent\s+is\s+at\s+risk|monthly\s+rent\s+on\s+leases|monthly\s+rent\s+at\s+risk)\b/i.test(
        question,
      )
    ) {
      measure = 'rent_at_risk';
    }

    return {
      domain: 'leases',
      measure,
      aggregation,
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
    /\b(occupied\s+share|share\s+of.*occupied|occupancy\s+rate|occupancy\s+at)\b/i.test(
      question,
    )
  ) {
    unitMeasure = 'occupied_share';
  } else if (
    /\baverage\s+market\s+rent\b/i.test(question) &&
    /\baverage\s+sqft\b/i.test(question)
  ) {
    unitMeasure = 'avg_market_rent_and_sqft';
  } else if (/\baverage\s+market\s+rent\b/i.test(question)) {
    unitMeasure = 'avg_market_rent';
  } else if (/\baverage\s+sqft\b/i.test(question)) {
    unitMeasure = 'avg_sqft';
  } else if (/\brent\s+per\s+sqft\b/i.test(question)) {
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
    mentionedSources,
    paidOnly: false,
    decisionIds: [],
  };
}
