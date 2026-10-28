import { DATE_WINDOWS, VACANT_UNIT_STATUS } from '../config/rules.ts';
import { roundTo } from '../data/loader.ts';
import type {
  CitationId,
  LeaseType,
  PortfolioStore,
  RenewalStatus,
  UnitRecord,
  UnitStatus,
} from '../data/schema.ts';

export interface UnitQueryFilter {
  readonly propertyIds?: readonly string[];
  readonly buildingClass?: string;
  readonly bedrooms?: number;
  readonly bathrooms?: number;
  readonly sqftMin?: number;
  readonly sqftMax?: number;
  readonly floorMin?: number;
  readonly floorMax?: number;
  readonly view?: string;
  readonly status?: UnitStatus;
}

export interface PropertyUnitMetrics {
  readonly propertyId: string;
  readonly propertyName: string;
  readonly buildingClass: string;
  readonly yearBuilt: number;
  readonly totalUnits: number;
  readonly occupiedUnits: number;
  readonly noticeUnits: number;
  readonly vacantUnits: number;
  readonly occupiedSharePercent: number;
  readonly vacancyRatePercent: number;
  readonly filteredUnitCount: number;
  readonly filteredOccupiedUnits: number;
  readonly filteredNoticeUnits: number;
  readonly filteredVacantUnits: number;
  readonly filteredOccupiedSharePercent: number;
  readonly filteredVacancyRatePercent: number;
  readonly filteredAvgMarketRentUsd: number;
  readonly filteredAvgSqft: number;
  readonly filteredRentPerSqftUsd: number;
  readonly citations: readonly CitationId[];
}

export interface UnitQuerySummary {
  readonly portfolioTotalUnits: number;
  readonly portfolioOccupiedUnits: number;
  readonly portfolioNoticeUnits: number;
  readonly portfolioVacantUnits: number;
  readonly portfolioOccupiedSharePercent: number;
  readonly portfolioVacancyRatePercent: number;
  readonly totalFilteredUnits: number;
  readonly filteredOccupiedUnits: number;
  readonly filteredNoticeUnits: number;
  readonly filteredVacantUnits: number;
  readonly filteredOccupiedSharePercent: number;
  readonly filteredVacancyRatePercent: number;
  readonly filteredAvgMarketRentUsd: number;
  readonly filteredAvgSqft: number;
  readonly filteredRentPerSqftUsd: number;
  readonly byProperty: readonly PropertyUnitMetrics[];
  readonly citations: readonly CitationId[];
}

