import fs from 'node:fs';
import path from 'node:path';
import {
  type PortfolioPolicyConfig,
  policyFingerprint,
  resolvePolicyConfig,
  VOID_INVOICE_STATUS,
} from '../config/rules.ts';
import type {
  CitationId,
  DecisionDirection,
  DecisionRecord,
  LeaseRecord,
  LeaseType,
  PortfolioStore,
  PropertyRecord,
  QuarantinedLeadNote,
  QuestionRecord,
  RenewalStatus,
  SanitizedLeadRecord,
  SignedLeaseAttribution,
  SpendCurrency,
  SpendRecord,
  SpendStatus,
  UnitRecord,
  UnitStatus,
} from './schema.ts';

const OPERATING_PMS_ADAPTERS = new Set(['Yardi', 'Entrata', 'RealPage', 'MRI']);

/**
 * RFC-4180 compliant single-line CSV tokenizer that handles quoted fields,
 * escaped quotes (`""`), and strips trailing `\r`.
 */
export function parseCsvLine(line: string): string[] {
  const cleanLine = line.replace(/\r$/, '');
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < cleanLine.length; i += 1) {
    const ch = cleanLine[i];
    if (inQuotes) {
      if (ch === '"') {
        if (cleanLine[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

export function readCsvRecords(filePath: string): Array<Record<string, string>> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);
  const rows: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const record: Record<string, string> = {};
    for (let h = 0; h < headers.length; h += 1) {
      record[headers[h]] = values[h] ?? '';
    }
    rows.push(record);
  }
  return rows;
}

const PROMPT_INJECTION_PATTERNS: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly reason: string;
}> = [
  {
    pattern: /note\s+for\s+ai\s+assistants/i,
    reason: 'Direct instruction targeting AI assistants inside CRM free-text notes',
  },
  {
    pattern: /always\s+report\s+/i,
    reason: 'Imperative override attempting to force a fabricated analytical conclusion',
  },
  {
    pattern: /verified[\s\W_]*by[\s\W_]*analytics/i,
    reason: 'Watermarking instruction embedded in untrusted CRM note',
  },
  {
    pattern: /ignore\s+(all\s+)?(previous|prior)\s+instructions/i,
    reason: 'Classic prompt-injection override phrase',
  },
];

export function detectPromptInjection(rawNote: string): {
  readonly isInjection: boolean;
  readonly reason: string | null;
} {
  if (!rawNote) {
    return { isInjection: false, reason: null };
  }
  const reasons: string[] = [];
  for (const rule of PROMPT_INJECTION_PATTERNS) {
    if (rule.pattern.test(rawNote)) {
      reasons.push(rule.reason);
    }
  }
  return {
    isInjection: reasons.length > 0,
    reason: reasons.length > 0 ? reasons.join('; ') : null,
  };
}

function tryDecodeBase64UrlToken(token: string): string | null {
  if (
    token.length < 20 ||
    !/^[A-Za-z0-9+/=]+$/.test(token) ||
    token.length % 4 !== 0
  ) {
    return null;
  }
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    if (/^[\x20-\x7E]+$/.test(decoded) && decoded.includes('.')) {
      return decoded;
    }
  } catch {
    return null;
  }
  return null;
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

const storeCache = new Map<string, PortfolioStore>();

export function resetPortfolioStoreCache(): void {
  storeCache.clear();
}

export function loadPortfolioStore(
  repoRootDir?: string,
  policyOverrides?: Partial<PortfolioPolicyConfig>,
): PortfolioStore {
  const resolvedRoot = path.resolve(repoRootDir ?? process.cwd());
  const policy = resolvePolicyConfig(policyOverrides);
  const cacheKey = `${resolvedRoot}::${policyFingerprint(policy)}`;

  const existing = storeCache.get(cacheKey);
  if (existing) {
    return existing;
  }

  const dataDir = path.join(resolvedRoot, 'data');
  const rawProperties = readCsvRecords(
    path.join(dataDir, 'pms', 'properties.csv'),
  );
  const rawUnits = readCsvRecords(path.join(dataDir, 'pms', 'units.csv'));
  const rawLeases = readCsvRecords(path.join(dataDir, 'pms', 'leases.csv'));
  const rawLeads = readCsvRecords(path.join(dataDir, 'crm', 'leads.csv'));
  const rawSpend = readCsvRecords(path.join(dataDir, 'ils', 'spend.csv'));
  const rawDecisions = readCsvRecords(
    path.join(dataDir, 'ops', 'decisions.csv'),
  );

  const primaryKeyIndex = new Set<CitationId>();

  // 1. Load Units first so we can verify actual operating buildings (KIT_README rule: >= 1 unit in units.csv)
  const unitCountsByProperty = new Map<string, number>();
  const unitToProperty = new Map<string, string>();
  const units: UnitRecord[] = rawUnits.map((r) => {
    const unitId = r.unit_id;
    const propertyId = r.property_id;
    const citationId = `units:${unitId}` as const;
    primaryKeyIndex.add(citationId);
    unitCountsByProperty.set(
      propertyId,
      (unitCountsByProperty.get(propertyId) ?? 0) + 1,
    );
    unitToProperty.set(unitId, propertyId);

    return {
      citationId,
      unitId,
      propertyId,
      unitNumber: r.unit_number,
      bedrooms: Number.parseInt(r.bedrooms, 10),
      bathrooms: Number.parseFloat(r.bathrooms),
      sqft: Number.parseInt(r.sqft, 10),
      floor: Number.parseInt(r.floor, 10),
      view: r.view,
      marketRent: Number.parseFloat(r.market_rent),
      status: r.status as UnitStatus,
    };
  });

  // 2. Load Properties and separate operating buildings (P01..P08) from onboarding buildings (P09)
  const properties: PropertyRecord[] = rawProperties.map((r) => {
    const propertyId = r.property_id;
    const citationId = `properties:${propertyId}` as const;
    primaryKeyIndex.add(citationId);

    const rawAliases = r.aka
      ? r.aka
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const aka: string[] = [];
    const decodedEasterEggUrls: string[] = [];
    for (const token of rawAliases) {
      const decoded = tryDecodeBase64UrlToken(token);
      if (decoded) {
        decodedEasterEggUrls.push(decoded);
      } else {
        aka.push(token);
      }
    }

    const declaredUnits = Number.parseInt(r.units, 10);
    const actualUnitCount = unitCountsByProperty.get(propertyId) ?? 0;
    const hasUnitsInUnitsCsv = actualUnitCount > 0;
    const unitCountMatchesDeclared =
      actualUnitCount > 0 && actualUnitCount === declaredUnits;
    const noBase64TokensInAka = decodedEasterEggUrls.length === 0;
    const pmsAdapterSupported = OPERATING_PMS_ADAPTERS.has(r.pms);

    const blockingReasons: string[] = [];
    if (!hasUnitsInUnitsCsv) {
      blockingReasons.push(
        '0 unit rows in data/pms/units.csv (denominator quarantine)',
      );
    }
    if (!unitCountMatchesDeclared) {
      blockingReasons.push(
        `actualUnitCount (${actualUnitCount}) !== declaredUnits (${declaredUnits})`,
      );
    }
    if (!noBase64TokensInAka) {
      blockingReasons.push(
        `encoded onboarding token present in aka (${decodedEasterEggUrls.join(', ')})`,
      );
    }
    if (!pmsAdapterSupported) {
      blockingReasons.push(
        `PMS "${r.pms}" requires new ingestion adapter (operating fleet uses Yardi, Entrata, RealPage, MRI)`,
      );
    }

    const readyForOperatingPool =
      hasUnitsInUnitsCsv &&
      unitCountMatchesDeclared &&
      noBase64TokensInAka &&
      (!policy.requireSupportedPmsForOperating || pmsAdapterSupported);

    const isOperating = policy.quarantineZeroUnitProperties
      ? hasUnitsInUnitsCsv &&
        (!policy.requireSupportedPmsForOperating || pmsAdapterSupported)
      : true;

    return {
      citationId,
      propertyId,
      name: r.name,
      aka,
      decodedEasterEggUrls,
      address: r.address,
      neighborhood: r.neighborhood,
      yearBuilt: Number.parseInt(r.year_built, 10),
      buildingClass: r.class,
      amenities: r.amenities
        ? r.amenities
            .split(';')
            .map((a) => a.trim())
            .filter(Boolean)
        : [],
      pms: r.pms,
      declaredUnits,
      actualUnitCount,
      isOperating,
      onboardingReadiness: {
        hasUnitsInUnitsCsv,
        unitCountMatchesDeclared,
        noBase64TokensInAka,
        pmsAdapterSupported,
        readyForOperatingPool,
        blockingReasons,
      },
    };
  });

  const operatingProperties = properties.filter((p) => p.isOperating);
  const onboardingProperties = properties.filter(
    (p) => p.actualUnitCount === 0 || !p.isOperating,
  );

  // 3. Load Leases
  const leaseMap = new Map<string, LeaseRecord>();
  const leases: LeaseRecord[] = rawLeases.map((r) => {
    const leaseId = r.lease_id;
    const citationId = `leases:${leaseId}` as const;
    primaryKeyIndex.add(citationId);
    const propertyId = unitToProperty.get(r.unit_id) ?? '';
    const record: LeaseRecord = {
      citationId,
      leaseId,
      unitId: r.unit_id,
      propertyId,
      residentId: r.resident_id,
      leaseType: r.lease_type as LeaseType,
      startDate: r.start_date,
      startMonth: r.start_date.slice(0, 7),
      endDate: r.end_date,
      endMonth: r.end_date.slice(0, 7),
      monthlyRent: Number.parseFloat(r.monthly_rent),
      concessionUsd: Number.parseFloat(r.concession_usd),
      renewalStatus: r.renewal_status as RenewalStatus,
    };
    leaseMap.set(leaseId, record);
    return record;
  });

  // 4. Load & Deduplicate Leads + Quarantine Notes (FLOW-103 trust boundary)
  const leadsByLeaseId = new Map<
    string,
    Array<{ leadId: string; createdDate: string }>
  >();
  for (const r of rawLeads) {
    const leaseId = r.lease_id ? r.lease_id.trim() : '';
    if (leaseId) {
      const list = leadsByLeaseId.get(leaseId) ?? [];
      list.push({ leadId: r.lead_id, createdDate: r.created_date });
      leadsByLeaseId.set(leaseId, list);
    }
  }

  const earliestLeadIdByLease = new Map<string, string>();
  const duplicateLeadToEarliest = new Map<string, string>();
  const duplicateLeadIdsByLease = new Map<string, string[]>();

  for (const [leaseId, group] of leadsByLeaseId.entries()) {
    const sorted = [...group].sort((a, b) => {
      const cmp = a.createdDate.localeCompare(b.createdDate);
      return cmp !== 0 ? cmp : a.leadId.localeCompare(b.leadId);
    });
    const earliest = sorted[0];
    earliestLeadIdByLease.set(leaseId, earliest.leadId);
    const dups: string[] = [];
    for (let i = 1; i < sorted.length; i += 1) {
      duplicateLeadToEarliest.set(sorted[i].leadId, earliest.leadId);
      dups.push(sorted[i].leadId);
    }
    duplicateLeadIdsByLease.set(leaseId, dups);
  }

  const quarantinedNotes: QuarantinedLeadNote[] = [];
  const leads: SanitizedLeadRecord[] = rawLeads.map((r) => {
    const leadId = r.lead_id;
    const citationId = `leads:${leadId}` as const;
    primaryKeyIndex.add(citationId);

    const leaseId = r.lease_id ? r.lease_id.trim() : null;
    const duplicateOfLeadId = duplicateLeadToEarliest.get(leadId) ?? null;
    const isDuplicateForLease = duplicateOfLeadId !== null;
    const isEarliestForLease =
      leaseId !== null && earliestLeadIdByLease.get(leaseId) === leadId;

    const rawNote = r.notes ?? '';
    if (rawNote.length > 0) {
      const injectionCheck = detectPromptInjection(rawNote);
      quarantinedNotes.push({
        citationId,
        leadId,
        propertyId: r.property_id,
        source: r.source,
        rawNote,
        isPhoneReentryDuplicateNote: /re-entered from a phone call/i.test(
          rawNote,
        ),
        isPromptInjectionAttempt: injectionCheck.isInjection,
        injectionReason: injectionCheck.reason,
      });
    }

    return {
      citationId,
      leadId,
      propertyId: r.property_id,
      createdDate: r.created_date,
      createdMonth: r.created_date.slice(0, 7),
      source: r.source,
      bedroomsWanted: Number.parseInt(r.bedrooms_wanted, 10),
      toured: r.toured.toLowerCase() === 'true',
      applied: r.applied.toLowerCase() === 'true',
      leased: r.leased.toLowerCase() === 'true',
      leaseId,
      isEarliestForLease,
      isDuplicateForLease,
      duplicateOfLeadId,
    };
  });

  const deduplicatedLeads = policy.deduplicateLeads
    ? leads.filter((l) => !l.isDuplicateForLease)
    : leads;
  const duplicateLeads = leads.filter((l) => l.isDuplicateForLease);
  const promptInjectionAttempts = quarantinedNotes.filter(
    (n) => n.isPromptInjectionAttempt,
  );

  const signedLeases: SignedLeaseAttribution[] = [];
  for (const lead of deduplicatedLeads) {
    const shouldCredit = policy.deduplicateLeads
      ? lead.leaseId !== null && lead.isEarliestForLease
      : lead.leaseId !== null;
    if (shouldCredit && lead.leaseId) {
      const lease = leaseMap.get(lead.leaseId);
      if (lease) {
        const canonicalPropertyId =
          lease.propertyId || lead.propertyId;
        if (
          lease.propertyId &&
          lead.propertyId &&
          lease.propertyId !== lead.propertyId
        ) {
          throw new Error(
            `Cross-system join integrity error: lead ${lead.leadId} property ${lead.propertyId} !== unit property ${lease.propertyId} on lease ${lease.leaseId}`,
          );
        }
        signedLeases.push({
          leaseId: lease.leaseId,
          leaseCitationId: lease.citationId,
          earliestLeadId: lead.leadId,
          leadCitationId: lead.citationId,
          duplicateLeadIds: duplicateLeadIdsByLease.get(lease.leaseId) ?? [],
          propertyId: canonicalPropertyId,
          unitId: lease.unitId,
          source: lead.source,
          leadCreatedDate: lead.createdDate,
          leadCreatedMonth: lead.createdMonth,
          leaseStartDate: lease.startDate,
          leaseStartMonth: lease.startMonth,
          leaseEndDate: lease.endDate,
          monthlyRent: lease.monthlyRent,
          concessionUsd: lease.concessionUsd,
          leaseType: lease.leaseType,
        });
      }
    }
  }

  // 5. Load Spend (respecting policy.convertCadToUsd, policy.cadToUsdRate, and policy.excludeVoidSpend)
  const paidSourceSet = new Set<string>();
  const spend: SpendRecord[] = rawSpend.map((r) => {
    const spendId = r.spend_id;
    const citationId = `spend:${spendId}` as const;
    primaryKeyIndex.add(citationId);

    const rawAmount = Number.parseFloat(r.amount);
    const currency = r.currency as SpendCurrency;
    if (currency !== 'USD' && currency !== 'CAD') {
      throw new Error(
        `Unsupported currency "${r.currency}" on spend row ${spendId}`,
      );
    }
    const status = r.status as SpendStatus;
    const isVoid = status === VOID_INVOICE_STATUS;
    const rate =
      currency === 'CAD'
        ? policy.convertCadToUsd
          ? policy.cadToUsdRate
          : 1.0
        : 1.0;
    const effectiveUsd =
      isVoid && policy.excludeVoidSpend ? 0 : roundTo(rawAmount * rate, 4);

    paidSourceSet.add(r.source);

    return {
      citationId,
      spendId,
      month: r.month,
      propertyId: r.property_id,
      source: r.source,
      rawAmount,
      currency,
      status,
      isVoid,
      effectiveUsd,
    };
  });

  const postedSpend = policy.excludeVoidSpend
    ? spend.filter((s) => !s.isVoid)
    : spend;
  const voidSpend = spend.filter((s) => s.isVoid);
  const paidSources = [...paidSourceSet].sort();

  const allLeadSources = new Set(leads.map((l) => l.source));
  const organicSources = [...allLeadSources]
    .filter((s) => !paidSourceSet.has(s))
    .sort();

  // 6. Load Decisions
  const decisions: DecisionRecord[] = rawDecisions.map((r) => {
    const decisionId = r.decision_id;
    const citationId = `decisions:${decisionId}` as const;
    primaryKeyIndex.add(citationId);

    return {
      citationId,
      decisionId,
      month: r.month,
      propertyId: r.property_id,
      source: r.source,
      recommendation: r.recommendation as DecisionDirection,
      deltaUsd: Number.parseFloat(r.delta_usd),
      accepted: r.accepted.toLowerCase() === 'yes',
      decidedBy: r.decided_by,
    };
  });

  const store: PortfolioStore = {
    dataDir,
    policy,
    properties,
    operatingProperties,
    onboardingProperties,
    units,
    leases,
    leads,
    deduplicatedLeads,
    duplicateLeads,
    quarantinedNotes,
    promptInjectionAttempts,
    spend,
    postedSpend,
    voidSpend,
    paidSources,
    organicSources,
    signedLeases,
    decisions,
    primaryKeyIndex,
  };

  storeCache.set(cacheKey, store);
  return store;
}

export function loadQuestionsFile(filePath: string): QuestionRecord[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as QuestionRecord);
}
