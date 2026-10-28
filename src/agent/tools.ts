import type { CitationId, PortfolioStore } from '../data/schema.ts';
import {
  type DecisionQueryFilter,
  evaluateBudgetDecisionsAndLearn,
  formatDecisionsAsCsv,
} from '../domain/learner.ts';
import {
  queryDataQualityAudit,
  queryLeasesAndRenewals,
  queryMarketingSpendAndFunnel,
  queryUnitsAndOccupancy,
} from '../domain/metrics.ts';
import {
  type PropertyFilterCriteria,
  resolveProperties,
} from '../domain/resolver.ts';
import {
  evaluateSheafCoboundary,
  FLOW_PORTFOLIO_SHEAF_EDGES,
  portfolioStoreToGenericTables,
  verifySheafConsistency,
} from '../domain/sheaf.ts';
import { FLOW_PORTFOLIO_SCHEMA } from '../schema.ts';

export type AgentToolName =
  | 'find_properties'
  | 'query_units_and_occupancy'
  | 'query_leases_and_renewals'
  | 'query_marketing_spend_and_funnel'
  | 'evaluate_budget_decisions'
  | 'audit_sheaf_consistency';

export interface ToolDefinition {
  readonly name: AgentToolName;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface ToolCallTrace {
  readonly toolName: AgentToolName;
  readonly args: Readonly<Record<string, unknown>>;
  readonly outputSummary: string;
  readonly citations: readonly CitationId[];
  readonly rawOutput: unknown;
}

/**
 * Dynamically builds the 6 read-only portfolio tool schemas and descriptions directly from
 * the distinct column values in `store` (`properties.csv`, `units.csv`, `leases.csv`, `leads.csv`,
 * `spend.csv`, `decisions.csv`), so 10x or unseen datasets with new building classes (`C`, `A+`),
 * new unit views (`river`, `harbor`, `skyline`), new PMS adapters (`ResMan`, `Buildium`),
 * new amenities (`pickleball court`, `cold plunge`), or new listing sources (`StreetEasy`, `TikTok Ads`)
 * are immediately exposed in strict LLM function-calling schemas with zero hardcoded bottlenecks.
 */
export function buildFlowIqToolDefinitions(
  store?: PortfolioStore,
): readonly ToolDefinition[] {
  const allPropIds = store
    ? store.properties.map((p) => p.propertyId)
    : ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09'];
  const opPropIds = store
    ? store.operatingProperties.map((p) => p.propertyId)
    : ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08'];
  const nonOpSummary =
    store && store.onboardingProperties.length > 0
      ? store.onboardingProperties
          .map((p) => `${p.propertyId} ${p.name}`)
          .join(', ')
      : 'P09 Cornell Annex';

  const propIdRangeLabel =
    allPropIds.length > 0
      ? `${allPropIds[0]}..${allPropIds[allPropIds.length - 1]}`
      : 'P01..P09';
  const opIdRangeLabel =
    opPropIds.length > 0
      ? `${opPropIds[0]}..${opPropIds[opPropIds.length - 1]}`
      : 'P01..P08';

  const distinctNeighborhoods = store
    ? [...new Set(store.properties.map((p) => p.neighborhood))]
    : [
        'South Loop',
        'West Loop',
        'Streeterville',
        'Fulton Market',
        'Edgewater',
        'Lincoln Park',
        'Logan Square',
        'Hyde Park',
      ];
  const distinctPms = store
    ? [...new Set(store.properties.map((p) => p.pms))]
    : ['Yardi', 'Entrata', 'RealPage', 'MRI', 'AppFolio'];
  const distinctClasses = store
    ? [...new Set(store.properties.map((p) => p.buildingClass))].sort()
    : ['A', 'B'];
  const distinctAmenities = store
    ? [...new Set(store.properties.flatMap((p) => p.amenities))]
    : [
        'lake view',
        'rooftop pool',
        'rooftop deck',
        'gym',
        'doorman',
        'parking garage',
        'dog run',
        'EV charging',
        'coworking',
        'package lockers',
        'bike storage',
        'courtyard',
      ];
  const distinctBedrooms = store
    ? [...new Set(store.units.map((u) => u.bedrooms))].sort((a, b) => a - b)
    : [0, 1, 2, 3];
  const distinctBathrooms = store
    ? [...new Set(store.units.map((u) => u.bathrooms))].sort((a, b) => a - b)
    : [1, 1.5, 2];
  const distinctViews = store
    ? [...new Set(store.units.map((u) => u.view))]
    : ['lake', 'city', 'park', 'courtyard', 'none'];
  const distinctStatuses = store
    ? [...new Set(store.units.map((u) => u.status))]
    : ['occupied', 'notice', 'vacant'];
  const distinctSources = store
    ? [...new Set([...store.paidSources, ...store.organicSources])]
    : [
        'Apartments.com',
        'Zillow',
        'Rent.',
        'Apartment List',
        'Facebook Ads',
        'Google Ads',
        'Website',
        'Referral',
      ];
  const distinctDecisionIds = store
    ? store.decisions.map((d) => d.decisionId)
    : ['X001', 'X002', 'X003', 'X004', 'X005', 'X006', 'X007', 'X008', 'X009', 'X010'];
  const decisionRangeLabel =
    distinctDecisionIds.length > 0
      ? `${distinctDecisionIds[0]}..${distinctDecisionIds[distinctDecisionIds.length - 1]}`
      : 'X001..X010';

  return [
    {
      name: 'find_properties',
      description: `FLOW-101: Resolve one or more buildings by property_id (${propIdRangeLabel}), name, nickname/alias (aka), neighborhood (${distinctNeighborhoods.slice(0, 10).join(', ')}), PMS (${distinctPms.join(', ')}), buildingClass (${distinctClasses.join(' | ')}), yearBuiltMin/yearBuiltMax, or amenities (${distinctAmenities.slice(0, 12).join(', ')}). In single_building mode, returns status="ambiguous_match" with a clarifying question when multiple operating buildings match.`,
      inputSchema: {
        type: 'object',
        properties: {
          propertyId: {
            type: 'string',
            description: `Exact property ID (e.g. ${propIdRangeLabel})`,
          },
          queryText: {
            type: 'string',
            description:
              'Natural language building description, stem, or alias (e.g. "the Halsted", "South Loop building with a doorman")',
          },
          neighborhood: {
            type: 'string',
            description: `Neighborhood name (${distinctNeighborhoods.slice(0, 12).join(', ')})`,
          },
          pms: {
            type: 'string',
            description: `Property management system (${distinctPms.join(', ')})`,
          },
          buildingClass: {
            type: 'string',
            enum: distinctClasses,
            description: `Building class from properties.csv (${distinctClasses.join(', ')})`,
          },
          yearBuiltMin: {
            type: 'integer',
            description: 'Inclusive lower bound on year_built',
          },
          yearBuiltMax: {
            type: 'integer',
            description: 'Inclusive upper bound on year_built',
          },
          amenities: {
            type: 'array',
            items: { type: 'string' },
            description: `Required building amenities (e.g. ${JSON.stringify(distinctAmenities.slice(0, 4))})`,
          },
          includeOnboarding: {
            type: 'boolean',
            description: `Include non-operating onboarding properties with 0 units (${nonOpSummary})`,
          },
          resolutionMode: {
            type: 'string',
            enum: ['single_building', 'portfolio_filter'],
            description:
              'Use single_building when the operator refers to one building ("the South Loop building") to trigger ambiguity clarification if >1 match.',
          },
        },
      },
    },
    {
      name: 'query_units_and_occupancy',
      description: `Query apartment units, occupied share ((occupied + notice) / total), vacancy rate (vacant / total), unit counts, average market_rent, average sqft, and rent per sqft filtered by propertyIds (${opIdRangeLabel}), buildingClass (${distinctClasses.join('|')}), bedrooms (${distinctBedrooms.join(', ')}), bathrooms (${distinctBathrooms.join(', ')}), sqftMin/sqftMax, floorMin/floorMax, view (${distinctViews.join(', ')}), and status (${distinctStatuses.join(', ')}).`,
      inputSchema: {
        type: 'object',
        properties: {
          propertyIds: {
            type: 'array',
            items: { type: 'string' },
            description: `Optional list of operating property IDs (defaults to ${opIdRangeLabel})`,
          },
          buildingClass: {
            type: 'string',
            enum: distinctClasses,
            description: `Filter buildings by class (${distinctClasses.join(', ')})`,
          },
          bedrooms: {
            type: 'integer',
            description: `Filter by bedroom count (${distinctBedrooms.map((b) => (b === 0 ? '0 = studio' : `${b} = ${b}BR`)).join(', ')})`,
          },
          bathrooms: {
            type: 'number',
            description: `Filter by bathroom count (e.g. ${distinctBathrooms.join(', ')})`,
          },
          sqftMin: {
            type: 'integer',
            description: 'Minimum unit square footage (inclusive)',
          },
          sqftMax: {
            type: 'integer',
            description: 'Maximum unit square footage (inclusive)',
          },
          floorMin: {
            type: 'integer',
            description: 'Minimum floor number (inclusive)',
          },
          floorMax: {
            type: 'integer',
            description: 'Maximum floor number (inclusive)',
          },
          view: {
            type: 'string',
            enum: distinctViews,
            description: `Filter by unit view (${distinctViews.join(', ')})`,
          },
          status: {
            type: 'string',
            enum: distinctStatuses,
            description: `Filter by unit status (${distinctStatuses.join(', ')})`,
          },
        },
      },
    },
    {
      name: 'query_leases_and_renewals',
      description: `Query leases by propertyIds (${opIdRangeLabel}), PMS (${distinctPms.join(', ')}), buildingClass (${distinctClasses.join('|')}), unit attributes (bedrooms, bathrooms, view, floorMin/Max), leaseType (new or renewal), start_date range, end_date range, or renewalStatus (renewed, pending, notice_given, not_due). Returns counts, renewalRatePercent, total monthly_rent at risk, and average concession_usd (zeros included).`,
      inputSchema: {
        type: 'object',
        properties: {
          propertyIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of operating property IDs',
          },
          pms: {
            type: 'string',
            description: `Filter buildings by PMS (${distinctPms.join(', ')})`,
          },
          buildingClass: {
            type: 'string',
            enum: distinctClasses,
            description: `Filter buildings by class (${distinctClasses.join(', ')})`,
          },
          bedrooms: {
            type: 'integer',
            description: `Filter leases by unit bedroom count (${distinctBedrooms.join(', ')})`,
          },
          bathrooms: {
            type: 'number',
            description: 'Filter leases by unit bathroom count',
          },
          view: {
            type: 'string',
            enum: distinctViews,
            description: `Filter leases by unit view (${distinctViews.join(', ')})`,
          },
          floorMin: {
            type: 'integer',
            description: 'Minimum unit floor number',
          },
          floorMax: {
            type: 'integer',
            description: 'Maximum unit floor number',
          },
          leaseType: {
            type: 'string',
            enum: ['new', 'renewal'],
            description: 'Filter by lease_type',
          },
          startDateFrom: {
            type: 'string',
            description: 'YYYY-MM-DD inclusive lower bound on start_date',
          },
          startDateTo: {
            type: 'string',
            description: 'YYYY-MM-DD inclusive upper bound on start_date',
          },
          endDateFrom: {
            type: 'string',
            description: 'YYYY-MM-DD inclusive lower bound on end_date',
          },
          endDateTo: {
            type: 'string',
            description: 'YYYY-MM-DD inclusive upper bound on end_date',
          },
          renewalStatus: {
            type: 'string',
            enum: ['renewed', 'pending', 'notice_given', 'not_due'],
            description: 'Filter by renewal_status',
          },
          signedFromLeadsOnly: {
            type: 'boolean',
            description:
              'Restrict to leases linked from CRM leads (leads.lease_id)',
          },
        },
      },
    },
    {
      name: 'query_marketing_spend_and_funnel',
      description: `FLOW-102/103: Join ILS/ad spend (1 CAD = ${store?.policy.cadToUsdRate ?? 0.73} USD, void invoices = $0), deduplicated CRM leads (notes quarantined), and PMS signed leases (bucketed by ${store?.policy.leaseBucketBy ?? 'lease.start_date'}, credited to earliest lead). Computes Cost Per Signed Lease (CPSL), Cost Per Lead (CPL), Cost Per Tour (CPT), apply rate, tour-to-lease conversion, dead-spend pairs, portfolio reallocation math, and data-quality audits across sources (${distinctSources.join(', ')}).`,
      inputSchema: {
        type: 'object',
        properties: {
          propertyIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of operating property IDs',
          },
          buildingClass: {
            type: 'string',
            enum: distinctClasses,
            description: `Filter buildings by class (${distinctClasses.join(', ')})`,
          },
          sources: {
            type: 'array',
            items: { type: 'string' },
            description: `Optional list of lead/spend sources (${distinctSources.join(', ')})`,
          },
          period: {
            type: 'string',
            description:
              'Analysis period window (e.g. "Apr-Sep 2026", "Q3 2026", "Q2 2026", "H1 2026", "2026-08", "August 2026", "September 2026")',
          },
          startDate: {
            type: 'string',
            description: 'Optional YYYY-MM-DD start date override',
          },
          endDate: {
            type: 'string',
            description: 'Optional YYYY-MM-DD end date override',
          },
          paidOnly: {
            type: 'boolean',
            description:
              'Restrict to paid sources appearing in spend.csv (excludes organic sources)',
          },
          bedroomsWanted: {
            type: 'integer',
            description: `Filter CRM leads by bedrooms_wanted (${distinctBedrooms.join(', ')})`,
          },
          appliedOnly: {
            type: 'boolean',
            description: 'Filter CRM leads to applied=true',
          },
          appliedWithoutTourOnly: {
            type: 'boolean',
            description:
              'Filter CRM leads to applied=true AND toured=false (funnel contradiction check)',
          },
          includeDataQualityAudit: {
            type: 'boolean',
            description:
              'Include counts of void spend rows, duplicate leads, CAD rows, and quarantined prompt injections',
          },
        },
      },
    },
    {
      name: 'evaluate_budget_decisions',
      description: `FLOW-105: Run the conjugate Gamma-Poisson / Empirical-Bayes outcome learner over data/ops/decisions.csv (${decisionRangeLabel}). Supports filtering by propertyId, decisionIds, accepted ("yes"|"no"|"all"), recommendation ("increase"|"decrease"), source, and month. Evaluates pre/post outcomes, Poisson zero-lease tail probabilities Pr(K=0), small-sample shrinkage guards, counterfactual regret, ranking changes, and generates new logged recommendations.`,
      inputSchema: {
        type: 'object',
        properties: {
          propertyId: {
            type: 'string',
            description: `Optional property ID filter (e.g. ${opPropIds.slice(0, 3).join(', ')})`,
          },
          propertyIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of property IDs',
          },
          decisionIds: {
            type: 'array',
            items: { type: 'string' },
            description: `Optional list of decision IDs (${decisionRangeLabel})`,
          },
          accepted: {
            type: 'string',
            enum: ['yes', 'no', 'all'],
            description: 'Filter decisions by accepted status',
          },
          recommendation: {
            type: 'string',
            enum: ['increase', 'decrease'],
            description: 'Filter decisions by recommendation direction',
          },
          source: {
            type: 'string',
            description: 'Filter decisions by marketing source',
          },
          month: {
            type: 'string',
            description: 'Filter decisions by decision month (YYYY-MM)',
          },
        },
      },
    },
    {
      name: 'audit_sheaf_consistency',
      description:
        'Cross-Table Data Integrity & Quarantine Audit: Evaluates all 6 cross-table restriction edges (E1..E6) and quarantine rules across properties, units, leases, leads, spend, and decisions in O(N) time, returning exact primary-key citations for every residual.',
      inputSchema: {
        type: 'object',
        properties: {
          includeGenericReport: {
            type: 'boolean',
            description: 'Include generic schema-driven consistency report',
          },
        },
      },
    },
  ];
}