export function queryUnitsAndOccupancy(
  store: PortfolioStore,
  filter: UnitQueryFilter = {},
): UnitQuerySummary {
  const occupiedStatuses = new Set<string>(
    store.policy.occupiedIncludesNotice
      ? ['occupied', 'notice']
      : ['occupied'],
  );

  let targetProps = [...store.operatingProperties];
  if (filter.propertyIds && filter.propertyIds.length > 0) {
    const idSet = new Set(filter.propertyIds);
    targetProps = targetProps.filter((p) => idSet.has(p.propertyId));
  }
  if (filter.buildingClass) {
    const targetClass = filter.buildingClass.trim().toUpperCase();
    targetProps = targetProps.filter(
      (p) => p.buildingClass.toUpperCase() === targetClass,
    );
  }

  const byProperty: PropertyUnitMetrics[] = [];
  const allFilteredUnits: UnitRecord[] = [];
  const summaryCitations = new Set<CitationId>();

  let portfolioTotalUnits = 0;
  let portfolioOccupiedUnits = 0;
  let portfolioNoticeUnits = 0;
  let portfolioVacantUnits = 0;
  let portfolioOccupiedStatusUnits = 0;

  for (const prop of targetProps) {
    const propUnits = store.units.filter(
      (u) => u.propertyId === prop.propertyId,
    );
    const totalUnits = propUnits.length;
    const occupiedUnits = propUnits.filter(
      (u) => u.status === 'occupied',
    ).length;
    const noticeUnits = propUnits.filter((u) => u.status === 'notice').length;
    const vacantUnits = propUnits.filter(
      (u) => u.status === VACANT_UNIT_STATUS,
    ).length;
    const occupiedPlusNotice = propUnits.filter((u) =>
      occupiedStatuses.has(u.status),
    ).length;

    portfolioTotalUnits += totalUnits;
    portfolioOccupiedUnits += occupiedUnits;
    portfolioNoticeUnits += noticeUnits;
    portfolioVacantUnits += vacantUnits;
    portfolioOccupiedStatusUnits += occupiedPlusNotice;

    // Under v0_naive (quarantineZeroUnitProperties=false), 0-unit P09 divides 0/0 -> NaN/100% trap
    const occupiedSharePercent =
      totalUnits > 0
        ? roundTo((occupiedPlusNotice / totalUnits) * 100, 1)
        : 0;
    const vacancyRatePercent =
      totalUnits > 0
        ? roundTo((vacantUnits / totalUnits) * 100, 1)
        : store.policy.quarantineZeroUnitProperties
          ? 0
          : 100.0;

    const filtered = propUnits.filter((u) => {
      if (filter.bedrooms !== undefined && u.bedrooms !== filter.bedrooms) {
        return false;
      }
      if (filter.bathrooms !== undefined && u.bathrooms !== filter.bathrooms) {
        return false;
      }
      if (filter.sqftMin !== undefined && u.sqft < filter.sqftMin) {
        return false;
      }
      if (filter.sqftMax !== undefined && u.sqft > filter.sqftMax) {
        return false;
      }
      if (filter.floorMin !== undefined && u.floor < filter.floorMin) {
        return false;
      }
      if (filter.floorMax !== undefined && u.floor > filter.floorMax) {
        return false;
      }
      if (
        filter.view !== undefined &&
        u.view.toLowerCase() !== filter.view.toLowerCase()
      ) {
        return false;
      }
      if (filter.status !== undefined && u.status !== filter.status) {
        return false;
      }
      return true;
    });

    allFilteredUnits.push(...filtered);

    const filteredOccupiedUnits = filtered.filter(
      (u) => u.status === 'occupied',
    ).length;
    const filteredNoticeUnits = filtered.filter(
      (u) => u.status === 'notice',
    ).length;
    const filteredVacantUnits = filtered.filter(
      (u) => u.status === VACANT_UNIT_STATUS,
    ).length;
    const filteredOccupiedPlusNotice = filtered.filter((u) =>
      occupiedStatuses.has(u.status),
    ).length;

    const filteredOccupiedSharePercent =
      filtered.length > 0
        ? roundTo((filteredOccupiedPlusNotice / filtered.length) * 100, 1)
        : 0;
    const filteredVacancyRatePercent =
      filtered.length > 0
        ? roundTo((filteredVacantUnits / filtered.length) * 100, 1)
        : 0;

    const totalRent = filtered.reduce((acc, u) => acc + u.marketRent, 0);
    const totalSqft = filtered.reduce((acc, u) => acc + u.sqft, 0);
    const avgRent =
      filtered.length > 0 ? roundTo(totalRent / filtered.length, 2) : 0;
    const avgSqft =
      filtered.length > 0 ? roundTo(totalSqft / filtered.length, 1) : 0;
    const rentPerSqft = totalSqft > 0 ? roundTo(totalRent / totalSqft, 2) : 0;

    const propCitations: CitationId[] = [
      prop.citationId,
      ...(filtered.length > 0 ? filtered : propUnits)
        .slice(0, 5)
        .map((u) => u.citationId),
    ];

    if (filtered.length > 0 || filter.propertyIds?.includes(prop.propertyId)) {
      summaryCitations.add(prop.citationId);
      for (const u of filtered.slice(0, 4)) {
        summaryCitations.add(u.citationId);
      }
    }

    byProperty.push({
      propertyId: prop.propertyId,
      propertyName: prop.name,
      buildingClass: prop.buildingClass,
      yearBuilt: prop.yearBuilt,
      totalUnits,
      occupiedUnits,
      noticeUnits,
      vacantUnits,
      occupiedSharePercent,
      vacancyRatePercent,
      filteredUnitCount: filtered.length,
      filteredOccupiedUnits,
      filteredNoticeUnits,
      filteredVacantUnits,
      filteredOccupiedSharePercent,
      filteredVacancyRatePercent,
      filteredAvgMarketRentUsd: avgRent,
      filteredAvgSqft: avgSqft,
      filteredRentPerSqftUsd: rentPerSqft,
      citations: propCitations,
    });
  }

  if (summaryCitations.size === 0 && targetProps[0]) {
    summaryCitations.add(targetProps[0].citationId);
  }

  const totalFilteredRent = allFilteredUnits.reduce(
    (acc, u) => acc + u.marketRent,
    0,
  );
  const totalFilteredSqft = allFilteredUnits.reduce(
    (acc, u) => acc + u.sqft,
    0,
  );
  const filteredOccupiedUnits = allFilteredUnits.filter(
    (u) => u.status === 'occupied',
  ).length;
  const filteredNoticeUnits = allFilteredUnits.filter(
    (u) => u.status === 'notice',
  ).length;
  const filteredVacantUnits = allFilteredUnits.filter(
    (u) => u.status === VACANT_UNIT_STATUS,
  ).length;
  const filteredOccStatus = allFilteredUnits.filter((u) =>
    occupiedStatuses.has(u.status),
  ).length;

  return {
    portfolioTotalUnits,
    portfolioOccupiedUnits,
    portfolioNoticeUnits,
    portfolioVacantUnits,
    portfolioOccupiedSharePercent:
      portfolioTotalUnits > 0
        ? roundTo((portfolioOccupiedStatusUnits / portfolioTotalUnits) * 100, 1)
        : 0,
    portfolioVacancyRatePercent:
      portfolioTotalUnits > 0
        ? roundTo((portfolioVacantUnits / portfolioTotalUnits) * 100, 1)
        : 0,
    totalFilteredUnits: allFilteredUnits.length,
    filteredOccupiedUnits,
    filteredNoticeUnits,
    filteredVacantUnits,
    filteredOccupiedSharePercent:
      allFilteredUnits.length > 0
        ? roundTo((filteredOccStatus / allFilteredUnits.length) * 100, 1)
        : 0,
    filteredVacancyRatePercent:
      allFilteredUnits.length > 0
        ? roundTo((filteredVacantUnits / allFilteredUnits.length) * 100, 1)
        : 0,
    filteredAvgMarketRentUsd:
      allFilteredUnits.length > 0
        ? roundTo(totalFilteredRent / allFilteredUnits.length, 2)
        : 0,
    filteredAvgSqft:
      allFilteredUnits.length > 0
        ? roundTo(totalFilteredSqft / allFilteredUnits.length, 1)
        : 0,
    filteredRentPerSqftUsd:
      totalFilteredSqft > 0
        ? roundTo(totalFilteredRent / totalFilteredSqft, 2)
        : 0,
    byProperty,
    citations: [...summaryCitations],
  };
}

export interface LeaseQueryFilter {
  readonly propertyIds?: readonly string[];
  readonly pms?: string;
  readonly buildingClass?: string;
  readonly bedrooms?: number;
  readonly bathrooms?: number;
  readonly view?: string;
  readonly floorMin?: number;
  readonly floorMax?: number;
  readonly leaseType?: LeaseType;
  readonly startDateFrom?: string;
  readonly startDateTo?: string;
  readonly endDateFrom?: string;
  readonly endDateTo?: string;
  readonly renewalStatus?: RenewalStatus;
  readonly signedFromLeadsOnly?: boolean;
}

export interface PropertyLeaseMetrics {
  readonly propertyId: string;
  readonly propertyName: string;
  readonly buildingClass: string;
  readonly pms: string;
  readonly matchingLeaseCount: number;
  readonly newLeaseCount: number;
  readonly renewalLeaseCount: number;
  readonly renewedCount: number;
  readonly pendingCount: number;
  readonly noticeGivenCount: number;
  readonly notDueCount: number;
  readonly renewalRatePercent: number;
  readonly totalMonthlyRentUsd: number;
  readonly averageConcessionUsd: number;
  readonly citations: readonly CitationId[];
}

