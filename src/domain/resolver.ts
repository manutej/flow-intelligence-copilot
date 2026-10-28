import type {
  CitationId,
  PortfolioStore,
  PropertyRecord,
} from '../data/schema.ts';

export type ResolutionMode = 'single_building' | 'portfolio_filter';

export interface PropertyFilterCriteria {
  readonly propertyId?: string;
  readonly queryText?: string;
  readonly neighborhood?: string;
  readonly pms?: string;
  readonly buildingClass?: string;
  readonly yearBuiltMin?: number;
  readonly yearBuiltMax?: number;
  readonly amenities?: readonly string[];
  readonly includeOnboarding?: boolean;
  readonly expectSingle?: boolean;
  readonly resolutionMode?: ResolutionMode;
}

export interface PropertyResolutionResult {
  readonly status: 'resolved' | 'multiple' | 'ambiguous_match' | 'not_found';
  readonly matched: readonly PropertyRecord[];
  readonly matchedBy: readonly string[];
  readonly ambiguous: boolean;
  readonly clarifyingQuestion: string | null;
  readonly citations: readonly CitationId[];
}

const AMENITY_SYNONYMS: ReadonlyArray<{
  readonly canonical: string;
  readonly patterns: readonly RegExp[];
}> = [
  {
    canonical: 'lake view',
    patterns: [/\blake\s+view\b/i, /\blakefront\b/i],
  },
  {
    canonical: 'rooftop pool',
    patterns: [
      /\brooftop\s+pool\b/i,
      /\bwith\s+(?:the\s+|a\s+)?pool\b/i,
      /\bpool\b/i,
    ],
  },
  {
    canonical: 'rooftop deck',
    patterns: [/\brooftop\s+deck\b/i],
  },
  {
    canonical: 'gym',
    patterns: [/\bgym\b/i, /\bfitness\s+center\b/i],
  },
  {
    canonical: 'doorman',
    patterns: [/\bdoorman\b/i, /\bconcierge\b/i],
  },
  {
    canonical: 'parking garage',
    patterns: [/\bparking\s+garage\b/i],
  },
  {
    canonical: 'dog run',
    patterns: [/\bdog\s+run\b/i, /\bdog\s+park\b/i],
  },
  {
    canonical: 'EV charging',
    patterns: [/\bev\s+charging\b/i, /\belectric\s+vehicle\s+charging\b/i],
  },
  {
    canonical: 'coworking',
    patterns: [/\bcoworking(\s+space)?\b/i, /\bco-working(\s+space)?\b/i],
  },
  {
    canonical: 'package lockers',
    patterns: [/\bpackage\s+lockers?\b/i],
  },
  {
    canonical: 'bike storage',
    patterns: [/\bbike\s+storage\b/i],
  },
  {
    canonical: 'courtyard',
    patterns: [/\bcourtyard\b/i],
  },
];

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildClarifyingQuestion(
  candidates: readonly PropertyRecord[],
  matchedBy: readonly string[],
): string {
  const criteriaDesc =
    matchedBy.length > 0 ? matchedBy.join(' and ') : 'your description';
  const sharedAmenities = new Set(
    candidates[0]?.amenities.filter((a) =>
      candidates.every((c) => c.amenities.includes(a)),
    ) ?? [],
  );

  const descriptions = candidates.map((c) => {
    const uniqueAmenities = c.amenities.filter((a) => !sharedAmenities.has(a));
    const traits: string[] = [
      c.neighborhood,
      `Class ${c.buildingClass}`,
      `${c.pms} PMS`,
    ];
    if (uniqueAmenities.length > 0) {
      traits.push(`has ${uniqueAmenities.join(', ')}`);
    }
    return `${c.name} (${c.propertyId}: ${traits.join('; ')})`;
  });

  return `Multiple operating buildings match ${criteriaDesc}: ${descriptions.join(' vs. ')}. Which building would you like me to check?`;
}

/**
 * Resolves properties from structured criteria (`find_properties` tool / MCP endpoint).
 */
