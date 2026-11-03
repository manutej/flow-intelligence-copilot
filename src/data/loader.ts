import { rowFactViolations } from './row-facts.ts';
import { fileURLToPath } from "node:url";
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
import { convert, toolRate } from '../tools/currency.ts';

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
    .map((text, i) => ({ text: text.replace(/\r$/, ''), lineNo: i + 1 }))
    .filter((l) => l.text.trim().length > 0);

  if (lines.length === 0) {
    return [];
  }

  const headers = parseCsvLine(lines[0].text);
  const rows: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i].text);
    if (values.length !== headers.length) {
      throw new DataLoadError(`${filePath} line ${lines[i].lineNo} has ${values.length} fields; the header has ${headers.length}`);
    }
    const record: Record<string, string> = {};
    for (let h = 0; h < headers.length; h += 1) {
      record[headers[h]] = values[h] ?? '';
    }
    rows.push(record);
  }
  return rows;
}

/** A CSV export that is missing, empty, or lacks the columns the engine reads. */
export class DataLoadError extends Error {
  override readonly name = 'DataLoadError';
}

/** Columns each export must carry; the engine reads every one of them. */
export const REQUIRED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  'pms/properties.csv': ['property_id', 'name', 'aka', 'address', 'neighborhood', 'year_built', 'class', 'amenities', 'pms', 'units'],
  'pms/units.csv': ['unit_id', 'property_id', 'unit_number', 'bedrooms', 'bathrooms', 'sqft', 'floor', 'view', 'market_rent', 'status'],
  'pms/leases.csv': ['lease_id', 'unit_id', 'resident_id', 'lease_type', 'start_date', 'end_date', 'monthly_rent', 'concession_usd', 'renewal_status'],
  'crm/leads.csv': ['lead_id', 'property_id', 'created_date', 'source', 'bedrooms_wanted', 'toured', 'applied', 'leased', 'lease_id', 'notes'],
  'ils/spend.csv': ['spend_id', 'month', 'property_id', 'source', 'amount', 'currency', 'status'],
  'ops/decisions.csv': ['decision_id', 'month', 'property_id', 'source', 'recommendation', 'delta_usd', 'accepted', 'decided_by'],
};