export const FLOWIQ_TOOL_DEFINITIONS: readonly ToolDefinition[] =
  buildFlowIqToolDefinitions();

export function executeAgentTool(
  store: PortfolioStore,
  toolName: AgentToolName,
  args: Readonly<Record<string, unknown>> = {},
): ToolCallTrace {
  switch (toolName) {
    case 'find_properties': {
      const criteria: PropertyFilterCriteria = {
        propertyId:
          typeof args.propertyId === 'string' ? args.propertyId : undefined,
        queryText:
          typeof args.queryText === 'string' ? args.queryText : undefined,
        neighborhood:
          typeof args.neighborhood === 'string' ? args.neighborhood : undefined,
        pms: typeof args.pms === 'string' ? args.pms : undefined,
        buildingClass:
          typeof args.buildingClass === 'string'
            ? args.buildingClass
            : undefined,
        yearBuiltMin:
          typeof args.yearBuiltMin === 'number' ? args.yearBuiltMin : undefined,
        yearBuiltMax:
          typeof args.yearBuiltMax === 'number' ? args.yearBuiltMax : undefined,
        amenities: Array.isArray(args.amenities)
          ? (args.amenities as string[])
          : undefined,
        includeOnboarding: Boolean(args.includeOnboarding),
        expectSingle:
          args.resolutionMode === 'single_building'
            ? true
            : typeof args.expectSingle === 'boolean'
              ? args.expectSingle
              : undefined,
        resolutionMode:
          args.resolutionMode === 'single_building' ||
          args.resolutionMode === 'portfolio_filter'
            ? args.resolutionMode
            : undefined,
      };
      const res = resolveProperties(store, criteria);
      return {
        toolName,
        args,
        outputSummary:
          res.status === 'ambiguous_match'
            ? `Ambiguous match (${res.matched.map((p) => p.propertyId).join(', ')}): ${res.clarifyingQuestion}`
            : `Matched ${res.matched.length} building(s): ${res.matched.map((p) => `${p.propertyId} (${p.name})`).join(', ')}`,
        citations: res.citations,
        rawOutput: res,
      };
    }

    case 'query_units_and_occupancy': {
      const res = queryUnitsAndOccupancy(store, {
        propertyIds: Array.isArray(args.propertyIds)
          ? (args.propertyIds as string[])
          : undefined,
        buildingClass:
          typeof args.buildingClass === 'string'
            ? args.buildingClass
            : undefined,
        bedrooms:
          typeof args.bedrooms === 'number' ? args.bedrooms : undefined,
        bathrooms:
          typeof args.bathrooms === 'number' ? args.bathrooms : undefined,
        sqftMin: typeof args.sqftMin === 'number' ? args.sqftMin : undefined,
        sqftMax: typeof args.sqftMax === 'number' ? args.sqftMax : undefined,
        floorMin: typeof args.floorMin === 'number' ? args.floorMin : undefined,
        floorMax: typeof args.floorMax === 'number' ? args.floorMax : undefined,
        view: typeof args.view === 'string' ? args.view : undefined,
        status:
          typeof args.status === 'string'
            ? (args.status as 'occupied' | 'notice' | 'vacant')
            : undefined,
      });
      return {
        toolName,
        args,
        outputSummary: `Filtered units=${res.totalFilteredUnits}, avgMarketRent=$${res.filteredAvgMarketRentUsd.toFixed(2)}, avgSqft=${res.filteredAvgSqft.toFixed(1)} across ${res.byProperty.length} building(s)`,
        citations: res.citations,
        rawOutput: res,
      };
    }

    case 'query_leases_and_renewals': {
      const res = queryLeasesAndRenewals(store, {
        propertyIds: Array.isArray(args.propertyIds)
          ? (args.propertyIds as string[])
          : undefined,
        pms: typeof args.pms === 'string' ? args.pms : undefined,
        buildingClass:
          typeof args.buildingClass === 'string'
            ? args.buildingClass
            : undefined,
        bedrooms:
          typeof args.bedrooms === 'number' ? args.bedrooms : undefined,
        bathrooms:
          typeof args.bathrooms === 'number' ? args.bathrooms : undefined,
        view: typeof args.view === 'string' ? args.view : undefined,
        floorMin: typeof args.floorMin === 'number' ? args.floorMin : undefined,
        floorMax: typeof args.floorMax === 'number' ? args.floorMax : undefined,
        leaseType:
          args.leaseType === 'new' || args.leaseType === 'renewal'
            ? args.leaseType
            : undefined,
        startDateFrom:
          typeof args.startDateFrom === 'string'
            ? args.startDateFrom
            : undefined,
        startDateTo:
          typeof args.startDateTo === 'string' ? args.startDateTo : undefined,
        endDateFrom:
          typeof args.endDateFrom === 'string' ? args.endDateFrom : undefined,
        endDateTo:
          typeof args.endDateTo === 'string' ? args.endDateTo : undefined,
        renewalStatus:
          typeof args.renewalStatus === 'string'
            ? (args.renewalStatus as
                | 'renewed'
                | 'pending'
                | 'notice_given'
                | 'not_due')
            : undefined,
        signedFromLeadsOnly:
          typeof args.signedFromLeadsOnly === 'boolean'
            ? args.signedFromLeadsOnly
            : undefined,
      });
      return {
        toolName,
        args,
        outputSummary: `Matching leases=${res.totalMatchingLeases}, renewed=${res.renewedCount}, pending=${res.pendingCount}, notice_given=${res.noticeGivenCount}, renewalRate=${res.renewalRatePercent.toFixed(1)}%, monthlyRent=$${res.totalMonthlyRentUsd}, avgConcession=$${res.averageConcessionUsd.toFixed(2)}`,
        citations: res.citations,
        rawOutput: res,
      };
    }

    case 'query_marketing_spend_and_funnel': {
      const mkt = queryMarketingSpendAndFunnel(store, {
        propertyIds: Array.isArray(args.propertyIds)
          ? (args.propertyIds as string[])
          : undefined,
        buildingClass:
          typeof args.buildingClass === 'string'
            ? args.buildingClass
            : undefined,
        sources: Array.isArray(args.sources)
          ? (args.sources as string[])
          : undefined,
        period: typeof args.period === 'string' ? args.period : undefined,
        startDate:
          typeof args.startDate === 'string' ? args.startDate : undefined,
        endDate: typeof args.endDate === 'string' ? args.endDate : undefined,
        paidOnly:
          typeof args.paidOnly === 'boolean' ? args.paidOnly : undefined,
        bedroomsWanted:
          typeof args.bedroomsWanted === 'number'
            ? args.bedroomsWanted
            : undefined,
        appliedOnly:
          typeof args.appliedOnly === 'boolean' ? args.appliedOnly : undefined,
        appliedWithoutTourOnly:
          typeof args.appliedWithoutTourOnly === 'boolean'
            ? args.appliedWithoutTourOnly
            : undefined,
      });

      const dq = args.includeDataQualityAudit
        ? queryDataQualityAudit(store)
        : undefined;
      const combinedOutput = dq ? { ...mkt, dataQualityAudit: dq } : mkt;
      const citations = dq
        ? [...new Set([...mkt.citations, ...dq.citations])]
        : mkt.citations;

      return {
        toolName,
        args,
        outputSummary: `Window=${mkt.windowLabel}, totalSpendUsd=$${mkt.totalSpendUsd.toFixed(2)}, totalSignedLeases=${mkt.totalSignedLeases}, deadPairs=${mkt.deadSpendReallocation.deadPairs.length} ($${mkt.deadSpendReallocation.totalDeadSpendUsd.toFixed(2)})`,
        citations,
        rawOutput: combinedOutput,
      };
    }

    case 'evaluate_budget_decisions': {
      const filter: DecisionQueryFilter = {
        propertyId:
          typeof args.propertyId === 'string' ? args.propertyId : undefined,
        propertyIds: Array.isArray(args.propertyIds)
          ? (args.propertyIds as string[])
          : undefined,
        decisionIds: Array.isArray(args.decisionIds)
          ? (args.decisionIds as string[])
          : undefined,
        accepted:
          args.accepted === 'yes' ||
          args.accepted === 'no' ||
          args.accepted === 'all'
            ? args.accepted
            : undefined,
        recommendation:
          args.recommendation === 'increase' ||
          args.recommendation === 'decrease'
            ? args.recommendation
            : undefined,
        source: typeof args.source === 'string' ? args.source : undefined,
        month: typeof args.month === 'string' ? args.month : undefined,
      };
      const report = evaluateBudgetDecisionsAndLearn(store, filter);
      return {
        toolName,
        args,
        outputSummary: `Evaluated ${report.evaluatedDecisions.length} decisions, ${report.rankingShifts.length} ranking shifts, windowInvariance=${report.windowInvarianceVerified}`,
        citations: report.citations,
        rawOutput: {
          ...report,
          proposedNextDecisionsCsv: formatDecisionsAsCsv(
            report.proposedNextDecisions,
            true,
          ),
        },
      };
    }

    case 'audit_sheaf_consistency': {
      const coboundary = evaluateSheafCoboundary(store, FLOW_PORTFOLIO_SHEAF_EDGES);
      const generic = args.includeGenericReport
        ? verifySheafConsistency(FLOW_PORTFOLIO_SCHEMA, portfolioStoreToGenericTables(store))
        : undefined;
      return {
        toolName,
        args,
        outputSummary: `isGlobalSection=${coboundary.isGlobalSection}, blockingResiduals=${coboundary.blockingResidualCount}, totalResiduals=${coboundary.totalResidualCount}`,
        citations: coboundary.citations.slice(0, 16),
        rawOutput: generic ? { coboundary, generic } : coboundary,
      };
    }
  }
}
