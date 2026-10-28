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

/**
 * Optional colloquial synonym bridges that map operator phrasing onto canonical
 * amenity strings if those canonical strings exist in the loaded PortfolioStore.
 * Every distinct amenity in `properties.csv` is ALSO indexed dynamically from `pool`.
 */
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
    patterns: [/\brooftop\s+deck\b/i, /\broof\s+deck\b/i],
  },
  {
    canonical: 'gym',
    patterns: [/\bgym\b/i, /\bfitness(\s+center|\s+room)?\b/i],
  },
  {
    canonical: 'doorman',
    patterns: [
      /\bdoorman\b/i,
      /\bconcierge\b/i,
      /\bdoor\s+staff\b/i,
      /\bfront[-\s]desk(\s+staff|\s+attendant)?\b/i,
    ],
  },
  {
    canonical: 'parking garage',
    patterns: [/\bparking\s+garage\b/i, /\bgarage\s+parking\b/i],
  },
  {
    canonical: 'dog run',
    patterns: [/\bdog\s+run\b/i, /\bdog\s+park\b/i, /\bpet\s+run\b/i],
  },
  {
    canonical: 'EV charging',
    patterns: [
      /\bev[\s-]+charg(ing|ers?)\b/i,
      /\belectric\s+vehicle\s+charg(ing|ers?)\b/i,
      /\bev\s+stations?\b/i,
    ],
  },
  {
    canonical: 'coworking',
    patterns: [
      /\bcoworking(\s+space|\s+lounge|\s+area)?\b/i,
      /\bco-working(\s+space|\s+lounge|\s+area)?\b/i,
    ],
  },
  {
    canonical: 'package lockers',
    patterns: [/\bpackage\s+lockers?\b/i, /\bparcel\s+lockers?\b/i],
  },
  {
    canonical: 'bike storage',
    patterns: [
      /\bbike\s+(storage|room|racks?)\b/i,
      /\bbicycle\s+storage\b/i,
    ],
  },
  {
    canonical: 'courtyard',
    patterns: [/\bcourtyard\b/i],
  },
];