export interface LeaseQuerySummary {
  readonly totalMatchingLeases: number;
  readonly newLeaseCount: number;
  readonly renewalLeaseCount: number;
  readonly renewedCount: number;
  readonly pendingCount: number;
  readonly noticeGivenCount: number;
  readonly notDueCount: number;
  readonly renewalRatePercent: number;
  readonly totalMonthlyRentUsd: number;
  readonly averageConcessionUsd: number;
  readonly byProperty: readonly PropertyLeaseMetrics[];
  readonly citations: readonly CitationId[];
}

function computeAverageConcession(
  leases: ReadonlyArray<{ readonly concessionUsd: number }>,
  includeZeroConcessions: boolean,
): number {
  const pool = includeZeroConcessions
    ? leases
    : leases.filter((l) => l.concessionUsd > 0);
  if (pool.length === 0) {
    return 0;
  }
  return roundTo(
    pool.reduce((acc, l) => acc + l.concessionUsd, 0) / pool.length,
    2,
  );
}

function computeRenewalRatePercent(
  renewedCount: number,
  pendingCount: number,
  noticeGivenCount: number,
  totalCount: number,
): number {
  const actionable = renewedCount + pendingCount + noticeGivenCount;
  const denom = actionable > 0 ? actionable : totalCount;
  return denom > 0 ? roundTo((renewedCount / denom) * 100, 1) : 0;
}

export function queryLeasesAndRenewals(
  store: PortfolioStore,
  filter: LeaseQueryFilter = {},
): LeaseQuerySummary {
  const signedLeaseIdSet = new Set(store.signedLeases.map((sl) => sl.leaseId));
  const unitMap = new Map(store.units.map((u) => [u.unitId, u]));

  let targetProperties = [...store.operatingProperties];

  if (filter.propertyIds && filter.propertyIds.length > 0) {
    const idSet = new Set(filter.propertyIds);
    targetProperties = targetProperties.filter((p) => idSet.has(p.propertyId));
  }
  if (filter.pms) {
    const targetPms = filter.pms.toLowerCase();
    targetProperties = targetProperties.filter(
      (p) => p.pms.toLowerCase() === targetPms,
    );
  }
  if (filter.buildingClass) {
    const targetClass = filter.buildingClass.trim().toUpperCase();
    targetProperties = targetProperties.filter(
      (p) => p.buildingClass.toUpperCase() === targetClass,
    );
  }

  const allowedPropIds = new Set(targetProperties.map((p) => p.propertyId));

  const filterLease = (l: (typeof store.leases)[number]): boolean => {
    if (!allowedPropIds.has(l.propertyId)) {
      return false;
    }
    if (filter.signedFromLeadsOnly && !signedLeaseIdSet.has(l.leaseId)) {
      return false;
    }
    if (filter.leaseType && l.leaseType !== filter.leaseType) {
      return false;
    }
    if (filter.startDateFrom && l.startDate < filter.startDateFrom) {
      return false;
    }
    if (filter.startDateTo && l.startDate > filter.startDateTo) {
      return false;
    }
    if (filter.endDateFrom && l.endDate < filter.endDateFrom) {
      return false;
    }
    if (filter.endDateTo && l.endDate > filter.endDateTo) {
      return false;
    }
    if (filter.renewalStatus && l.renewalStatus !== filter.renewalStatus) {
      return false;
    }
    if (
      filter.bedrooms !== undefined ||
      filter.bathrooms !== undefined ||
      filter.view !== undefined ||
      filter.floorMin !== undefined ||
      filter.floorMax !== undefined
    ) {
      const unit = unitMap.get(l.unitId);
      if (!unit) {
        return false;
      }
      if (filter.bedrooms !== undefined && unit.bedrooms !== filter.bedrooms) {
        return false;
      }
      if (
        filter.bathrooms !== undefined &&
        unit.bathrooms !== filter.bathrooms
      ) {
        return false;
      }
      if (
        filter.view !== undefined &&
        unit.view.toLowerCase() !== filter.view.toLowerCase()
      ) {
        return false;
      }
      if (filter.floorMin !== undefined && unit.floor < filter.floorMin) {
        return false;
      }
      if (filter.floorMax !== undefined && unit.floor > filter.floorMax) {
        return false;
      }
    }
    return true;
  };

  const allMatching = store.leases.filter(filterLease);
  const byProperty: PropertyLeaseMetrics[] = [];
  const citations = new Set<CitationId>();

  for (const prop of targetProperties) {
    const propLeases = allMatching.filter(
      (l) => l.propertyId === prop.propertyId,
    );
    const newLeaseCount = propLeases.filter(
      (l) => l.leaseType === 'new',
    ).length;
    const renewalLeaseCount = propLeases.filter(
      (l) => l.leaseType === 'renewal',
    ).length;
    const renewedCount = propLeases.filter(
      (l) => l.renewalStatus === 'renewed',
    ).length;
    const pendingCount = propLeases.filter(
      (l) => l.renewalStatus === 'pending',
    ).length;
    const noticeGivenCount = propLeases.filter(
      (l) => l.renewalStatus === 'notice_given',
    ).length;
    const notDueCount = propLeases.filter(
      (l) => l.renewalStatus === 'not_due',
    ).length;
    const totalMonthlyRentUsd = Math.round(
      propLeases.reduce((acc, l) => acc + l.monthlyRent, 0),
    );
    const averageConcessionUsd = computeAverageConcession(
      propLeases,
      store.policy.includeZeroConcessions,
    );
    const renewalRatePercent = computeRenewalRatePercent(
      renewedCount,
      pendingCount,
      noticeGivenCount,
      propLeases.length,
    );

    const propCitations: CitationId[] = [
      prop.citationId,
      ...propLeases.slice(0, 6).map((l) => l.citationId),
    ];

    if (propLeases.length > 0) {
      citations.add(prop.citationId);
      for (const l of propLeases.slice(0, 2)) {
        citations.add(l.citationId);
      }
    }

    byProperty.push({
      propertyId: prop.propertyId,
      propertyName: prop.name,
      buildingClass: prop.buildingClass,
      pms: prop.pms,
      matchingLeaseCount: propLeases.length,
      newLeaseCount,
      renewalLeaseCount,
      renewedCount,
      pendingCount,
      noticeGivenCount,
      notDueCount,
      renewalRatePercent,
      totalMonthlyRentUsd,
      averageConcessionUsd,
      citations: propCitations,
    });
  }

  if (citations.size === 0 && targetProperties[0]) {
    citations.add(targetProperties[0].citationId);
  }

  const totalMonthlyRentUsd = Math.round(
    allMatching.reduce((acc, l) => acc + l.monthlyRent, 0),
  );
  const averageConcessionUsd = computeAverageConcession(
    allMatching,
    store.policy.includeZeroConcessions,
  );
  const renewedCount = allMatching.filter(
    (l) => l.renewalStatus === 'renewed',
  ).length;
  const pendingCount = allMatching.filter(
    (l) => l.renewalStatus === 'pending',
  ).length;
  const noticeGivenCount = allMatching.filter(
    (l) => l.renewalStatus === 'notice_given',
  ).length;
  const notDueCount = allMatching.filter(
    (l) => l.renewalStatus === 'not_due',
  ).length;

  return {
    totalMatchingLeases: allMatching.length,
    newLeaseCount: allMatching.filter((l) => l.leaseType === 'new').length,
    renewalLeaseCount: allMatching.filter((l) => l.leaseType === 'renewal')
      .length,
    renewedCount,
    pendingCount,
    noticeGivenCount,
    notDueCount,
    renewalRatePercent: computeRenewalRatePercent(
      renewedCount,
      pendingCount,
      noticeGivenCount,
      allMatching.length,
    ),
    totalMonthlyRentUsd,
    averageConcessionUsd,
    byProperty,
    citations: [...citations],
  };
}

