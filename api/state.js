import path from 'node:path';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { evaluateBudgetDecisionsAndLearn } from '../src/domain/learner.ts';
import {
  queryDataQualityAudit,
  queryLeasesAndRenewals,
  queryMarketingSpendAndFunnel,
  queryUnitsAndOccupancy,
} from '../src/domain/metrics.ts';
import {
  evaluateSheafCoboundary,
  FLOW_PORTFOLIO_SHEAF_EDGES,
} from '../src/domain/sheaf.ts';

function parsePolicyOverrides(raw = {}) {
  const overrides = {};
  if (raw.cadToUsdRate !== undefined) {
    const v = Number.parseFloat(String(raw.cadToUsdRate));
    if (Number.isFinite(v) && v > 0) overrides.cadToUsdRate = v;
  }
  if (raw.occupiedIncludesNotice !== undefined) {
    overrides.occupiedIncludesNotice =
      raw.occupiedIncludesNotice === true ||
      raw.occupiedIncludesNotice === 'true';
  }
  if (raw.leaseBucketBy !== undefined) {
    overrides.leaseBucketBy =
      raw.leaseBucketBy === 'lead_created_date'
        ? 'lead_created_date'
        : 'lease_start_date';
  }
  if (raw.priorSpendUsdBeta0 !== undefined) {
    const v = Number.parseFloat(String(raw.priorSpendUsdBeta0));
    if (Number.isFinite(v) && v > 0) overrides.priorSpendUsdBeta0 = v;
  }
  if (raw.quarantineZeroUnitProperties !== undefined) {
    overrides.quarantineZeroUnitProperties =
      raw.quarantineZeroUnitProperties === true ||
      raw.quarantineZeroUnitProperties === 'true';
  }
  if (raw.excludeVoidSpend !== undefined) {
    overrides.excludeVoidSpend =
      raw.excludeVoidSpend === true || raw.excludeVoidSpend === 'true';
  }
  if (raw.deduplicateLeads !== undefined) {
    overrides.deduplicateLeads =
      raw.deduplicateLeads === true || raw.deduplicateLeads === 'true';
  }
  return overrides;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const queryParams = Object.fromEntries(urlObj.searchParams.entries());
    const policyOverrides = parsePolicyOverrides(queryParams);

    const store = loadPortfolioStore(repoRoot, policyOverrides);
    const units = queryUnitsAndOccupancy(store);
    const leases = queryLeasesAndRenewals(store);
    const marketing = queryMarketingSpendAndFunnel(store, {
      period: 'APR_SEP_2026',
      paidOnly: false,
    });
    const learner = evaluateBudgetDecisionsAndLearn(store);
    const dataQuality = queryDataQualityAudit(store);
    const sheaf = evaluateSheafCoboundary(store, FLOW_PORTFOLIO_SHEAF_EDGES);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        ok: true,
        policy: store.policy,
        primaryKeyCount: store.primaryKeyIndex.size,
        unitsSummary: {
          portfolioTotalUnits: units.portfolioTotalUnits,
          portfolioOccupiedUnits: units.portfolioOccupiedUnits,
          portfolioNoticeUnits: units.portfolioNoticeUnits,
          portfolioVacantUnits: units.portfolioVacantUnits,
          portfolioOccupiedSharePercent: units.portfolioOccupiedSharePercent,
          portfolioVacancyRatePercent: units.portfolioVacancyRatePercent,
          byProperty: units.byProperty,
        },
        leasesSummary: {
          totalMatchingLeases: leases.totalMatchingLeases,
          renewalRatePercent: leases.renewalRatePercent,
          averageConcessionUsd: leases.averageConcessionUsd,
          noticeGivenCount: leases.noticeGivenCount,
        },
        marketingSummary: {
          totalSpendUsd: marketing.totalSpendUsd,
          totalSignedLeases: marketing.totalSignedLeases,
          bySource: marketing.bySource,
          deadSpendReallocation: marketing.deadSpendReallocation,
        },
        learnerSummary: {
          priorAlpha0: learner.priorAlpha0,
          priorBeta0Usd: learner.priorBeta0Usd,
          windowInvarianceVerified: learner.windowInvarianceVerified,
          evaluatedDecisions: learner.evaluatedDecisions,
          proposedNextDecisions: learner.proposedNextDecisions,
        },
        dataQuality,
        sheafSummary: {
          isGlobalSection: sheaf.isGlobalSection,
          blockingResidualCount: sheaf.blockingResidualCount,
          totalResidualCount: sheaf.totalResidualCount,
        },
      }),
    );
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
