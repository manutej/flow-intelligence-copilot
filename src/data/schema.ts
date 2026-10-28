import type { PortfolioPolicyConfig } from '../config/rules.ts';

/**
 * Strict domain and data types for the FLOW portfolio engine (FLOW-101..106).
 *
 * Architectural invariant (FLOW-103):
 * `SanitizedLeadRecord` omits `notes` at the type level so unreviewed free text
 * and prompt injections (e.g., D01011) can never enter analytical calculations
 * or LLM tool responses under guarded policy (`quarantineCrmNotes = true`).
 */

export type TableName =
  | 'properties'
  | 'units'
  | 'leases'
  | 'leads'
  | 'spend'
  | 'decisions';

export type CitationId = `${TableName}:${string}`;

export type UnitStatus = 'occupied' | 'notice' | 'vacant';
export type LeaseType = 'new' | 'renewal';
export type RenewalStatus = 'renewed' | 'pending' | 'notice_given' | 'not_due';
export type SpendCurrency = 'USD' | 'CAD';
export type SpendStatus = 'posted' | 'void';
export type DecisionDirection = 'increase' | 'decrease';

export interface OnboardingReadinessCheck {
  readonly hasUnitsInUnitsCsv: boolean;
  readonly unitCountMatchesDeclared: boolean;
  readonly noBase64TokensInAka: boolean;
  readonly pmsAdapterSupported: boolean;
  readonly readyForOperatingPool: boolean;
  readonly blockingReasons: readonly string[];
}

export interface PropertyRecord {
  readonly citationId: `properties:${string}`;
  readonly propertyId: string;
  readonly name: string;
  readonly aka: readonly string[];
  readonly decodedEasterEggUrls: readonly string[];
  readonly address: string;
  readonly neighborhood: string;
  readonly yearBuilt: number;
  readonly buildingClass: string;
  readonly amenities: readonly string[];
  readonly pms: string;
  readonly declaredUnits: number;
  readonly actualUnitCount: number;
  readonly isOperating: boolean;
  readonly onboardingReadiness: OnboardingReadinessCheck;
}

export interface UnitRecord {
  readonly citationId: `units:${string}`;
  readonly unitId: string;
  readonly propertyId: string;
  readonly unitNumber: string;
  readonly bedrooms: number;
  readonly bathrooms: number;
  readonly sqft: number;
  readonly floor: number;
  readonly view: string;
  readonly marketRent: number;
  readonly status: UnitStatus;
}

export interface LeaseRecord {
  readonly citationId: `leases:${string}`;
  readonly leaseId: string;
  readonly unitId: string;
  readonly propertyId: string;
  readonly residentId: string;
  readonly leaseType: LeaseType;
  readonly startDate: string;
  readonly startMonth: string;
  readonly endDate: string;
  readonly endMonth: string;
  readonly monthlyRent: number;
  readonly concessionUsd: number;
  readonly renewalStatus: RenewalStatus;
}

export interface SanitizedLeadRecord {
  readonly citationId: `leads:${string}`;
  readonly leadId: string;
  readonly propertyId: string;
  readonly createdDate: string;
  readonly createdMonth: string;
  readonly source: string;
  readonly bedroomsWanted: number;
  readonly toured: boolean;
  readonly applied: boolean;
  readonly leased: boolean;
  readonly leaseId: string | null;
  readonly isEarliestForLease: boolean;
  readonly isDuplicateForLease: boolean;
  readonly duplicateOfLeadId: string | null;
}

export interface QuarantinedLeadNote {
  readonly citationId: `leads:${string}`;
  readonly leadId: string;
  readonly propertyId: string;
  readonly source: string;
  readonly rawNote: string;
  readonly isPhoneReentryDuplicateNote: boolean;
  readonly isPromptInjectionAttempt: boolean;
  readonly injectionReason: string | null;
}

export interface SpendRecord {
  readonly citationId: `spend:${string}`;
  readonly spendId: string;
  readonly month: string;
  readonly propertyId: string;
  readonly source: string;
  readonly rawAmount: number;
  readonly currency: SpendCurrency;
  readonly status: SpendStatus;
  readonly isVoid: boolean;
  readonly effectiveUsd: number;
}

export interface DecisionRecord {
  readonly citationId: `decisions:${string}`;
  readonly decisionId: string;
  readonly month: string;
  readonly propertyId: string;
  readonly source: string;
  readonly recommendation: DecisionDirection;
  readonly deltaUsd: number;
  readonly accepted: boolean;
  readonly decidedBy: string;
}

export interface SignedLeaseAttribution {
  readonly leaseId: string;
  readonly leaseCitationId: `leases:${string}`;
  readonly earliestLeadId: string;
  readonly leadCitationId: `leads:${string}`;
  readonly duplicateLeadIds: readonly string[];
  readonly propertyId: string;
  readonly unitId: string;
  readonly source: string;
  readonly leadCreatedDate: string;
  readonly leadCreatedMonth: string;
  readonly leaseStartDate: string;
  readonly leaseStartMonth: string;
  readonly leaseEndDate: string;
  readonly monthlyRent: number;
  readonly concessionUsd: number;
  readonly leaseType: LeaseType;
}

export interface PortfolioStore {
  readonly dataDir: string;
  readonly policy: PortfolioPolicyConfig;
  readonly properties: readonly PropertyRecord[];
  readonly operatingProperties: readonly PropertyRecord[];
  readonly onboardingProperties: readonly PropertyRecord[];
  readonly units: readonly UnitRecord[];
  readonly leases: readonly LeaseRecord[];
  readonly leads: readonly SanitizedLeadRecord[];
  readonly deduplicatedLeads: readonly SanitizedLeadRecord[];
  readonly duplicateLeads: readonly SanitizedLeadRecord[];
  readonly quarantinedNotes: readonly QuarantinedLeadNote[];
  readonly promptInjectionAttempts: readonly QuarantinedLeadNote[];
  readonly spend: readonly SpendRecord[];
  readonly postedSpend: readonly SpendRecord[];
  readonly voidSpend: readonly SpendRecord[];
  readonly paidSources: readonly string[];
  readonly organicSources: readonly string[];
  readonly signedLeases: readonly SignedLeaseAttribution[];
  readonly decisions: readonly DecisionRecord[];
  readonly primaryKeyIndex: ReadonlySet<CitationId>;
}

export interface QuestionRecord {
  readonly id: string;
  readonly type: string;
  readonly question: string;
  readonly result_schema?: Readonly<Record<string, string>>;
  readonly expected?: Readonly<Record<string, unknown>>;
}

export interface AnswerEnvelope {
  readonly id: string;
  readonly answer: string;
  readonly result: Readonly<Record<string, unknown>>;
  readonly citations: readonly CitationId[];
}