export function resolveProperties(
  store: PortfolioStore,
  criteria: PropertyFilterCriteria,
): PropertyResolutionResult {
  const pool = criteria.includeOnboarding
    ? store.properties
    : store.operatingProperties;

  const expectSingle: boolean | undefined =
    criteria.resolutionMode === 'single_building'
      ? true
      : criteria.resolutionMode === 'portfolio_filter'
        ? false
        : criteria.expectSingle;

  let candidates = [...pool];
  const matchedBy: string[] = [];

  if (criteria.propertyId) {
    const targetId = criteria.propertyId.trim().toUpperCase();
    candidates = candidates.filter(
      (p) => p.propertyId.toUpperCase() === targetId,
    );
    matchedBy.push(`property_id="${targetId}"`);
  }

  if (criteria.neighborhood) {
    const targetNeighborhood = criteria.neighborhood.trim().toLowerCase();
    candidates = candidates.filter(
      (p) => p.neighborhood.toLowerCase() === targetNeighborhood,
    );
    matchedBy.push(`neighborhood="${criteria.neighborhood}"`);
  }

  if (criteria.pms) {
    const targetPms = criteria.pms.trim().toLowerCase();
    candidates = candidates.filter((p) => p.pms.toLowerCase() === targetPms);
    matchedBy.push(`pms="${criteria.pms}"`);
  }

  if (criteria.buildingClass) {
    const targetClass = criteria.buildingClass.trim().toUpperCase();
    candidates = candidates.filter(
      (p) => p.buildingClass.toUpperCase() === targetClass,
    );
    matchedBy.push(`class="${targetClass}"`);
  }

  if (criteria.yearBuiltMin !== undefined) {
    candidates = candidates.filter(
      (p) => p.yearBuilt >= criteria.yearBuiltMin!,
    );
    matchedBy.push(`year_built>=${criteria.yearBuiltMin}`);
  }

  if (criteria.yearBuiltMax !== undefined) {
    candidates = candidates.filter(
      (p) => p.yearBuilt <= criteria.yearBuiltMax!,
    );
    matchedBy.push(`year_built<=${criteria.yearBuiltMax}`);
  }

  if (criteria.amenities && criteria.amenities.length > 0) {
    for (const reqAmenity of criteria.amenities) {
      const normalized = reqAmenity.trim().toLowerCase();
      const canonicalSynonym = AMENITY_SYNONYMS.find(
        (s) =>
          s.canonical.toLowerCase() === normalized ||
          s.patterns.some((pat) => pat.test(reqAmenity)),
      );
      const targetAmenity = (
        canonicalSynonym?.canonical ?? reqAmenity
      ).toLowerCase();
      candidates = candidates.filter((p) =>
        p.amenities.some((a) => a.toLowerCase() === targetAmenity),
      );
      matchedBy.push(`amenity="${canonicalSynonym?.canonical ?? reqAmenity}"`);
    }
  }

  if (criteria.queryText && criteria.queryText.trim().length > 0) {
    const textRes = resolvePropertiesFromText(store, criteria.queryText, {
      includeOnboarding: criteria.includeOnboarding,
      expectSingle,
      resolutionMode: criteria.resolutionMode,
      candidatePool: candidates,
    });
    if (textRes.matchedBy.length > 0) {
      return textRes;
    }
    const q = criteria.queryText.trim().toLowerCase();
    const subMatches = candidates.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.aka.some((alias) => alias.toLowerCase().includes(q)) ||
        p.neighborhood.toLowerCase().includes(q),
    );
    if (subMatches.length > 0) {
      candidates = subMatches;
      matchedBy.push(`query="${criteria.queryText}"`);
    } else if (matchedBy.length === 0) {
      candidates = [];
    }
  }

  if (candidates.length === 0) {
    return {
      status: 'not_found',
      matched: [],
      matchedBy,
      ambiguous: false,
      clarifyingQuestion: null,
      citations: [],
    };
  }

  const isAmbiguous = Boolean(expectSingle && candidates.length > 1);
  return {
    status: isAmbiguous
      ? 'ambiguous_match'
      : candidates.length === 1
        ? 'resolved'
        : 'multiple',
    matched: candidates,
    matchedBy,
    ambiguous: isAmbiguous,
    clarifyingQuestion: isAmbiguous
      ? buildClarifyingQuestion(candidates, matchedBy)
      : null,
    citations: candidates.map((c) => c.citationId),
  };
}

/**
 * Extracts property resolution signals from natural-language operator questions (FLOW-101).
 */
