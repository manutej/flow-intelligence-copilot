/**
 * Central domain configuration, runtime policy resolution, and canonical constants
 * from KIT_README.md & CHANGELOG.md (v2).
 *
 * Designed for:
 * 1. Runtime policy injection (`resolvePolicyConfig`) so changing `process.env.FLOW_*`
 *    or passing a policy override (`POLICY_V0_NAIVE`, `POLICY_V1_JOINED`, `POLICY_V2_GUARDED`)
 *    recomputes all metrics and explanations inside a single Node process without stale caches.
 * 2. Live-session overrides for Diego's 30-minute walkthrough:
 *    - FLOW_CAD_RATE (default: 0.73)
 *    - FLOW_OCCUPIED_INCLUDES_NOTICE (default: 'true')
 *    - FLOW_LEASE_BUCKET_BY (default: 'lease_start_date' | 'lead_created_date')
 *    - FLOW_PRIOR_BETA0 (default: 3250)
 *    - FLOW_TODAY (default: '2026-10-01')
 */

export type LeaseBucketField = 'lease_start_date' | 'lead_created_date';

export interface PortfolioPolicyConfig {
  readonly profileName: string;
  readonly asOfDate: string;
  readonly cadToUsdRate: number;
  readonly convertCadToUsd: boolean;
  readonly occupiedIncludesNotice: boolean;
  readonly leaseBucketBy: LeaseBucketField;
  readonly excludeVoidSpend: boolean;
  readonly deduplicateLeads: boolean;
  readonly includeZeroConcessions: boolean;
  readonly quarantineZeroUnitProperties: boolean;
  readonly requireSupportedPmsForOperating: boolean;
  readonly enableUnknownGuard: boolean;
  readonly enableFairHousingGuard: boolean;
  readonly quarantineCrmNotes: boolean;
  readonly priorLeasesAlpha0: number;
  readonly priorSpendUsdBeta0: number;
}