export interface MarketingQueryFilter {
  readonly propertyIds?: readonly string[];
  readonly buildingClass?: string;
  readonly sources?: readonly string[];
  readonly period?: string;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly paidOnly?: boolean;
  readonly bedroomsWanted?: number;
  readonly appliedOnly?: boolean;
  readonly appliedWithoutTourOnly?: boolean;
}

export interface PropertySourcePairMetrics {
  readonly propertyId: string;
  readonly propertyName: string;
  readonly buildingClass: string;
  readonly source: string;
  readonly isPaidSource: boolean;
  readonly spendUsd: number;
  readonly rawCadSpend: number;
  readonly postedInvoiceCount: number;
  readonly voidInvoiceCount: number;
  readonly cadInvoiceCount: number;
  readonly leadsCreatedCount: number;
  readonly touredCount: number;
  readonly appliedCount: number;
  readonly appliedWithoutTourCount: number;
  readonly leasedFromCreatedLeadsCount: number;
  readonly applyRatePercent: number;
  readonly tourToLeaseConversionPercent: number;
  readonly costPerLeadUsd: number | null;
  readonly costPerTourUsd: number | null;
  readonly signedLeasesInPeriod: number;
  readonly costPerSignedLeaseUsd: number | null;
  readonly exactCostPerSignedLeaseUsd: number | null;
  readonly isDeadSpend: boolean;
  readonly citations: readonly CitationId[];
}

export interface SourcePortfolioMetrics {
  readonly source: string;
  readonly isPaidSource: boolean;
  readonly spendUsd: number;
  readonly signedLeasesInPeriod: number;
  readonly costPerSignedLeaseUsd: number | null;
  readonly exactCostPerSignedLeaseUsd: number | null;
  readonly leadsCreatedCount: number;
  readonly touredCount: number;
  readonly appliedCount: number;
  readonly appliedWithoutTourCount: number;
  readonly applyRatePercent: number;
  readonly tourToLeaseConversionPercent: number;
  readonly costPerLeadUsd: number | null;
  readonly costPerTourUsd: number | null;
  readonly citations: readonly CitationId[];
}

export interface PropertyMarketingTotals {
  readonly propertyId: string;
  readonly propertyName: string;
  readonly buildingClass: string;
  readonly spendUsd: number;
  readonly leadsCreatedCount: number;
  readonly touredCount: number;
  readonly appliedCount: number;
  readonly appliedWithoutTourCount: number;
  readonly signedLeasesInPeriod: number;
  readonly deadSpendSources: readonly string[];
  readonly deadSpendUsd: number;
  readonly citations: readonly CitationId[];
}

export interface DeadSpendReallocationSummary {
  readonly deadPairs: ReadonlyArray<readonly [string, string]>;
  readonly deadPairDetails: readonly PropertySourcePairMetrics[];
  readonly affectedBuildingCount: number;
  readonly totalDeadSpendUsd: number;
  readonly totalPostedInvoicesOnDeadPairs: number;
  readonly totalVoidInvoicesOnDeadPairs: number;
  readonly totalDeadLeads: number;
  readonly totalDeadTours: number;
  readonly totalDeadApplied: number;
  readonly cadRateUsed: number;
  readonly bestPortfolioPaidSource: string;
  readonly bestSourceSpendUsd: number;
  readonly bestSourceSignedLeases: number;
  readonly bestSourcePortfolioCpslUsd: number;
  readonly bestSourceExactCpslUsd: number;
  readonly unroundedAdditionalLeases: number;
  readonly projectedAdditionalWholeLeases: number;
  readonly citations: readonly CitationId[];
}

export interface MarketingQuerySummary {
  readonly windowLabel: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly months: readonly string[];
  readonly totalSpendUsd: number;
  readonly totalLeadsCreated: number;
  readonly totalToured: number;
  readonly totalApplied: number;
  readonly totalAppliedWithoutTour: number;
  readonly totalSignedLeases: number;
  readonly byPropertySource: readonly PropertySourcePairMetrics[];
  readonly bySource: readonly SourcePortfolioMetrics[];
  readonly byProperty: readonly PropertyMarketingTotals[];
  readonly deadSpendReallocation: DeadSpendReallocationSummary;
  readonly citations: readonly CitationId[];
}