export function resolvePropertiesFromText(
  store: PortfolioStore,
  text: string,
  options?: {
    includeOnboarding?: boolean;
    expectSingle?: boolean;
    resolutionMode?: ResolutionMode;
    candidatePool?: readonly PropertyRecord[];
  },
): PropertyResolutionResult {
  const pool =
    options?.candidatePool ??
    (options?.includeOnboarding ? store.properties : store.operatingProperties);

  // 1. Check explicit Property IDs (e.g. "P01", "P06 and P07")
  const matchedExplicitProps: PropertyRecord[] = [];
  for (const prop of store.properties) {
    const idPattern = new RegExp(`\\b${escapeRegExp(prop.propertyId)}\\b`, 'i');
    if (idPattern.test(text)) {
      matchedExplicitProps.push(prop);
    }
  }
  if (matchedExplicitProps.length === 1) {
    const prop = matchedExplicitProps[0];
    return {
      status: 'resolved',
      matched: [prop],
      matchedBy: [`property_id="${prop.propertyId}"`],
      ambiguous: false,
      clarifyingQuestion: null,
      citations: [prop.citationId],
    };
  }
  if (matchedExplicitProps.length > 1) {
    const operatingMatches = options?.includeOnboarding
      ? matchedExplicitProps
      : matchedExplicitProps.filter((p) => p.isOperating);
    return {
      status: 'multiple',
      matched: operatingMatches,
      matchedBy: [
        `property_ids=[${operatingMatches.map((p) => p.propertyId).join(', ')}]`,
      ],
      ambiguous: false,
      clarifyingQuestion: null,
      citations: operatingMatches.map((p) => p.citationId),
    };
  }

  // 2. Check Building Names and Aliases (longest first so "Halsted & Lake" matches before "Halsted")
  const nameAliasEntries: Array<{
    prop: PropertyRecord;
    label: string;
    kind: 'name' | 'alias';
  }> = [];
  for (const prop of store.properties) {
    nameAliasEntries.push({ prop, label: prop.name, kind: 'name' });
    for (const alias of prop.aka) {
      nameAliasEntries.push({ prop, label: alias, kind: 'alias' });
    }
  }
  nameAliasEntries.sort((a, b) => b.label.length - a.label.length);

  const matchedByNameProps = new Map<string, { prop: PropertyRecord; desc: string }>();
  for (const entry of nameAliasEntries) {
    const pat = new RegExp(`\\b${escapeRegExp(entry.label)}\\b`, 'i');
    if (pat.test(text) && !matchedByNameProps.has(entry.prop.propertyId)) {
      const suffix = !entry.prop.isOperating
        ? ' (onboarding property, 0 units)'
        : '';
      matchedByNameProps.set(entry.prop.propertyId, {
        prop: entry.prop,
        desc: `${entry.kind}="${entry.label}"${suffix}`,
      });
    }
  }

  if (matchedByNameProps.size === 1) {
    const only = [...matchedByNameProps.values()][0];
    return {
      status: 'resolved',
      matched: [only.prop],
      matchedBy: [only.desc],
      ambiguous: false,
      clarifyingQuestion: null,
      citations: [only.prop.citationId],
    };
  }
  if (matchedByNameProps.size > 1) {
    const entries = [...matchedByNameProps.values()];
    const props = entries.map((e) => e.prop);
    return {
      status: 'multiple',
      matched: props,
      matchedBy: entries.map((e) => e.desc),
      ambiguous: false,
      clarifyingQuestion: null,
      citations: props.map((p) => p.citationId),
    };
  }

  // 3. Attribute-based filtering (Neighborhood, PMS, Class, Year Built, Amenities)
  let filtered = [...pool];
  const matchedBy: string[] = [];

  const neighborhoods = [...new Set(pool.map((p) => p.neighborhood))];
  for (const nb of neighborhoods) {
    const pat = new RegExp(`\\b${escapeRegExp(nb)}\\b`, 'i');
    if (pat.test(text)) {
      filtered = filtered.filter((p) => p.neighborhood === nb);
      matchedBy.push(`neighborhood="${nb}"`);
    }
  }

  const pmsList = [...new Set(pool.map((p) => p.pms))];
  for (const pms of pmsList) {
    const pat = new RegExp(`\\b${escapeRegExp(pms)}\\b`, 'i');
    if (pat.test(text)) {
      filtered = filtered.filter((p) => p.pms === pms);
      matchedBy.push(`pms="${pms}"`);
    }
  }

  // Building Class (e.g., "class A", "class B", "Class-A")
  const classMatch = text.match(/\bclass[\s-]+([ab])\b/i);
  if (classMatch && !/\bclass\s+a\s+vs\.?\s+class\s+b\b/i.test(text) && !/\bclass\s+a\s+versus\s+class\s+b\b/i.test(text)) {
    const targetClass = classMatch[1].toUpperCase();
    filtered = filtered.filter(
      (p) => p.buildingClass.toUpperCase() === targetClass,
    );
    matchedBy.push(`class="${targetClass}"`);
  }

  // Year Built filters (e.g., "built before 1980", "built in 2016 or later", "built after 2015")
  const builtBeforeMatch = text.match(/\b(?:built\s+before|pre-)\s*(\d{4})\b/i);
  if (builtBeforeMatch) {
    const maxYear = Number.parseInt(builtBeforeMatch[1], 10) - 1;
    filtered = filtered.filter((p) => p.yearBuilt <= maxYear);
    matchedBy.push(`year_built<=${maxYear}`);
  }
  const builtOnOrAfterMatch = text.match(
    /\bbuilt\s+(?:in\s+)?(\d{4})\s+or\s+(?:later|after|newer)\b/i,
  );
  if (builtOnOrAfterMatch) {
    const minYear = Number.parseInt(builtOnOrAfterMatch[1], 10);
    filtered = filtered.filter((p) => p.yearBuilt >= minYear);
    matchedBy.push(`year_built>=${minYear}`);
  }
  const builtAfterMatch = text.match(/\bbuilt\s+after\s+(\d{4})\b/i);
  if (builtAfterMatch) {
    const minYear = Number.parseInt(builtAfterMatch[1], 10) + 1;
    filtered = filtered.filter((p) => p.yearBuilt >= minYear);
    matchedBy.push(`year_built>=${minYear}`);
  }

  // Exempt unit-level view phrases from triggering building-level amenity filters
  const isUnitLevelLakeViewOnly =
    (/\bunits?\s+with\s+a\s+lake\s+view\b/i.test(text) ||
      /\blake[-\s]view\s+units?\b/i.test(text) ||
      /\bview\s*[=:]\s*['"`]?lake['"`]?\b/i.test(text)) &&
    !/\blakefront\b/i.test(text) &&
    !/\bbuilding\b.*\blake\s+view\b/i.test(text);

  const isUnitLevelCourtyardViewOnly =
    (/\bcourtyard[-\s]view\b/i.test(text) ||
      /\bunits?\s+with\s+a\s+courtyard\s+view\b/i.test(text) ||
      /\bcourtyard\s+units?\b/i.test(text) ||
      /\bview\s*[=:]\s*['"`]?courtyard['"`]?\b/i.test(text)) &&
    !/\bbuilding[s]?\s+with\s+(?:a\s+)?courtyard\b/i.test(text);

  for (const syn of AMENITY_SYNONYMS) {
    if (syn.canonical === 'lake view' && isUnitLevelLakeViewOnly) {
      continue;
    }
    if (syn.canonical === 'courtyard' && isUnitLevelCourtyardViewOnly) {
      continue;
    }
    if (syn.patterns.some((pat) => pat.test(text))) {
      filtered = filtered.filter((p) =>
        p.amenities.some(
          (a) => a.toLowerCase() === syn.canonical.toLowerCase(),
        ),
      );
      matchedBy.push(`amenity="${syn.canonical}"`);
    }
  }

  if (matchedBy.length === 0) {
    return {
      status: 'not_found',
      matched: [],
      matchedBy: [],
      ambiguous: false,
      clarifyingQuestion: null,
      citations: [],
    };
  }

  const pluralGroupIntent =
    options?.resolutionMode === 'portfolio_filter' ||
    /\b(buildings|among\s+the\s+buildings|of\s+the\s+buildings|across\s+the\s+buildings|in\s+the\s+buildings|among\s+operating|class\s+[ab]\s+buildings|class\s+[ab]\s+units)\b/i.test(
      text,
    );

  const singularBuildingIntent =
    options?.resolutionMode === 'single_building' ||
    (options?.resolutionMode !== 'portfolio_filter' &&
      (options?.expectSingle ??
        (!pluralGroupIntent &&
          /\b(which\s+.*building|the\s+.*building|our\s+.*building|the\s+lakefront\s+one|the\s+brick\s+one|the\s+one\s+with|high-rise|at\s+the\s+)/i.test(
            text,
          ))));

  const isAmbiguous = Boolean(singularBuildingIntent && filtered.length > 1);

  return {
    status: isAmbiguous
      ? 'ambiguous_match'
      : filtered.length === 1
        ? 'resolved'
        : filtered.length > 1
          ? 'multiple'
          : 'not_found',
    matched: filtered,
    matchedBy,
    ambiguous: isAmbiguous,
    clarifyingQuestion: isAmbiguous
      ? buildClarifyingQuestion(filtered, matchedBy)
      : null,
    citations: filtered.map((c) => c.citationId),
  };
}
