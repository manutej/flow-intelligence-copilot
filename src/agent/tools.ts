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

export type AgentToolName =
  | 'find_properties'
  | 'query_units_and_occupancy'
  | 'query_leases_and_renewals'
  | 'query_marketing_spend_and_funnel'
  | 'evaluate_budget_decisions';

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

export const FLOWIQ_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: 'find_properties',
    description:
      'FLOW-101: Resolve one or more buildings by property_id (P01..P09), name, nickname/alias (aka), neighborhood, PMS (Yardi, Entrata, RealPage, MRI, AppFolio), buildingClass (A or B), yearBuiltMin/yearBuiltMax, or amenities (lake view, rooftop pool, doorman, dog run, EV charging, coworking, courtyard, etc.). In single_building mode, returns status="ambiguous_match" with a clarifying question when multiple operating buildings match.',
    inputSchema: {
      type: 'object',
      properties: {
        propertyId: {
          type: 'string',
          description: 'Exact property ID (e.g. P01..P09)',
        },
        queryText: {
          type: 'string',
          description:
            'Natural language building description or alias (e.g. "the Halsted", "South Loop building with a doorman")',
        },
        neighborhood: {
          type: 'string',
          description:
            'Neighborhood name (e.g. South Loop, West Loop, Streeterville, Logan Square, Lincoln Park, Uptown, Lakeview, Hyde Park)',
        },
        pms: {
          type: 'string',
          description:
            'Property management system (Yardi, Entrata, RealPage, MRI, AppFolio)',
        },
        buildingClass: {
          type: 'string',
          enum: ['A', 'B'],
          description: 'Building class from properties.csv (A or B)',
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
          description:
            'Required building amenities (e.g. ["lake view", "rooftop pool"])',
        },
        includeOnboarding: {
          type: 'boolean',
          description:
            'Include non-operating onboarding properties with 0 units (P09 Cornell Annex)',
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
    description:
      'Query apartment units, occupied share ((occupied + notice) / total), vacancy rate (vacant / total), unit counts, average market_rent, average sqft, and rent per sqft filtered by propertyIds, buildingClass (A|B), bedrooms (0=studio, 1, 2, 3), bathrooms (1, 1.5, 2), sqftMin/sqftMax, floorMin/floorMax, view (lake, city, park, courtyard, none), and status (occupied, notice, vacant).',
    inputSchema: {
      type: 'object',
      properties: {
        propertyIds: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional list of operating property IDs (defaults to P01..P08)',
        },
        buildingClass: {
          type: 'string',
          enum: ['A', 'B'],
          description: 'Filter buildings by class (A or B)',
        },
        bedrooms: {
          type: 'integer',
          description:
            'Filter by bedroom count (0 = studio, 1 = 1BR, 2 = 2BR, 3 = 3BR)',
        },
        bathrooms: {
          type: 'number',
          description: 'Filter by bathroom count (e.g. 1, 1.5, 2)',
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
          enum: ['lake', 'city', 'park', 'courtyard', 'none'],
          description:
            'Filter by unit view (lake, city, park, courtyard, none)',
        },
        status: {
          type: 'string',
          enum: ['occupied', 'notice', 'vacant'],
          description: 'Filter by unit status',
        },
      },
    },
  },
  {
    name: 'query_leases_and_renewals',
    description:
      'Query leases by propertyIds, PMS, buildingClass (A|B), unit attributes (bedrooms, bathrooms, view, floorMin/Max), leaseType (new or renewal), start_date range, end_date range, or renewalStatus (renewed, pending, notice_given, not_due). Returns counts, renewalRatePercent, total monthly_rent at risk, and average concession_usd (zeros included).',
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
          description: 'Filter buildings by PMS (Yardi, Entrata, RealPage, MRI)',
        },
        buildingClass: {
          type: 'string',
          enum: ['A', 'B'],
          description: 'Filter buildings by class (A or B)',
        },
        bedrooms: {
          type: 'integer',
          description: 'Filter leases by unit bedroom count (0, 1, 2, 3)',
        },
        bathrooms: {
          type: 'number',
          description: 'Filter leases by unit bathroom count',
        },
        view: {
          type: 'string',
          description:
            'Filter leases by unit view (lake, city, park, courtyard, none)',
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
    description:
      'FLOW-102/103: Join ILS/ad spend (1 CAD = 0.73 USD, void invoices = $0), deduplicated CRM leads (notes quarantined), and PMS signed leases (bucketed by lease.start_date, credited to earliest lead). Computes Cost Per Signed Lease (CPSL), Cost Per Lead (CPL), Cost Per Tour (CPT), apply rate, tour-to-lease conversion, dead-spend pairs, portfolio reallocation math, and data-quality audits.',
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
          enum: ['A', 'B'],
          description: 'Filter buildings by class (A or B)',
        },
        sources: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional list of lead/spend sources (e.g. ["Zillow", "Google Ads"])',
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
            'Restrict to paid sources appearing in spend.csv (excludes Website & Referral)',
        },
        bedroomsWanted: {
          type: 'integer',
          description:
            'Filter CRM leads by bedrooms_wanted (0 = studio, 1, 2, 3)',
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
    description:
      'FLOW-105: Run the conjugate Gamma-Poisson / Empirical-Bayes outcome learner over data/ops/decisions.csv (X001..X010). Supports filtering by propertyId, decisionIds (e.g. ["X004"]), accepted ("yes"|"no"|"all"), recommendation ("increase"|"decrease"), source, and month. Evaluates pre/post outcomes, Poisson zero-lease tail probabilities Pr(K=0), small-sample shrinkage guards, counterfactual regret, ranking changes, and generates new logged recommendations.',
    inputSchema: {
      type: 'object',
      properties: {
        propertyId: {
          type: 'string',
          description: 'Optional property ID filter (e.g. P01, P06)',
        },
        propertyIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of property IDs',
        },
        decisionIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of decision IDs (e.g. ["X004", "X006"])',
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
];

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
        period: typeof args.period === 'string' ? args.period : 'Apr-Sep 2026',
        startDate:
          typeof args.startDate === 'string' ? args.startDate : undefined,
        endDate: typeof args.endDate === 'string' ? args.endDate : undefined,
        paidOnly: args.paidOnly !== undefined ? Boolean(args.paidOnly) : false,
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
      const citations = [
        ...new Set([
          ...mkt.citations,
          ...(dq ? dq.citations : []),
        ]),
      ];
      return {
        toolName,
        args,
        outputSummary: `Window=${mkt.windowLabel}, spend=$${mkt.totalSpendUsd.toFixed(2)}, leads=${mkt.totalLeadsCreated}, leases=${mkt.totalSignedLeases}, deadPairs=${mkt.deadSpendReallocation.deadPairs.length} ($${mkt.deadSpendReallocation.totalDeadSpendUsd.toFixed(2)})`,
        citations,
        rawOutput: dq ? { ...mkt, dataQualityAudit: dq } : mkt,
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
          args.accepted === 'all' ||
          typeof args.accepted === 'boolean'
            ? (args.accepted as 'yes' | 'no' | 'all' | boolean)
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
  }
}