function enumerateYearMonths(startMonth: string, endMonth: string): string[] {
  const [sy, sm] = startMonth.split('-').map((n) => Number.parseInt(n, 10));
  const [ey, em] = endMonth.split('-').map((n) => Number.parseInt(n, 10));
  if (
    Number.isNaN(sy) ||
    Number.isNaN(sm) ||
    Number.isNaN(ey) ||
    Number.isNaN(em)
  ) {
    return [...DATE_WINDOWS.APR_SEP_2026.months];
  }
  const result: string[] = [];
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    result.push(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return result;
}

export function resolveDateWindow(filter: MarketingQueryFilter): {
  label: string;
  startDate: string;
  endDate: string;
  months: readonly string[];
} {
  if (filter.startDate && filter.endDate) {
    const startMonth = filter.startDate.slice(0, 7);
    const endMonth = filter.endDate.slice(0, 7);
    const months = enumerateYearMonths(startMonth, endMonth);
    return {
      label: `${filter.startDate} to ${filter.endDate}`,
      startDate: filter.startDate,
      endDate: filter.endDate,
      months,
    };
  }
  if (filter.period) {
    const p = filter.period.trim();
    const upperKey = p.toUpperCase().replace(/[\s-]+/g, '_');
    if (upperKey in DATE_WINDOWS) {
      return DATE_WINDOWS[upperKey];
    }
    if (/^q2\b/i.test(p) || /apr(il)?\s*(to|-|–)\s*jun(e)?/i.test(p)) {
      return DATE_WINDOWS.Q2_2026;
    }
    if (/^q3\b/i.test(p) || /jul(y)?\s*(to|-|–)\s*sep(tember)?/i.test(p)) {
      return DATE_WINDOWS.Q3_2026;
    }
    if (/^q4\b/i.test(p)) {
      return DATE_WINDOWS.Q4_2026;
    }
    if (/^h1\b/i.test(p) || /first\s+half/i.test(p)) {
      return DATE_WINDOWS.H1_2026;
    }
    if (/^q1\s*2027\b/i.test(p)) {
      return DATE_WINDOWS.Q1_2027;
    }
    const monthMatch = p.match(/^(\d{4})-(\d{2})$/);
    if (monthMatch) {
      const ym = `${monthMatch[1]}-${monthMatch[2]}`;
      const matchWin = Object.values(DATE_WINDOWS).find(
        (w) => w.months.length === 1 && w.months[0] === ym,
      );
      if (matchWin) {
        return matchWin;
      }
      return {
        label: ym,
        startDate: `${ym}-01`,
        endDate: `${ym}-31`,
        months: [ym],
      };
    }
    for (const win of Object.values(DATE_WINDOWS)) {
      if (win.label.toLowerCase() === p.toLowerCase()) {
        return win;
      }
    }
  }
  return DATE_WINDOWS.APR_SEP_2026;
}

export function queryMarketingSpendAndFunnel(
  store: PortfolioStore,
  filter: MarketingQueryFilter = {},
): MarketingQuerySummary {
  const windowSpec = resolveDateWindow(filter);
  const monthSet = new Set(windowSpec.months);
  const paidSourceSet = new Set(store.paidSources);

  let targetProps =
    filter.propertyIds && filter.propertyIds.length > 0
      ? store.operatingProperties.filter((p) =>
          filter.propertyIds!.includes(p.propertyId),
        )
      : [...store.operatingProperties];

  if (filter.buildingClass) {
    const tc = filter.buildingClass.trim().toUpperCase();
    targetProps = targetProps.filter(
      (p) => p.buildingClass.toUpperCase() === tc,
    );
  }

  const candidateSources = filter.paidOnly
    ? store.paidSources
    : [...store.paidSources, ...store.organicSources];

  const targetSources =
    filter.sources && filter.sources.length > 0
      ? candidateSources.filter((s) =>
          filter.sources!.some((fs) => fs.toLowerCase() === s.toLowerCase()),
        )
      : candidateSources;

  // Pre-index leads by ID and pre-group spend, deduplicatedLeads, and signedLeases by (propertyId::source) in a single O(N) pass
  const leadMapById = new Map(store.leads.map((l) => [l.leadId, l]));
  const spendByPropSource = new Map<string, (typeof store.spend)[number][]>();
  for (const s of store.spend) {
    if (!monthSet.has(s.month)) continue;
    const key = `${s.propertyId}::${s.source}`;
    const list = spendByPropSource.get(key);
    if (list) list.push(s);
    else spendByPropSource.set(key, [s]);
  }
  const leadsByPropSource = new Map<string, (typeof store.deduplicatedLeads)[number][]>();
  for (const l of store.deduplicatedLeads) {
    if (l.createdDate < windowSpec.startDate || l.createdDate > windowSpec.endDate) continue;
    const key = `${l.propertyId}::${l.source}`;
    const list = leadsByPropSource.get(key);
    if (list) list.push(l);
    else leadsByPropSource.set(key, [l]);
  }
  const leasesByPropSource = new Map<string, (typeof store.signedLeases)[number][]>();
  for (const sl of store.signedLeases) {
    const bucketDate =
      store.policy.leaseBucketBy === 'lead_created_date'
        ? sl.leadCreatedDate
        : sl.leaseStartDate;
    if (bucketDate < windowSpec.startDate || bucketDate > windowSpec.endDate) continue;
    const key = `${sl.propertyId}::${sl.source}`;
    const list = leasesByPropSource.get(key);
    if (list) list.push(sl);
    else leasesByPropSource.set(key, [sl]);
  }

  const byPropertySource: PropertySourcePairMetrics[] = [];

  for (const prop of targetProps) {
    for (const source of targetSources) {
      const pairKey = `${prop.propertyId}::${source}`;
      const isPaidSource = paidSourceSet.has(source);
      const pairSpendRows = spendByPropSource.get(pairKey) ?? [];
      const postedRows = store.policy.excludeVoidSpend
        ? pairSpendRows.filter((s) => !s.isVoid)
        : pairSpendRows;
      const voidRows = pairSpendRows.filter((s) => s.isVoid);
      const cadRows = postedRows.filter((s) => s.currency === 'CAD');

      const spendUsd = roundTo(
        postedRows.reduce((acc, s) => acc + s.effectiveUsd, 0),
        2,
      );
      const rawCadSpend = roundTo(
        cadRows.reduce((acc, s) => acc + s.rawAmount, 0),
        2,
      );

      const candidateLeads = leadsByPropSource.get(pairKey) ?? [];
      const createdLeads = candidateLeads.filter((l) => {
        if (
          filter.bedroomsWanted !== undefined &&
          l.bedroomsWanted !== filter.bedroomsWanted
        ) {
          return false;
        }
        if (filter.appliedOnly && !l.applied) {
          return false;
        }
        if (filter.appliedWithoutTourOnly && !(l.applied && !l.toured)) {
          return false;
        }
        return true;
      });

      const touredLeads = createdLeads.filter((l) => l.toured);
      const appliedLeads = createdLeads.filter((l) => l.applied);
      const appliedWithoutTourLeads = createdLeads.filter(
        (l) => l.applied && !l.toured,
      );
      const leasedFromCreated = createdLeads.filter((l) =>
        store.policy.deduplicateLeads
          ? l.leased && l.isEarliestForLease
          : l.leased,
      );

      const applyRatePercent =
        createdLeads.length > 0
          ? roundTo((appliedLeads.length / createdLeads.length) * 100, 1)
          : 0;

      const tourToLeaseConversionPercent =
        touredLeads.length > 0
          ? roundTo((leasedFromCreated.length / touredLeads.length) * 100, 1)
          : 0;

      const costPerLeadUsd =
        isPaidSource && createdLeads.length > 0
          ? roundTo(spendUsd / createdLeads.length, 2)
          : null;

      const costPerTourUsd =
        isPaidSource && touredLeads.length > 0
          ? roundTo(spendUsd / touredLeads.length, 2)
          : null;

      const candidateLeases = leasesByPropSource.get(pairKey) ?? [];
      const signedLeases = candidateLeases.filter((sl) => {
        if (filter.bedroomsWanted !== undefined) {
          const origLead = leadMapById.get(sl.earliestLeadId);
          if (origLead && origLead.bedroomsWanted !== filter.bedroomsWanted) {
            return false;
          }
        }
        return true;
      });

      const signedLeasesInPeriod = signedLeases.length;
      const exactCpsl =
        isPaidSource && signedLeasesInPeriod > 0
          ? spendUsd / signedLeasesInPeriod
          : null;
      const cpsl = exactCpsl !== null ? roundTo(exactCpsl, 2) : null;
      const isDeadSpend =
        isPaidSource && spendUsd > 0 && signedLeasesInPeriod === 0;

      if (
        pairSpendRows.length === 0 &&
        createdLeads.length === 0 &&
        signedLeasesInPeriod === 0
      ) {
        continue;
      }

      const pairCitations: CitationId[] = [
        prop.citationId,
        ...postedRows.slice(0, 3).map((s) => s.citationId),
        ...signedLeases.slice(0, 4).map((sl) => sl.leaseCitationId),
        ...signedLeases.slice(0, 3).map((sl) => sl.leadCitationId),
        ...touredLeads.slice(0, 3).map((l) => l.citationId),
        ...(signedLeases.length === 0
          ? createdLeads.slice(0, 3).map((l) => l.citationId)
          : []),
      ];

      byPropertySource.push({
        propertyId: prop.propertyId,
        propertyName: prop.name,
        buildingClass: prop.buildingClass,
        source,
        isPaidSource,
        spendUsd,
        rawCadSpend,
        postedInvoiceCount: postedRows.length,
        voidInvoiceCount: voidRows.length,
        cadInvoiceCount: cadRows.length,
        leadsCreatedCount: createdLeads.length,
        touredCount: touredLeads.length,
        appliedCount: appliedLeads.length,
        appliedWithoutTourCount: appliedWithoutTourLeads.length,
        leasedFromCreatedLeadsCount: leasedFromCreated.length,
        applyRatePercent,
        tourToLeaseConversionPercent,
        costPerLeadUsd,
        costPerTourUsd,
        signedLeasesInPeriod,
        costPerSignedLeaseUsd: cpsl,
        exactCostPerSignedLeaseUsd: exactCpsl,
        isDeadSpend,
        citations: [...new Set(pairCitations)],
      });
    }
  }

  const bySource: SourcePortfolioMetrics[] = [];
  for (const source of targetSources) {
    const rows = byPropertySource.filter((r) => r.source === source);
    if (rows.length === 0) {
      continue;
    }
    const isPaidSource = paidSourceSet.has(source);
    const spendUsd = roundTo(
      rows.reduce((acc, r) => acc + r.spendUsd, 0),
      2,
    );
    const signedLeasesInPeriod = rows.reduce(
      (acc, r) => acc + r.signedLeasesInPeriod,
      0,
    );
    const leadsCreatedCount = rows.reduce(
      (acc, r) => acc + r.leadsCreatedCount,
      0,
    );
    const touredCount = rows.reduce((acc, r) => acc + r.touredCount, 0);
    const appliedCount = rows.reduce((acc, r) => acc + r.appliedCount, 0);
    const appliedWithoutTourCount = rows.reduce(
      (acc, r) => acc + r.appliedWithoutTourCount,
      0,
    );
    const leasedFromCreated = rows.reduce(
      (acc, r) => acc + r.leasedFromCreatedLeadsCount,
      0,
    );
    const exactCpsl =
      isPaidSource && signedLeasesInPeriod > 0
        ? spendUsd / signedLeasesInPeriod
        : null;
    const cpsl = exactCpsl !== null ? roundTo(exactCpsl, 2) : null;
    const costPerLeadUsd =
      isPaidSource && leadsCreatedCount > 0
        ? roundTo(spendUsd / leadsCreatedCount, 2)
        : null;
    const costPerTourUsd =
      isPaidSource && touredCount > 0
        ? roundTo(spendUsd / touredCount, 2)
        : null;

    // Gather citations including actual signed leases, leads, properties, and spend rows across buildings
    const citations = new Set<CitationId>();
    for (const r of rows) {
      if (r.signedLeasesInPeriod > 0) {
        for (const c of r.citations) {
          if (c.startsWith('leases:')) {
            citations.add(c);
          }
        }
        const firstLead = r.citations.find((c) => c.startsWith('leads:'));
        if (firstLead) {
          citations.add(firstLead);
        }
        citations.add(`properties:${r.propertyId}` as CitationId);
        const firstSpend = r.citations.find((c) => c.startsWith('spend:'));
        if (firstSpend) {
          citations.add(firstSpend);
        }
      }
    }
    for (const r of rows) {
      citations.add(`properties:${r.propertyId}` as CitationId);
      const firstSpend = r.citations.find((c) => c.startsWith('spend:'));
      if (firstSpend) {
        citations.add(firstSpend);
      }
      for (const c of r.citations.slice(0, 2)) {
        citations.add(c);
      }
    }

    bySource.push({
      source,
      isPaidSource,
      spendUsd,
      signedLeasesInPeriod,
      costPerSignedLeaseUsd: cpsl,
      exactCostPerSignedLeaseUsd: exactCpsl,
      leadsCreatedCount,
      touredCount,
      appliedCount,
      appliedWithoutTourCount,
      applyRatePercent:
        leadsCreatedCount > 0
          ? roundTo((appliedCount / leadsCreatedCount) * 100, 1)
          : 0,
      tourToLeaseConversionPercent:
        touredCount > 0
          ? roundTo((leasedFromCreated / touredCount) * 100, 1)
          : 0,
      costPerLeadUsd,
      costPerTourUsd,
      citations: [...citations],
    });
  }

  const byProperty: PropertyMarketingTotals[] = [];
  for (const prop of targetProps) {
    const rows = byPropertySource.filter(
      (r) => r.propertyId === prop.propertyId,
    );
    const spendUsd = roundTo(
      rows.reduce((acc, r) => acc + r.spendUsd, 0),
      2,
    );
    const leadsCreatedCount = rows.reduce(
      (acc, r) => acc + r.leadsCreatedCount,
      0,
    );
    const touredCount = rows.reduce((acc, r) => acc + r.touredCount, 0);
    const appliedCount = rows.reduce((acc, r) => acc + r.appliedCount, 0);
    const appliedWithoutTourCount = rows.reduce(
      (acc, r) => acc + r.appliedWithoutTourCount,
      0,
    );
    const signedLeasesInPeriod = rows.reduce(
      (acc, r) => acc + r.signedLeasesInPeriod,
      0,
    );
    const deadRows = rows.filter((r) => r.isDeadSpend);
    const deadSpendUsd = roundTo(
      deadRows.reduce((acc, r) => acc + r.spendUsd, 0),
      2,
    );

    const citations = new Set<CitationId>([prop.citationId]);
    const propLeaseCites: CitationId[] = [];
    const propLeadCites: CitationId[] = [];
    for (const r of rows) {
      if (r.signedLeasesInPeriod > 0) {
        for (const c of r.citations) {
          if (c.startsWith('leases:') && !propLeaseCites.includes(c)) {
            propLeaseCites.push(c);
          }
        }
        const firstSignedLead = r.citations.find((c) => c.startsWith('leads:'));
        if (firstSignedLead && !propLeadCites.includes(firstSignedLead)) {
          propLeadCites.push(firstSignedLead);
        }
      }
    }
    propLeaseCites.sort();
    propLeadCites.sort();
    for (const c of propLeaseCites.slice(0, 2)) {
      citations.add(c);
    }
    for (const c of propLeadCites.slice(0, 1)) {
      citations.add(c);
    }
    for (const r of rows) {
      for (const c of r.citations.slice(0, 3)) {
        citations.add(c);
      }
    }

    byProperty.push({
      propertyId: prop.propertyId,
      propertyName: prop.name,
      buildingClass: prop.buildingClass,
      spendUsd,
      leadsCreatedCount,
      touredCount,
      appliedCount,
      appliedWithoutTourCount,
      signedLeasesInPeriod,
      deadSpendSources: deadRows.map((d) => d.source).sort(),
      deadSpendUsd,
      citations: [...citations],
    });
  }

  const deadPairDetails = [...byPropertySource]
    .filter((r) => r.isDeadSpend)
    .sort((a, b) => {
      const pCmp = a.propertyId.localeCompare(b.propertyId);
      return pCmp !== 0 ? pCmp : a.source.localeCompare(b.source);
    });

  const deadPairs: Array<readonly [string, string]> = deadPairDetails.map(
    (d) => [d.propertyId, d.source] as const,
  );
  const affectedBuildingCount = new Set(
    deadPairDetails.map((d) => d.propertyId),
  ).size;
  const totalDeadSpendUsd = roundTo(
    deadPairDetails.reduce((acc, d) => acc + d.spendUsd, 0),
    2,
  );
  const totalPostedInvoicesOnDeadPairs = deadPairDetails.reduce(
    (acc, d) => acc + d.postedInvoiceCount,
    0,
  );
  const totalVoidInvoicesOnDeadPairs = deadPairDetails.reduce(
    (acc, d) => acc + d.voidInvoiceCount,
    0,
  );
  const totalDeadLeads = deadPairDetails.reduce(
    (acc, d) => acc + d.leadsCreatedCount,
    0,
  );
  const totalDeadTours = deadPairDetails.reduce(
    (acc, d) => acc + d.touredCount,
    0,
  );
  const totalDeadApplied = deadPairDetails.reduce(
    (acc, d) => acc + d.appliedCount,
    0,
  );

  // Compute portfolio-wide paid source rankings over all operating properties for reallocation
  const paidSourceMetrics = bySource
    .filter(
      (s) =>
        s.isPaidSource &&
        s.signedLeasesInPeriod > 0 &&
        s.exactCostPerSignedLeaseUsd !== null,
    )
    .sort(
      (a, b) =>
        (a.exactCostPerSignedLeaseUsd ?? Number.POSITIVE_INFINITY) -
        (b.exactCostPerSignedLeaseUsd ?? Number.POSITIVE_INFINITY),
    );

  const bestPaid = paidSourceMetrics[0];
  const bestSourceName = bestPaid?.source ?? 'Apartments.com';
  const bestSourceSpendUsd = bestPaid?.spendUsd ?? 0;
  const bestSourceSignedLeases = bestPaid?.signedLeasesInPeriod ?? 0;
  const bestSourceExactCpsl = bestPaid?.exactCostPerSignedLeaseUsd ?? 1;
  const bestSourceRoundedCpsl = bestPaid?.costPerSignedLeaseUsd ?? 1;
  const unroundedAdditionalLeases =
    bestSourceExactCpsl > 0
      ? roundTo(totalDeadSpendUsd / bestSourceExactCpsl, 2)
      : 0;
  const projectedAdditionalWholeLeases =
    bestSourceExactCpsl > 0
      ? Math.floor(totalDeadSpendUsd / bestSourceExactCpsl)
      : 0;

  // Ensure every dead-spend building (P01, P03, P05, P06, P07, P08) and a spend row is represented
  const reallocCitations = new Set<CitationId>();
  for (const d of deadPairDetails) {
    reallocCitations.add(`properties:${d.propertyId}` as CitationId);
    const firstSpend = d.citations.find((c) => c.startsWith('spend:'));
    if (firstSpend) {
      reallocCitations.add(firstSpend);
    }
  }
  if (bestPaid) {
    const firstSpend = bestPaid.citations.find((c) => c.startsWith('spend:'));
    const firstLease = bestPaid.citations.find((c) => c.startsWith('leases:'));
    const firstLead = bestPaid.citations.find((c) => c.startsWith('leads:'));
    if (firstSpend) reallocCitations.add(firstSpend);
    if (firstLease) reallocCitations.add(firstLease);
    if (firstLead) reallocCitations.add(firstLead);
    for (const c of bestPaid.citations.slice(0, 3)) {
      reallocCitations.add(c);
    }
  }

  const summaryCitations = new Set<CitationId>([...reallocCitations]);
  for (const r of byPropertySource.slice(0, 6)) {
    for (const c of r.citations.slice(0, 2)) {
      summaryCitations.add(c);
    }
  }

  return {
    windowLabel: windowSpec.label,
    startDate: windowSpec.startDate,
    endDate: windowSpec.endDate,
    months: windowSpec.months,
    totalSpendUsd: roundTo(
      byPropertySource.reduce((acc, r) => acc + r.spendUsd, 0),
      2,
    ),
    totalLeadsCreated: byPropertySource.reduce(
      (acc, r) => acc + r.leadsCreatedCount,
      0,
    ),
    totalToured: byPropertySource.reduce((acc, r) => acc + r.touredCount, 0),
    totalApplied: byPropertySource.reduce((acc, r) => acc + r.appliedCount, 0),
    totalAppliedWithoutTour: byPropertySource.reduce(
      (acc, r) => acc + r.appliedWithoutTourCount,
      0,
    ),
    totalSignedLeases: byPropertySource.reduce(
      (acc, r) => acc + r.signedLeasesInPeriod,
      0,
    ),
    byPropertySource,
    bySource,
    byProperty,
    deadSpendReallocation: {
      deadPairs,
      deadPairDetails,
      affectedBuildingCount,
      totalDeadSpendUsd,
      totalPostedInvoicesOnDeadPairs,
      totalVoidInvoicesOnDeadPairs,
      totalDeadLeads,
      totalDeadTours,
      totalDeadApplied,
      cadRateUsed: store.policy.cadToUsdRate,
      bestPortfolioPaidSource: bestSourceName,
      bestSourceSpendUsd,
      bestSourceSignedLeases,
      bestSourcePortfolioCpslUsd: bestSourceRoundedCpsl,
      bestSourceExactCpslUsd: roundTo(bestSourceExactCpsl, 4),
      unroundedAdditionalLeases,
      projectedAdditionalWholeLeases,
      citations: [...reallocCitations],
    },
    citations: [...summaryCitations],
  };
}

export interface DataQualityAuditSummary {
  readonly voidSpendRowCount: number;
  readonly voidSpendIds: readonly string[];
  readonly voidSpendRawTotal: number;
  readonly voidSpendUsdTotal: number;
  readonly duplicateLeadCount: number;
  readonly duplicateLeadIds: readonly string[];
  readonly earliestCreditedLeadIds: readonly string[];
  readonly cadSpendRowCount: number;
  readonly postedCadSpendRowCount: number;
  readonly onboardingPropertyIds: readonly string[];
  readonly promptInjectionAttempts: ReadonlyArray<{
    readonly leadId: string;
    readonly propertyId: string;
    readonly source: string;
    readonly reason: string | null;
  }>;
  readonly citations: readonly CitationId[];
}

export function queryDataQualityAudit(
  store: PortfolioStore,
): DataQualityAuditSummary {
  const voidIds = store.voidSpend.map((s) => s.spendId);
  const voidSpendRawTotal = roundTo(
    store.voidSpend.reduce((acc, s) => acc + s.rawAmount, 0),
    2,
  );
  const voidSpendUsdTotal = roundTo(
    store.voidSpend.reduce(
      (acc, s) =>
        acc +
        s.rawAmount * (s.currency === 'CAD' ? store.policy.cadToUsdRate : 1.0),
      0,
    ),
    2,
  );
  const dupIds = store.duplicateLeads.map((l) => l.leadId);
  const earliestCreditedLeadIds = [
    ...new Set(
      store.duplicateLeads
        .map((l) => l.duplicateOfLeadId)
        .filter((id): id is string => Boolean(id)),
    ),
  ].sort();

  const cadRows = store.spend.filter((s) => s.currency === 'CAD');
  const postedCadRows = store.spend.filter(
    (s) => s.currency === 'CAD' && !s.isVoid,
  );

  const citations: CitationId[] = [
    ...store.voidSpend.slice(0, 4).map((s) => s.citationId),
    ...store.duplicateLeads.slice(0, 4).map((l) => l.citationId),
  ];

  return {
    voidSpendRowCount: voidIds.length,
    voidSpendIds: voidIds,
    voidSpendRawTotal,
    voidSpendUsdTotal,
    duplicateLeadCount: dupIds.length,
    duplicateLeadIds: dupIds,
    earliestCreditedLeadIds,
    cadSpendRowCount: cadRows.length,
    postedCadSpendRowCount: postedCadRows.length,
    onboardingPropertyIds: store.onboardingProperties.map((p) => p.propertyId),
    promptInjectionAttempts: store.promptInjectionAttempts.map((p) => ({
      leadId: p.leadId,
      propertyId: p.propertyId,
      source: p.source,
      reason: p.injectionReason,
    })),
    citations,
  };
}
