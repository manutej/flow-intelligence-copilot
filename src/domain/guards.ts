import type {
  AnswerEnvelope,
  CitationId,
  PortfolioStore,
} from '../data/schema.ts';
import { classifyFairHousingRequest } from './fair-housing.ts';
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

  const classification = classifyFairHousingRequest(question);
  const matchedRules = classification.classes;
  if (!classification.refused) {
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
      : [];

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
    reason: `Refused: this asks for ${classification.actions.join(' and ')} based on ${classLabels}${propContext}. That would violate the ${legalBases}, which prohibit discriminatory advertising, steering, and exclusion in housing. I can help with the same task without that criterion, for example a listing that welcomes all applicants.`,
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
      /\b(profit\w*|net\s+income|ebitda|operating\s+margin|profit\s+margin|p&l|profit\s+and\s+loss|net\s+revenue|cap\s+rate|capitalization\s+rate|noi\b|net\s+operating\s+income|dscr\b|debt[-\s]?service(\s+coverage\s+ratio)?|mortgage\s+payment|loan\s+balance|irr\b|cash[-\s]on[-\s]cash|security\s+deposit|pet\s+(fee|deposit|rent)|application\s+fee|move[-\s]?in\s+fee|lease\s+buyout\s+fee|buyout\s+fee|early\s+termination\s+fee|parking\s+(spots?|spaces?)\s+(leased|vacant|rented|available)|leased\s+parking)\b/i,
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

      let rentRollSuffix = "";
      if (/\b(profit\w*|revenue|grossing|noi\b|net\s+operating\s+income|net\s+income)\b/i.test(question)) {
        const rentByProp = new Map<string, number>();
        for (const l of store.leases) {
          rentByProp.set(l.propertyId, (rentByProp.get(l.propertyId) ?? 0) + l.monthlyRent);
        }
        const topRentProps = [...store.operatingProperties]
          .map((p) => ({
            propertyId: p.propertyId,
            name: p.name,
            monthlyRent: Math.round(rentByProp.get(p.propertyId) ?? 0),
          }))
          .sort((a, b) => b.monthlyRent - a.monthlyRent)
          .slice(0, 3);
        if (topRentProps.length > 0) {
          rentRollSuffix = ` (Note: while profit/NOI/OpEx ledgers are not in the exports, the top 3 operating buildings by active monthly contract lease rent roll in data/pms/leases.csv are: ${topRentProps.map((p, i) => `#${i + 1} ${p.name} [${p.propertyId}] at ${p.monthlyRent.toLocaleString("en-US")}/mo`).join(", ")}.)`;
        }
      }
      return {
        unknown: true,
        missingCategory: rule.category,
        reason: `I don't know — the requested ${rule.category.toLowerCase()}${propName} cannot be answered from the available data. ${rule.missingDetail}${rentRollSuffix}`,
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

  const isNonAnswer =
    envelope.result?.unknown === true ||
    envelope.result?.refused === true ||
    envelope.result?.clarification_needed === true;
  if (!Array.isArray(envelope.citations) || envelope.citations.length === 0) {
    // A refusal or "I don't know" has no figure to source, so it may cite nothing.
    if (!isNonAnswer) {
      errors.push('Answer must include at least one row citation');
    }
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