/** Reads one export and fails with a DataLoadError naming the file and the problem. */
export function readRequiredCsv(dataDir: string, relPath: string): Array<Record<string, string>> {
  const filePath = path.join(dataDir, relPath);
  if (!fs.existsSync(filePath)) {
    throw new DataLoadError(`${filePath} does not exist`);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  const firstLine = content.split('\n').map((l) => l.replace(/\r$/, '')).find((l) => l.trim().length > 0);
  if (!firstLine) {
    throw new DataLoadError(`${filePath} is empty (expected a header row and data rows)`);
  }
  const headers = new Set(parseCsvLine(firstLine).map((h) => h.trim()));
  const missing = (REQUIRED_COLUMNS[relPath] ?? []).filter((c) => !headers.has(c));
  if (missing.length > 0) {
    throw new DataLoadError(`${filePath} is missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`);
  }
  const rows = readCsvRecords(filePath);
  if (rows.length === 0) {
    throw new DataLoadError(`${filePath} has a header but no data rows`);
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

/**
 * properties.csv is untrusted input. An alias is kept only when it reads as
 * a display name: letters, digits, spaces and name punctuation, at least one
 * space or a short single word. Anything else (an encoded blob, a URL) is
 * withheld: it is never decoded, resolved against, or put in answer text.
 */
function isDisplayName(token: string): boolean {
  if (!/^[\p{L}\p{N}][\p{L}\p{N} &'’.-]{0,59}$/u.test(token)) return false;
  // One long unbroken token with mixed case and digits is an encoding, not a name.
  if (!/\s/.test(token) && token.length >= 16) return false;
  if (/\.[a-z]{2,}(?:\/|$)/i.test(token)) return false;
  return true;
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

const storeCache = new Map<string, PortfolioStore>();
/**
 * Each policy override builds its own store. A public endpoint can ask for
 * many assumption sets, so keep only the most recent few.
 */
const MAX_CACHED_STORES = 16;

export function resetPortfolioStoreCache(): void {
  storeCache.clear();
}

const REPO_ROOT_FALLBACK = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export function resolveDataDirectory(repoRootDir?: string): string {
  if (repoRootDir) {
    const explicitRoot = path.resolve(repoRootDir);
    if (fs.existsSync(path.join(explicitRoot, "pms", "properties.csv"))) {
      return explicitRoot;
    }
    return path.join(explicitRoot, "data");
  }
  if (process.env.FLOW_DATA_DIR) {
    const envDir = path.resolve(process.env.FLOW_DATA_DIR);
    if (fs.existsSync(path.join(envDir, "pms", "properties.csv"))) {
      return envDir;
    }
    if (fs.existsSync(path.join(envDir, "data", "pms", "properties.csv"))) {
      return path.join(envDir, "data");
    }
  }
  const cwdData = path.resolve(process.cwd(), "data");
  if (fs.existsSync(path.join(cwdData, "pms", "properties.csv"))) {
    return cwdData;
  }
  return path.join(REPO_ROOT_FALLBACK, "data");
}

type Rows = Array<Record<string, string>>;

/**
 * Every answer joins these tables, so a row whose key repeats or whose
 * foreign key points nowhere would be counted, priced or cited wrongly.
 * Refuse to load instead; the caller reports a data error.
 */
const SPEND_ROW_CEILING_USD = 1_000_000;

function assertReferentialIntegrity(properties: Rows, units: Rows, leases: Rows, leads: Rows, spend: Rows, decisions: Rows): void {
  const keys = (rows: Rows, file: string, key: string): Set<string> => {
    const seen = new Set<string>();
    // Ids are compared without case or padding: "U0101" and "u0101 " name one row (F-069).
    const folded = new Set<string>();
    for (const r of rows) {
      const k = r[key].trim().toUpperCase();
      if (folded.has(k)) throw new DataLoadError(`${file} repeats ${key} ${r[key]}`);
      folded.add(k);
      seen.add(r[key]);
    }
    return seen;
  };
  const refs = (rows: Rows, file: string, key: string, column: string, target: Set<string>, optional = false): void => {
    for (const r of rows) {
      const v = r[column].trim();
      if (optional && v === '') continue;
      if (!target.has(v)) throw new DataLoadError(`${file} row ${r[key]} has ${column} ${v || '(empty)'}, which does not exist`);
    }
  };
  const propertyIds = keys(properties, 'pms/properties.csv', 'property_id');
  const unitIds = keys(units, 'pms/units.csv', 'unit_id');
  const leaseIds = keys(leases, 'pms/leases.csv', 'lease_id');
  keys(leads, 'crm/leads.csv', 'lead_id');
  keys(spend, 'ils/spend.csv', 'spend_id');
  keys(decisions, 'ops/decisions.csv', 'decision_id');
  refs(units, 'pms/units.csv', 'unit_id', 'property_id', propertyIds);
  refs(leases, 'pms/leases.csv', 'lease_id', 'unit_id', unitIds);
  refs(leads, 'crm/leads.csv', 'lead_id', 'property_id', propertyIds);
  refs(leads, 'crm/leads.csv', 'lead_id', 'lease_id', leaseIds, true);
  refs(spend, 'ils/spend.csv', 'spend_id', 'property_id', propertyIds);
  refs(decisions, 'ops/decisions.csv', 'decision_id', 'property_id', propertyIds);
  for (const r of spend) {
    // Plain decimals only (no 1e9) and a ceiling one row of monthly spend can reach (F-069).
    const amount = /^\d+(?:\.\d{1,2})?$/.test(r.amount.trim()) ? Number(r.amount) : NaN;
    if (!Number.isFinite(amount) || amount > SPEND_ROW_CEILING_USD) {
      throw new DataLoadError(`ils/spend.csv row ${r.spend_id} has amount ${r.amount}; spend must be a plain amount from 0 to ${SPEND_ROW_CEILING_USD}`);
    }
  }
}

/**
 * The data dictionary's domains (S0b F-046). A value outside them would be
 * counted, averaged or compared as if it were real: a 700.5 sq ft unit
 * breaks whole-number bounds, a negative rent drags an average, and
 * 2026-02-30 shifts a window. Refuse to load instead, as for a broken key.
 */
function assertFieldDomains(units: Rows, leases: Rows, spend: Rows): void {
  const bad = (file: string, id: string, col: string, v: string, want: string) => {
    throw new DataLoadError(`${file} row ${id} has ${col} ${JSON.stringify(v)}; ${col} must be ${want}`);
  };
  const int = (v: string, lo: number, hi: number) => /^-?\d+$/.test(v) && Number(v) >= lo && Number(v) <= hi;
  const num = (v: string, lo: number, hi: number) => /^-?\d+(?:\.\d+)?$/.test(v) && Number(v) >= lo && Number(v) <= hi;
  const day = (v: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (!m) return undefined;
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    return new Date(t).toISOString().slice(0, 10) === v ? t : undefined;
  };
  const rentOf = new Map<string, number>();
  for (const u of units) {
    const f = 'pms/units.csv', id = u.unit_id;
    if (!int(u.bedrooms, 0, 10)) bad(f, id, 'bedrooms', u.bedrooms, 'a whole number from 0 to 10');
    if (!num(u.bathrooms, 0.5, 10) || Number(u.bathrooms) % 0.5 !== 0) bad(f, id, 'bathrooms', u.bathrooms, 'a multiple of 0.5 from 0.5 to 10');
    if (!int(u.sqft, 100, 20000)) bad(f, id, 'sqft', u.sqft, 'a whole number from 100 to 20000');
    if (!int(u.floor, 0, 200)) bad(f, id, 'floor', u.floor, 'a whole number from 0 to 200');
    if (!['vacant', 'occupied', 'notice'].includes(u.status)) bad(f, id, 'status', u.status, 'vacant, occupied or notice, exactly');
    if (!num(u.market_rent, 1, 50000)) bad(f, id, 'market_rent', u.market_rent, 'a positive amount up to 50000');
    rentOf.set(id, Number(u.market_rent));
  }
  for (const l of leases) {
    const f = 'pms/leases.csv', id = l.lease_id;
    const start = day(l.start_date), end = day(l.end_date);
    if (start === undefined) bad(f, id, 'start_date', l.start_date, 'a real YYYY-MM-DD date');
    if (end === undefined) bad(f, id, 'end_date', l.end_date, 'a real YYYY-MM-DD date');
    const days = ((end as number) - (start as number)) / 864e5;
    if (days < 28 || days > 1096) bad(f, id, 'end_date', l.end_date, 'from 28 days to 3 years after start_date');
    const market = rentOf.get(l.unit_id);
    if (!num(l.monthly_rent, 1, 50000) || (market !== undefined && (Number(l.monthly_rent) < market / 2 || Number(l.monthly_rent) > market * 2))) {
      bad(f, id, 'monthly_rent', l.monthly_rent, "positive and within half to twice the unit's market_rent");
    }
    if (l.concession_usd !== '' && !num(l.concession_usd, 0, 50000)) bad(f, id, 'concession_usd', l.concession_usd, 'empty or an amount at least 0');
  }
  for (const r of spend) {
    if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(r.month)) bad('ils/spend.csv', r.spend_id, 'month', r.month, 'a real YYYY-MM month');
  }
}

export function loadPortfolioStore(
  repoRootDir?: string,
  policyOverrides?: Partial<PortfolioPolicyConfig>,
): PortfolioStore {
  const dataDir = resolveDataDirectory(repoRootDir);
  const policy = resolvePolicyConfig(policyOverrides);
  const cacheKey = `${dataDir}::${policyFingerprint(policy)}`;

  const existing = storeCache.get(cacheKey);
  if (existing) {
    return existing;
  }

  const rawProperties = readRequiredCsv(dataDir, 'pms/properties.csv');
  const rawUnits = readRequiredCsv(dataDir, 'pms/units.csv');
  const rawLeases = readRequiredCsv(dataDir, 'pms/leases.csv');
  const rawLeads = readRequiredCsv(dataDir, 'crm/leads.csv');
  const rawSpend = readRequiredCsv(dataDir, 'ils/spend.csv');
  const rawDecisions = readRequiredCsv(dataDir, 'ops/decisions.csv');

  assertReferentialIntegrity(rawProperties, rawUnits, rawLeases, rawLeads, rawSpend, rawDecisions);
  const primaryKeyIndex = new Map<CitationId, string>();

  // 1. Load Units first so we can verify actual operating buildings (KIT_README rule: >= 1 unit in units.csv)
  const unitCountsByProperty = new Map<string, number>();
  const unitToProperty = new Map<string, string>();
  const units: UnitRecord[] = rawUnits.map((r) => {
    const unitId = r.unit_id;
    const propertyId = r.property_id;
    const citationId = `units:${unitId}` as const;
    primaryKeyIndex.set(citationId, propertyId);
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
    primaryKeyIndex.set(citationId, propertyId);

    const rawAliases = r.aka
      ? r.aka
          .split(/[;,|]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const aka: string[] = [];
    let withheldAliasCount = 0;
    for (const token of rawAliases) {
      if (isDisplayName(token)) aka.push(token);
      else withheldAliasCount += 1;
    }

    const declaredUnits = Number.parseInt(r.units, 10);
    const actualUnitCount = unitCountsByProperty.get(propertyId) ?? 0;
    const hasUnitsInUnitsCsv = actualUnitCount > 0;
    const unitCountMatchesDeclared =
      actualUnitCount > 0 && actualUnitCount === declaredUnits;
    const noBase64TokensInAka = withheldAliasCount === 0;
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
        `${withheldAliasCount} aka value(s) in properties.csv are not display names (withheld, not decoded)`,
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
      withheldAliasCount,
      address: r.address,
      neighborhood: r.neighborhood,
      yearBuilt: Number.parseInt(r.year_built, 10),
      buildingClass: r.class,
      amenities: r.amenities
        ? r.amenities
            .split(/[;,|]/)
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
    const propertyId = unitToProperty.get(r.unit_id) ?? '';
    primaryKeyIndex.set(citationId, propertyId);
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
    primaryKeyIndex.set(citationId, r.property_id);

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
    primaryKeyIndex.set(citationId, r.property_id);

    const rawAmount = Number.parseFloat(r.amount);
    const currency = r.currency as SpendCurrency;
    if (currency !== 'USD' && currency !== 'CAD') {
      throw new Error(
        `Unsupported currency "${r.currency}" on spend row ${spendId}`,
      );
    }
    const status = r.status as SpendStatus;
    const isVoid = status === VOID_INVOICE_STATUS;
    // FIQ-CURRENCY-1 Q2: conversion goes through currency.ts.
    const usd = policy.convertCadToUsd ? convert(rawAmount, currency, 'USD', undefined, toolRate(policy)).amount : rawAmount;
    const effectiveUsd = isVoid && policy.excludeVoidSpend ? 0 : roundTo(usd, 4);

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
    primaryKeyIndex.set(citationId, r.property_id);

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

  // A store that breaks a row fact never answers: the CLI exits 10 and the
  // MCP server reports the load error, before any question is read.
  const violations = rowFactViolations(store);
  if (violations.length > 0) {
    throw new DataLoadError(`${violations.length} row${violations.length > 1 ? 's break' : ' breaks'} the data contract: ${violations.slice(0, 3).map((v) => v.description).join('; ')}`);
  }
  assertFieldDomains(rawUnits, rawLeases, rawSpend);
  storeCache.set(cacheKey, store);
  while (storeCache.size > MAX_CACHED_STORES) {
    const oldest = storeCache.keys().next().value;
    if (oldest === undefined) break;
    storeCache.delete(oldest);
  }
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