function parsePositiveFloatEnv(
  raw: string | undefined,
  fallback: number,
  name: string,
): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid ${name}="${raw}": must be a finite positive number (got ${parsed})`,
    );
  }
  return parsed;
}

function parseBooleanEnv(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const norm = raw.trim().toLowerCase();
  if (norm === 'true' || norm === '1' || norm === 'yes' || norm === 'on') {
    return true;
  }
  if (norm === 'false' || norm === '0' || norm === 'no' || norm === 'off') {
    return false;
  }
  return fallback;
}

/**
 * Resolves a validated `PortfolioPolicyConfig` from current `process.env` plus optional overrides.
 * Called at store load and query time so runtime env changes and ablation stages always take effect.
 */
export function resolvePolicyConfig(
  overrides: Partial<PortfolioPolicyConfig> = {},
  env: NodeJS.ProcessEnv = process.env,
): PortfolioPolicyConfig {
  const asOfDate = overrides.asOfDate ?? env.FLOW_TODAY ?? '2026-10-01';
  const cadToUsdRate =
    overrides.cadToUsdRate ??
    parsePositiveFloatEnv(env.FLOW_CAD_RATE, 0.73, 'FLOW_CAD_RATE');
  const occupiedIncludesNotice =
    overrides.occupiedIncludesNotice ??
    parseBooleanEnv(env.FLOW_OCCUPIED_INCLUDES_NOTICE, true);

  const rawBucket = overrides.leaseBucketBy ?? env.FLOW_LEASE_BUCKET_BY;
  const leaseBucketBy: LeaseBucketField =
    rawBucket === 'lead_created_date' ? 'lead_created_date' : 'lease_start_date';

  const priorSpendUsdBeta0 =
    overrides.priorSpendUsdBeta0 ??
    parsePositiveFloatEnv(env.FLOW_PRIOR_BETA0, 3250.0, 'FLOW_PRIOR_BETA0');

  return {
    profileName: overrides.profileName ?? 'v2_guarded',
    asOfDate,
    cadToUsdRate,
    convertCadToUsd: overrides.convertCadToUsd ?? true,
    occupiedIncludesNotice,
    leaseBucketBy,
    excludeVoidSpend: overrides.excludeVoidSpend ?? true,
    deduplicateLeads: overrides.deduplicateLeads ?? true,
    includeZeroConcessions: overrides.includeZeroConcessions ?? true,
    quarantineZeroUnitProperties:
      overrides.quarantineZeroUnitProperties ?? true,
    requireSupportedPmsForOperating:
      overrides.requireSupportedPmsForOperating ?? true,
    enableUnknownGuard: overrides.enableUnknownGuard ?? true,
    enableFairHousingGuard: overrides.enableFairHousingGuard ?? true,
    quarantineCrmNotes: overrides.quarantineCrmNotes ?? true,
    priorLeasesAlpha0: overrides.priorLeasesAlpha0 ?? 1.0,
    priorSpendUsdBeta0,
  };
}

export function policyFingerprint(policy: PortfolioPolicyConfig): string {
  return JSON.stringify(policy);
}

/**
 * Canonical 3-Stage Eval Ablation Policy Presets (FLOW-101..103):
 * - `POLICY_V0_NAIVE`: Naive table lookup (scores 3/10 on dev.jsonl: D01, D05, D10 pass; 7 fail)
 * - `POLICY_V1_JOINED`: Rule-aligned cross-system joins (scores 8/10 on dev.jsonl; D08, D09 fail)
 * - `POLICY_V2_GUARDED`: Full v2 kit rules + safety/schema/note guards (scores 10/10)
 */
export const POLICY_V0_NAIVE: PortfolioPolicyConfig = resolvePolicyConfig({
  profileName: 'v0_naive',
  occupiedIncludesNotice: false,
  leaseBucketBy: 'lead_created_date',
  excludeVoidSpend: false,
  convertCadToUsd: false,
  deduplicateLeads: false,
  includeZeroConcessions: false,
  quarantineZeroUnitProperties: false,
  requireSupportedPmsForOperating: false,
  enableUnknownGuard: false,
  enableFairHousingGuard: false,
  quarantineCrmNotes: false,
});

export const POLICY_V1_JOINED: PortfolioPolicyConfig = resolvePolicyConfig({
  profileName: 'v1_joined',
  occupiedIncludesNotice: true,
  leaseBucketBy: 'lease_start_date',
  excludeVoidSpend: true,
  convertCadToUsd: true,
  deduplicateLeads: true,
  includeZeroConcessions: true,
  quarantineZeroUnitProperties: true,
  requireSupportedPmsForOperating: true,
  enableUnknownGuard: false,
  enableFairHousingGuard: false,
  quarantineCrmNotes: false,
});

export const POLICY_V2_GUARDED: PortfolioPolicyConfig = resolvePolicyConfig({
  profileName: 'v2_guarded',
});

// Backwards-compatible exports for scripts/tests that import default snapshots
export const PORTFOLIO_TODAY = resolvePolicyConfig().asOfDate;
export const CAD_TO_USD_RATE = resolvePolicyConfig().cadToUsdRate;
export const CURRENCY_RATES_TO_USD: Readonly<Record<string, number>> = {
  USD: 1.0,
  CAD: CAD_TO_USD_RATE,
};
export const OCCUPIED_INCLUDES_NOTICE =
  resolvePolicyConfig().occupiedIncludesNotice;
export const OCCUPIED_SHARE_STATUSES: ReadonlySet<string> = new Set(
  OCCUPIED_INCLUDES_NOTICE ? ['occupied', 'notice'] : ['occupied'],
);
export const LEASE_ATTRIBUTION_BUCKET_BY: LeaseBucketField =
  resolvePolicyConfig().leaseBucketBy;

export const VACANT_UNIT_STATUS = 'vacant' as const;
export const NOTICE_UNIT_STATUS = 'notice' as const;
export const VOID_INVOICE_STATUS = 'void' as const;
export const POSTED_INVOICE_STATUS = 'posted' as const;

export interface DateWindowSpec {
  readonly key: string;
  readonly label: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly months: readonly string[];
}

export const DATE_WINDOWS: Readonly<Record<string, DateWindowSpec>> = {
  H1_2026: {
    key: 'H1_2026',
    label: 'H1 2026 (January to June 2026)',
    startDate: '2026-01-01',
    endDate: '2026-06-30',
    months: ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'],
  },
  Q2_2026: {
    key: 'Q2_2026',
    label: 'Q2 2026',
    startDate: '2026-04-01',
    endDate: '2026-06-30',
    months: ['2026-04', '2026-05', '2026-06'],
  },
  Q3_2026: {
    key: 'Q3_2026',
    label: 'Q3 2026',
    startDate: '2026-07-01',
    endDate: '2026-09-30',
    months: ['2026-07', '2026-08', '2026-09'],
  },
  Q4_2026: {
    key: 'Q4_2026',
    label: 'Q4 2026',
    startDate: '2026-10-01',
    endDate: '2026-12-31',
    months: ['2026-10', '2026-11', '2026-12'],
  },
  APR_SEP_2026: {
    key: 'APR_SEP_2026',
    label: 'April to September 2026',
    startDate: '2026-04-01',
    endDate: '2026-09-30',
    months: ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'],
  },
  YEAR_2026: {
    key: 'YEAR_2026',
    label: '2026',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    months: [
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
    ],
  },
  Q1_2027: {
    key: 'Q1_2027',
    label: 'Q1 2027 (January to March)',
    startDate: '2027-01-01',
    endDate: '2027-03-31',
    months: ['2027-01', '2027-02', '2027-03'],
  },
  APR_2026: {
    key: 'APR_2026',
    label: 'April 2026',
    startDate: '2026-04-01',
    endDate: '2026-04-30',
    months: ['2026-04'],
  },
  MAY_2026: {
    key: 'MAY_2026',
    label: 'May 2026',
    startDate: '2026-05-01',
    endDate: '2026-05-31',
    months: ['2026-05'],
  },
  JUN_2026: {
    key: 'JUN_2026',
    label: 'June 2026',
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    months: ['2026-06'],
  },
  JUL_2026: {
    key: 'JUL_2026',
    label: 'July 2026',
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    months: ['2026-07'],
  },
  AUG_2026: {
    key: 'AUG_2026',
    label: 'August 2026',
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    months: ['2026-08'],
  },
  SEP_2026: {
    key: 'SEP_2026',
    label: 'September 2026',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    months: ['2026-09'],
  },
  OCT_2026: {
    key: 'OCT_2026',
    label: 'October 2026',
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    months: ['2026-10'],
  },
  NOV_2026: {
    key: 'NOV_2026',
    label: 'November 2026',
    startDate: '2026-11-01',
    endDate: '2026-11-30',
    months: ['2026-11'],
  },
  DEC_2026: {
    key: 'DEC_2026',
    label: 'December 2026',
    startDate: '2026-12-01',
    endDate: '2026-12-31',
    months: ['2026-12'],
  },
};

/**
 * Conjugate Gamma-Poisson / Empirical-Bayes hyperparameters for FLOW-105
 * outcome-weighted budget ranking over data/ops/decisions.csv.
 */
export const OUTCOME_LEARNER_CONFIG = {
  priorLeasesAlpha0: 1.0,
  get priorSpendUsdBeta0(): number {
    return resolvePolicyConfig().priorSpendUsdBeta0;
  },
  minPostMonthsForFullConfidence: 3,
  minPostSpendForFullConfidenceUsd: 2500.0,
  deadSpendAlertThresholdUsd: 2500.0,
} as const;

/**
 * Hidden archive & property discovery constants (B00 / EGGS / FLOW-106).
 */
export const DISCOVERED_EASTER_EGGS = {
  zipCommentWord: 'pyrite',
  ninthHouseWord: 'athanor',
  eggsTuple: ['pyrite', 'athanor'] as const,
} as const;