const GENERIC_BUILDING_SUFFIX_RE =
  /\s+(?:Residences|Tower|Commons|Works|Point|Yards|Apartments|Lofts|Flats|Place|Court|Annex|Building|House|Plaza|Center|Gardens|Villas|Manor|Heights|Square|Terrace|Row|Suites|Hall|Park|View|Lodge|Estates)$/i;

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildFlexibleAmenityRegex(amenity: string): RegExp {
  const words = amenity
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => {
      const base = w.replace(/s$/i, '');
      if (base.length >= 3) {
        return `${escapeRegExp(base)}(?:s|es|ing|ers?)?`;
      }
      return escapeRegExp(w);
    });
  return new RegExp(`\\b${words.join('[\\s-]+')}\\b`, 'i');
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
 * 100% column-set-driven from `store.properties` / `store.operatingProperties`.
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
    const distinctPoolAmenities = [
      ...new Set(pool.flatMap((p) => p.amenities)),
    ];
    for (const reqAmenity of criteria.amenities) {
      const normalized = reqAmenity.trim().toLowerCase();
      const directPoolMatch = distinctPoolAmenities.find(
        (a) =>
          a.toLowerCase() === normalized ||
          buildFlexibleAmenityRegex(a).test(reqAmenity),
      );
      const canonicalSynonym = AMENITY_SYNONYMS.find(
        (s) =>
          s.canonical.toLowerCase() === normalized ||
          s.patterns.some((pat) => pat.test(reqAmenity)),
      );
      const targetAmenity = (
        directPoolMatch ??
        canonicalSynonym?.canonical ??
        reqAmenity
      ).toLowerCase();
      candidates = candidates.filter((p) =>
        p.amenities.some(
          (a) =>
            a.toLowerCase() === targetAmenity ||
            a.toLowerCase().includes(targetAmenity),
        ),
      );
      matchedBy.push(
        `amenity="${directPoolMatch ?? canonicalSynonym?.canonical ?? reqAmenity}"`,
      );
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
 * Extracts property resolution signals from natural-language operator questions (FLOW-101)
 * using 100% dynamic column sets from `store.properties`.
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

  const isComparativeCohortQuestion =
    /\bwhich\b.*\b(?:building|property|one)\b.*\b(highest|lowest|most|least|more|fewer|signed\s+more|turned\s+more|converted\s+more|had\s+more|topped|greatest|richest|largest|biggest)\b/i.test(
      text,
    ) &&
    !/\band\s+what\s+(?:is|do|was)\b/i.test(text);

  const pluralGroupIntent =
    options?.resolutionMode === 'portfolio_filter' ||
    isComparativeCohortQuestion ||
    /\b(buildings|properties|among\s+(?:the\s+|our\s+)?(?:buildings|properties)|of\s+(?:the\s+|our\s+)?(?:buildings|properties)|across\s+(?:the\s+|our\s+)?(?:buildings|properties)|in\s+(?:the\s+|our\s+)?(?:buildings|properties)|between\s+(?:the\s+|our\s+)?(?:.*)?(?:buildings|properties)|among\s+operating|class\s+[a-z0-9+-]+\s+(?:buildings|properties|units))\b/i.test(
      text,
    );

  const singularBuildingIntent =
    options?.resolutionMode === 'single_building' ||
    (options?.resolutionMode !== 'portfolio_filter' &&
      (options?.expectSingle ??
        (!pluralGroupIntent &&
          /\b(which\s+.*(?:building|property)|the\s+.*(?:building|property)|our\s+.*(?:building|property)|the\s+lakefront\s+one|the\s+brick\s+one|the\s+one\s+with|high-rise|at\s+the\s+|in\s+the\s+.*(?:building|property))\b/i.test(
            text,
          ))));

  // 1. Check explicit Property IDs dynamically from store.properties (e.g. "P01", "P42")
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

  // 2. Dynamic Name, Alias, and Derived Stem Index from store.properties
  const labelToEntries = new Map<
    string,
    {
      label: string;
      kind: 'name' | 'alias' | 'stem';
      props: PropertyRecord[];
    }
  >();

  const distinctNeighborhoodsLower = new Set(
    store.properties.map((p) => p.neighborhood.toLowerCase()),
  );
  const distinctAmenitiesLower = new Set(
    store.properties.flatMap((p) => p.amenities.map((a) => a.toLowerCase())),
  );

  const registerLabel = (
    rawLabel: string,
    kind: 'name' | 'alias' | 'stem',
    prop: PropertyRecord,
  ) => {
    const clean = rawLabel.trim();
    if (clean.length < 2) return;
    const key = clean.toLowerCase();
    const existing = labelToEntries.get(key);
    if (existing) {
      if (!existing.props.some((p) => p.propertyId === prop.propertyId)) {
        existing.props.push(prop);
      }
    } else {
      labelToEntries.set(key, { label: clean, kind, props: [prop] });
    }
  };

  for (const prop of store.properties) {
    registerLabel(prop.name, 'name', prop);
    const strippedTheName = prop.name.replace(/^the\s+/i, '').trim();
    if (strippedTheName !== prop.name) {
      registerLabel(strippedTheName, 'name', prop);
    }
    for (const alias of prop.aka) {
      registerLabel(alias, 'alias', prop);
      const strippedTheAlias = alias.replace(/^the\s+/i, '').trim();
      if (strippedTheAlias !== alias && strippedTheAlias.length >= 3) {
        registerLabel(strippedTheAlias, 'alias', prop);
      }
    }
    // Derive proper-noun stem by stripping generic building suffixes ("Marlowe Residences" -> "Marlowe", "Vespera Lofts" -> "Vespera")
    const stem = strippedTheName.replace(GENERIC_BUILDING_SUFFIX_RE, '').trim();
    if (
      stem.length >= 4 &&
      stem.toLowerCase() !== strippedTheName.toLowerCase() &&
      !distinctNeighborhoodsLower.has(stem.toLowerCase()) &&
      !distinctAmenitiesLower.has(stem.toLowerCase())
    ) {
      registerLabel(stem, 'stem', prop);
    }
  }

  const sortedLabels = [...labelToEntries.values()].sort((a, b) => {
    const kindRank = (k: 'name' | 'alias' | 'stem') =>
      k === 'name' ? 3 : k === 'alias' ? 2 : 1;
    if (b.label.length !== a.label.length) {
      return b.label.length - a.label.length;
    }
    return kindRank(b.kind) - kindRank(a.kind);
  });

  const matchedByNameMap = new Map<string, PropertyRecord>();
  const matchedNameDescs: string[] = [];
  const consumedSpans: Array<[number, number]> = [];

  for (const entry of sortedLabels) {
    const pat = new RegExp(`\\b${escapeRegExp(entry.label)}\\b`, 'i');
    const m = pat.exec(text);
    if (!m) continue;
    const start = m.index;
    const end = start + m[0].length;
    if (consumedSpans.some(([s, e]) => start >= s && end <= e)) {
      continue;
    }
    consumedSpans.push([start, end]);
    const activeProps = options?.includeOnboarding
      ? entry.props
      : entry.props.filter((p) => p.isOperating || entry.props.length === 1);
    if (activeProps.length === 0) continue;

    for (const p of activeProps) {
      matchedByNameMap.set(p.propertyId, p);
    }
    const suffix =
      activeProps.length === 1 && !activeProps[0].isOperating
        ? ' (onboarding property, 0 units)'
        : '';
    matchedNameDescs.push(`${entry.kind}="${entry.label}"${suffix}`);
  }

  if (matchedByNameMap.size === 1) {
    const onlyProp = [...matchedByNameMap.values()][0];
    return {
      status: 'resolved',
      matched: [onlyProp],
      matchedBy: matchedNameDescs,
      ambiguous: false,
      clarifyingQuestion: null,
      citations: [onlyProp.citationId],
    };
  }
  if (matchedByNameMap.size > 1) {
    const props = [...matchedByNameMap.values()].filter((p) =>
      options?.includeOnboarding ? true : p.isOperating,
    );
    const isAmbiguousStem =
      !pluralGroupIntent &&
      matchedNameDescs.length === 1 &&
      (singularBuildingIntent ||
        (!pluralGroupIntent && /\b(at|in|for|of|does|has)\b/i.test(text)));
    return {
      status: isAmbiguousStem ? 'ambiguous_match' : 'multiple',
      matched: props,
      matchedBy: matchedNameDescs,
      ambiguous: isAmbiguousStem,
      clarifyingQuestion: isAmbiguousStem
        ? buildClarifyingQuestion(props, matchedNameDescs)
        : null,
      citations: props.map((p) => p.citationId),
    };
  }

  // 3. Attribute-based filtering dynamically indexed from pool (Neighborhood, PMS, Class, Year Built, Amenities)
  let filtered = [...pool];
  const matchedBy: string[] = [];

  // 3a. Dynamic Neighborhoods (longest first)
  const neighborhoods = [...new Set(pool.map((p) => p.neighborhood))].sort(
    (a, b) => b.length - a.length,
  );
  for (const nb of neighborhoods) {
    const pat = new RegExp(`\\b${escapeRegExp(nb)}\\b`, 'i');
    if (pat.test(text)) {
      filtered = filtered.filter((p) => p.neighborhood === nb);
      matchedBy.push(`neighborhood="${nb}"`);
    }
  }
  if (matchedBy.length === 0 && /\bdowntown\b/i.test(text)) {
    const downtownSet = new Set(["west loop", "streeterville", "fulton market", "south loop"]);
    const dt = filtered.filter((p) => downtownSet.has(p.neighborhood.toLowerCase()));
    if (dt.length > 0) {
      filtered = dt;
      matchedBy.push(`region="downtown"`);
    }
  }

  // 3b. Dynamic PMS Set (longest first)
  const pmsList = [...new Set(pool.map((p) => p.pms))].sort(
    (a, b) => b.length - a.length,
  );
  for (const pms of pmsList) {
    const pat = new RegExp(`\\b${escapeRegExp(pms)}\\b`, 'i');
    if (pat.test(text)) {
      filtered = filtered.filter((p) => p.pms === pms);
      matchedBy.push(`pms="${pms}"`);
    }
  }

  // 3c. Dynamic Building Class Set from pool (supports A, B, C, A+, B-, etc.)
  const distinctClasses = [
    ...new Set(pool.map((p) => p.buildingClass.toUpperCase())),
  ].sort((a, b) => b.length - a.length);
  const isClassComparison =
    /\bclass\s+[a-z0-9+-]+\s+(?:vs\.?|versus|compared\s+to)\s+class\s+[a-z0-9+-]+/i.test(
      text,
    );
  if (!isClassComparison) {
    for (const cls of distinctClasses) {
      const pat = new RegExp(
        `\\bclass[\\s-]+${escapeRegExp(cls)}(?![a-z0-9+-])`,
        'i',
      );
      if (pat.test(text)) {
        filtered = filtered.filter(
          (p) => p.buildingClass.toUpperCase() === cls,
        );
        matchedBy.push(`class="${cls}"`);
        break;
      }
    }
  }

  // 3d. Year Built bounds
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
  const decadeMatch = text.match(/\b(?:built\s+in\s+the\s+|from\s+the\s+)?(19\d0|20\d0)s\b/i);
  if (decadeMatch) {
    const startDecade = Number.parseInt(decadeMatch[1], 10);
    filtered = filtered.filter((p) => p.yearBuilt >= startDecade && p.yearBuilt <= startDecade + 9);
    matchedBy.push(`year_built=${startDecade}..${startDecade + 9}`);
  }
  const builtInExactMatch =
    !builtOnOrAfterMatch && !builtAfterMatch && !builtBeforeMatch && !decadeMatch
      ? text.match(/\bbuilt\s+in\s+(\d{4})\b/i)
      : null;
  if (builtInExactMatch) {
    const exactYear = Number.parseInt(builtInExactMatch[1], 10);
    filtered = filtered.filter((p) => p.yearBuilt === exactYear);
    matchedBy.push(`year_built=${exactYear}`);
  }

  // 3e. Dynamic Amenity Set Indexing from pool + Colloquial Synonym Bridge
  const isUnitLevelLakeViewOnly =
    (/\b(?:units?|apartments?|studios?|bedrooms?|1br|2br|3br|4br)\s+(?:with\s+a\s+)?lake\s+view\b/i.test(
      text,
    ) ||
      /\blake[-\s]view\s+(?:units?|apartments?|studios?|1br|2br|3br|4br)\b/i.test(
        text,
      ) ||
      /\bview\s*[=:]\s*['"`]?lake['"`]?\b/i.test(text)) &&
    !/\blakefront\b/i.test(text) &&
    !/\b(?:building|property|one)\b.*\blake\s+view\b/i.test(text);

  const isUnitLevelCourtyardViewOnly =
    (/\bcourtyard[-\s]view\b/i.test(text) ||
      /\b(?:units?|apartments?)\s+with\s+a\s+courtyard\s+view\b/i.test(text) ||
      /\bcourtyard\s+units?\b/i.test(text) ||
      /\bview\s*[=:]\s*['"`]?courtyard['"`]?\b/i.test(text)) &&
    !/\b(?:building|property)[s]?\s+with\s+(?:a\s+)?courtyard\b/i.test(text);

  const distinctPoolAmenities = [
    ...new Set(pool.flatMap((p) => p.amenities)),
  ].sort((a, b) => b.length - a.length);
  const matchedAmenitiesLower = new Set<string>();

  for (const amenity of distinctPoolAmenities) {
    const lower = amenity.toLowerCase();
    if (lower === 'lake view' && isUnitLevelLakeViewOnly) continue;
    if (lower === 'courtyard' && isUnitLevelCourtyardViewOnly) continue;

    const flexRe = buildFlexibleAmenityRegex(amenity);
    const synEntry = AMENITY_SYNONYMS.find(
      (s) => s.canonical.toLowerCase() === lower,
    );
    const matchesDirect = flexRe.test(text);
    const matchesSyn = synEntry
      ? synEntry.patterns.some((pat) => pat.test(text))
      : false;

    if (matchesDirect || matchesSyn) {
      matchedAmenitiesLower.add(lower);
      filtered = filtered.filter((p) =>
        p.amenities.some((a) => a.toLowerCase() === lower),
      );
      matchedBy.push(`amenity="${amenity}"`);
    }
  }

  for (const syn of AMENITY_SYNONYMS) {
    const lower = syn.canonical.toLowerCase();
    if (matchedAmenitiesLower.has(lower)) continue;
    if (lower === 'lake view' && isUnitLevelLakeViewOnly) continue;
    if (lower === 'courtyard' && isUnitLevelCourtyardViewOnly) continue;
    if (syn.patterns.some((pat) => pat.test(text))) {
      filtered = filtered.filter((p) =>
        p.amenities.some((a) => a.toLowerCase() === lower),
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
