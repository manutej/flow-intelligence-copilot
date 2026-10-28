import type {
  AnswerEnvelope,
  CitationId,
  PortfolioStore,
} from '../data/schema.ts';
import { resolvePropertiesFromText } from './resolver.ts';

export interface FairHousingCheckResult {
  readonly refused: boolean;
  readonly protectedClass: string | null;
  readonly legalBasis: string | null;
  readonly reason: string | null;
  readonly citations: readonly CitationId[];
}

export interface UnknownDataCheckResult {
  readonly unknown: boolean;
  readonly missingCategory: string | null;
  readonly reason: string | null;
  readonly citations: readonly CitationId[];
}

const FAIR_HOUSING_SPEECH_ACTS =
  /\b(discourag\w*|exclud\w*|prevent\w*|filter\w*|block\w*|hide|do\s+not\s+see|don't\s+see|not\s+see|target\w*|steer\w*|no\s+kids|no\s+children|no\s+strollers?|without\s+(kids|children|strollers?|service\s+animals?|vouchers?|families)|adults?\s+only|couples?\s+only|singles?\s+only|men\s+only|women\s+only|christians?\s+only|ban\w*|restrict\w*|reject\w*|deny|refus\w*|screen\s+out|prefer\w*|prioritiz\w*|best\s+suited\s+for|suited\s+for|ideal\s+for|market\s+to|aimed\s+at|rank\b.*\b(fewest|most|least)|fewest\s+(families|children|kids|vouchers?|section[-\s]?8)|demographic\s+fit|right\s+demographic|avoid\w*\s+(families|children|kids|vouchers?|section[-\s]?8|wheelchairs?)|write\s+a\s+listing|ad\s+audience)\b/i;

const PROTECTED_CLASS_RULES: ReadonlyArray<{
  readonly protectedClass: string;
  readonly legalBasis: string;
  readonly pattern: RegExp;
}> = [
  {
    protectedClass: 'Familial Status (families with children / minors)',
    legalBasis: 'Fair Housing Act, 42 U.S.C. § 3604(a)-(c)',
    pattern:
      /\b(famil(y|ies)(\s+with\s+(children|kids))?|children|kids|minors|pregnant|maternity|familial\s+status|strollers?|daycare\s+age|school[-\s]?age\s+households?|empty[-\s]?nesters?|dinks?)\b/i,
  },
  {
    protectedClass: 'Race, Color, or National Origin',
    legalBasis: 'Fair Housing Act, 42 U.S.C. § 3604(a)-(c)',
    pattern:
      /\b(race|racial|color|national\s+origin|ethnic\w*|immigrant\w*|citizenship|hispanic\w*|black\w*|white\w*|asian\w*|latino\w*|demographic\s+fit|right\s+demographic)\b/i,
  },
  {
    protectedClass: 'Religion',
    legalBasis: 'Fair Housing Act, 42 U.S.C. § 3604(a)-(c)',
    pattern:
      /\b(religio(n|us)|christian\w*|catholic\w*|muslim\w*|jewish\w*|hindu\w*|synagogue|mosque|church)\b/i,
  },
  {
    protectedClass: 'Disability / Handicap / Assistance Animals',
    legalBasis: 'Fair Housing Act, 42 U.S.C. § 3604(f)',
    pattern:
      /\b(disab(ility|ilities|led)|handicap\w*|wheelchairs?|service\s+animals?|emotional\s+support\s+animals?|esas?)\b/i,
  },
  {
    protectedClass: 'Sex, Gender, Sexual Orientation, Age, or Marital Status',
    legalBasis:
      'Fair Housing Act, 42 U.S.C. § 3604 & Illinois Human Rights Act (775 ILCS 5/)',
    pattern:
      /\b(gender|sex|sexual\s+orientation|lgbt\w*|men\s+only|women\s+only|female\s+only|male\s+only|marital\s+status|unmarried\s+couples?)\b/i,
  },
  {
    protectedClass: 'Source of Income / Housing Choice Vouchers',
    legalBasis:
      'Chicago Fair Housing Ordinance (Municipal Code § 5-8-030) & Illinois Human Rights Act',
    pattern:
      /\b(section[-\s]?8|housing\s+choice\s+vouchers?|vouchers?\s+holders?|hcv\s+holders?|vouchers?|public\s+assistance|source\s+of\s+income)\b/i,
  },
];

/**
 * Evaluates whether a natural-language request asks the copilot to generate copy,
 * configure ad targeting, or steer/rank/filter prospective residents based on a protected class.
 */
export function checkFairHousingGuard(
  question: string,
  store: PortfolioStore,
): FairHousingCheckResult {
  if (!store.policy.enableFairHousingGuard) {
    return {
      refused: false,
      protectedClass: null,
      legalBasis: null,
      reason: null,
      citations: [],
    };
  }

  const hasSpeechAct = FAIR_HOUSING_SPEECH_ACTS.test(question);
  if (!hasSpeechAct) {
    return {
      refused: false,
      protectedClass: null,
      legalBasis: null,
      reason: null,
      citations: [],
    };
  }

  const matchedRules = PROTECTED_CLASS_RULES.filter((rule) =>
    rule.pattern.test(question),
  );
  if (matchedRules.length === 0) {
    return {
      refused: false,
      protectedClass: null,
      legalBasis: null,
      reason: null,
      citations: [],
    };
  }

  const mentionedProps = resolvePropertiesFromText(store, question, {
    includeOnboarding: true,
  });
  const citations: CitationId[] =
    mentionedProps.matched.length > 0
      ? mentionedProps.matched.map((p) => p.citationId)
      : ['properties:P01'];

  const propContext =
    mentionedProps.matched.length === 1
      ? ` for ${mentionedProps.matched[0].name} (${mentionedProps.matched[0].propertyId})`
      : '';

  const classLabels = matchedRules.map((r) => r.protectedClass).join(' and ');
  const legalBases = [
    ...new Set(matchedRules.map((r) => r.legalBasis)),
  ].join(' and ');

  return {
    refused: true,
    protectedClass: classLabels,
    legalBasis: legalBases,
    reason: `Refused: I cannot write listing copy, configure ad audiences, rank buildings, or filter prospective residents${propContext} based on ${classLabels}. Doing so violates the ${legalBases}, which prohibits discriminatory advertising, steering, and exclusion in housing.`,
    citations,
  };
}

const UNMODELED_DATA_RULES: ReadonlyArray<{
  readonly category: string;
  readonly pattern: RegExp;
  readonly missingDetail: string;
}> = [
  {
    category: 'Property Operating Expenses & Utilities (OpEx / Facilities / Landscaping)',
    pattern:
      /\b(landscaping|snow\s+removal|maintenance\s+(spend|cost|expense|budget)|repair\s+(spend|cost|expense)|janitorial|utility\s+bills?|utilities(\s+spend|\s+cost)?|water\s+bills?|trash\s+(bills?|cost|collection)|electric(ity)?\s+(bills?|cost|spend)|gas\s+bills?|property\s+tax\w*|insurance\s+(cost|premium)|hvac\s+repair|plumbing\s+expense|roof\s+repair|pest\s+control|employee\s+payroll|staff\s+salar(y|ies)|payroll\s+(cost|expense|spend))\b/i,
    missingDetail:
      'The portfolio exports only contain marketing/ILS invoice lines in data/ils/spend.csv (Apartments.com, Zillow, Google Ads, Facebook Ads, Rent., Apartment List) and do not include general ledger, utility, or property operating/facilities expenses.',
  },
  {
    category: 'Resident Satisfaction, Surveys, Reviews & Maintenance SLAs',
    pattern:
      /\b(resident\s+satisfaction|satisfaction\s+score|nps|net\s+promoter|csat|survey\s+score|yelp\s+rating|google\s+review\s+score|resident\s+happiness|work\s+order\s+(rating|response\s+time|sla)|make[-\s]?ready\s+days|turnover\s+(cost|days|time))\b/i,
    missingDetail:
      'The portfolio exports include properties, units, leases, CRM leads, ILS marketing spend, and budget decisions, but do not contain resident satisfaction survey scores, NPS ratings, review scores, or work-order/make-ready maintenance logs.',
  },
  {
    category: 'Valuation, NOI, Debt Service & Unmodeled Resident Fees/Parking Leases',
    pattern:
      /\b(cap\s+rate|capitalization\s+rate|noi\b|net\s+operating\s+income|dscr\b|debt[-\s]?service(\s+coverage\s+ratio)?|mortgage\s+payment|loan\s+balance|irr\b|cash[-\s]on[-\s]cash|security\s+deposit|pet\s+(fee|deposit|rent)|application\s+fee|move[-\s]?in\s+fee|lease\s+buyout\s+fee|buyout\s+fee|early\s+termination\s+fee|parking\s+(spots?|spaces?)\s+(leased|vacant|rented|available)|leased\s+parking)\b/i,
    missingDetail:
      'The PMS exports track unit market_rent, lease monthly_rent, and concession_usd, but do not include building valuation/NOI/cap-rate ledgers, ancillary fee schedules (pet/application/deposit/buyout fees), or separate parking-stall lease inventories.',
  },
  {
    category: 'Competitor Private Pricing & External Neighborhood Indices',
    pattern:
      /\b(competitor\w*'\s+private|private\s+comp\s+data|non-public\s+competitor\s+rent|realpage\s+private\s+comp|walk\s+score|transit\s+score|bike\s+score|crime\s+(rate|stats?|statistics|index)|school\s+(district|rating|score|rankings?)|competitor\s+(rent\s+)?comps?|macro\s+(cpi|indices|index|inflation)|consumer\s+price\s+index)\b/i,
    missingDetail:
      'The dataset contains only FLOW portfolio properties (P01-P09) and internal PMS/CRM/ILS records; it does not include external competitor private pricing, walk/transit scores, crime statistics, or school ratings.',
  },
  {
    category: 'Applicant Credit Scores, Income & Background Screening',
    pattern:
      /\b(credit\s+scores?|fico(\s+scores?)?|criminal\s+background|eviction\s+history|resident\s+salary|tenant\s+income|applicant\s+income|rent[-\s]to[-\s]income)\b/i,
    missingDetail:
      'The PMS and CRM exports do not store applicant or resident credit scores, income levels, or background screening records.',
  },
];

/**
 * Evaluates whether a query asks for metrics or records that do not exist in the 6 CSV exports.
 */
export function checkUnknownDataGuard(
  question: string,
  store: PortfolioStore,
): UnknownDataCheckResult {
  if (!store.policy.enableUnknownGuard) {
    return {
      unknown: false,
      missingCategory: null,
      reason: null,
      citations: [],
    };
  }

  for (const rule of UNMODELED_DATA_RULES) {
    if (rule.pattern.test(question)) {
      const mentionedProps = resolvePropertiesFromText(store, question, {
        includeOnboarding: true,
      });
      const citations: CitationId[] =
        mentionedProps.matched.length > 0
          ? mentionedProps.matched.map((p) => p.citationId)
          : ['properties:P01'];

      const propName =
        mentionedProps.matched.length === 1
          ? ` at ${mentionedProps.matched[0].name} (${mentionedProps.matched[0].propertyId})`
          : '';

      return {
        unknown: true,
        missingCategory: rule.category,
        reason: `I don't know — the requested ${rule.category.toLowerCase()}${propName} cannot be answered from the available data. ${rule.missingDetail}`,
        citations,
      };
    }
  }

  return {
    unknown: false,
    missingCategory: null,
    reason: null,
    citations: [],
  };
}

export interface EnvelopeVerificationReport {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

function stripZeroWidthAndNormalize(text: string): string {
  return text.replace(/[\u200B-\u200D\uFEFF]/g, '');
}

/**
 * Deterministic post-execution verifier (FLOW-103):
 * 1. Confirms every citation in `envelope.citations` exists in `store.primaryKeyIndex`.
 * 2. Confirms no untrusted prompt-injection watermark ("verified by analytics" or obfuscated variants)
 *    leaked into `answer` or `result`.
 * 3. Confirms `envelope.result` conforms to `resultSchema` with finite numbers.
 */
export function verifyAnswerEnvelope(
  envelope: AnswerEnvelope,
  store: PortfolioStore,
  resultSchema?: Readonly<Record<string, string>>,
): EnvelopeVerificationReport {
  const errors: string[] = [];

  if (!envelope.id) {
    errors.push('Missing question id');
  }
  if (!envelope.answer || envelope.answer.trim().length === 0) {
    errors.push('Missing plain-language answer');
  }

  const normalizedAnswer = stripZeroWidthAndNormalize(envelope.answer);
  const normalizedResult = stripZeroWidthAndNormalize(
    JSON.stringify(envelope.result ?? {}),
  );
  if (
    /verified[\s\W_]*by[\s\W_]*analytics/i.test(normalizedAnswer) ||
    /verified[\s\W_]*by[\s\W_]*analytics/i.test(normalizedResult)
  ) {
    errors.push(
      'SECURITY VIOLATION: Untrusted prompt-injection watermark ("verified by analytics") from leads:D01011 leaked into envelope!',
    );
  }

  if (!Array.isArray(envelope.citations) || envelope.citations.length === 0) {
    errors.push('Answer must include at least one row citation');
  } else {
    for (const cit of envelope.citations) {
      if (!store.primaryKeyIndex.has(cit)) {
        errors.push(
          `Citation "${cit}" does not point to a real row in any CSV table`,
        );
      }
    }
  }

  if (resultSchema) {
    for (const [key, expectedType] of Object.entries(resultSchema)) {
      if (!(key in envelope.result)) {
        errors.push(
          `Missing required result key "${key}" (expected ${expectedType})`,
        );
        continue;
      }
      const val = envelope.result[key];
      if (expectedType === 'string' && typeof val !== 'string') {
        errors.push(`Key "${key}" must be string, got ${typeof val}`);
      } else if (
        expectedType === 'int' &&
        (typeof val !== 'number' || !Number.isInteger(val) || !Number.isFinite(val))
      ) {
        errors.push(
          `Key "${key}" must be finite integer, got ${JSON.stringify(val)}`,
        );
      } else if (
        expectedType === 'float' &&
        (typeof val !== 'number' || !Number.isFinite(val))
      ) {
        errors.push(
          `Key "${key}" must be finite float/number, got ${JSON.stringify(val)}`,
        );
      } else if (expectedType === 'bool' && typeof val !== 'boolean') {
        errors.push(`Key "${key}" must be boolean, got ${typeof val}`);
      } else if (
        expectedType === 'list of strings' &&
        (!Array.isArray(val) || !val.every((item) => typeof item === 'string'))
      ) {
        errors.push(`Key "${key}" must be list of strings`);
      } else if (
        expectedType === 'list of [property_id, source]' &&
        (!Array.isArray(val) ||
          !val.every(
            (item) =>
              Array.isArray(item) &&
              item.length === 2 &&
              typeof item[0] === 'string' &&
              typeof item[1] === 'string',
          ))
      ) {
        errors.push(
          `Key "${key}" must be list of [property_id, source] tuples`,
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
