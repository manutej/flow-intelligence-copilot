import { roundTo } from '../data/loader.ts';
import type { CitationId, PortfolioStore } from '../data/schema.ts';
import {
  FLOW_PORTFOLIO_SCHEMA,
  type QuarantineKind,
  type RelationalSheafSchema,
  type RestrictionKind,
} from '../schema.ts';

export type ResidualSeverity =
  | 'hard_integrity_error'
  | 'quarantine_entity'
  | 'quarantine_row'
  | 'temporal_boundary_shift'
  | 'metric_fiber_divergence';

export interface CoboundaryResidual<TLeft = unknown, TRight = unknown> {
  readonly edgeId: string;
  readonly description: string;
  readonly severity: ResidualSeverity;
  readonly joinKey: string;
  readonly leftStalk: string;
  readonly rightStalk: string;
  readonly leftProjection: TLeft;
  readonly rightProjection: TRight;
  readonly residualMagnitude: number;
  readonly blocking: boolean;
  readonly citations: readonly CitationId[];
}

export interface SheafRestrictionEdge<TStore, TLeft = unknown, TRight = unknown> {
  readonly edgeId: string;
  readonly description: string;
  readonly leftStalk: string;
  readonly rightStalk: string;
  readonly severity: ResidualSeverity;
  readonly blocking: boolean;
  readonly evaluateEdge: (
    store: TStore,
  ) => readonly CoboundaryResidual<TLeft, TRight>[];
}

export interface SheafCoboundaryReport {
  readonly isGlobalSection: boolean;
  readonly blockingResidualCount: number;
  readonly totalResidualCount: number;
  readonly byEdge: Readonly<Record<string, readonly CoboundaryResidual[]>>;
  readonly residuals: readonly CoboundaryResidual[];
  readonly citations: readonly CitationId[];
}

export function evaluateSheafCoboundary<TStore>(
  store: TStore,
  edges: readonly SheafRestrictionEdge<TStore>[],
): SheafCoboundaryReport {
  const byEdge: Record<string, readonly CoboundaryResidual[]> = {};
  const residuals: CoboundaryResidual[] = [];
  const citations = new Set<CitationId>();

  for (const edge of edges) {
    const edgeResiduals = edge.evaluateEdge(store);
    byEdge[edge.edgeId] = edgeResiduals;
    for (const r of edgeResiduals) {
      residuals.push(r);
      for (const c of r.citations) {
        citations.add(c);
      }
    }
  }

  const blockingResidualCount = residuals.filter((r) => r.blocking).length;
  return {
    isGlobalSection: blockingResidualCount === 0,
    blockingResidualCount,
    totalResidualCount: residuals.length,
    byEdge,
    residuals,
    citations: [...citations],
  };
}

/**
 * Declarative cellular sheaf specification for the 6 FLOW tables (E1..E6).
 * Every restriction map runs in O(N) via single-pass Map indices.
 */
export const FLOW_PORTFOLIO_SHEAF_EDGES: readonly SheafRestrictionEdge<PortfolioStore>[] = [
  {
    edgeId: 'E1_PROPERTIES_TO_UNITS_COUNT',
    description:
      'properties.declaredUnits == COUNT(units WHERE property_id = p) and >= 1 operating unit',
    leftStalk: 'properties',
    rightStalk: 'units',
    severity: 'quarantine_entity',
    blocking: false,
    evaluateEdge: (store) => {
      const counts = new Map<string, { count: number; cits: CitationId[] }>();
      for (const u of store.units) {
        const entry = counts.get(u.propertyId) ?? { count: 0, cits: [] };
        entry.count += 1;
        if (entry.cits.length < 2) entry.cits.push(u.citationId);
        counts.set(u.propertyId, entry);
      }
      const out: CoboundaryResidual<number, number>[] = [];
      for (const p of store.properties) {
        const actual = counts.get(p.propertyId)?.count ?? 0;
        if (
          actual === 0 ||
          actual !== p.declaredUnits ||
          !p.onboardingReadiness.readyForOperatingPool
        ) {
          out.push({
            edgeId: 'E1_PROPERTIES_TO_UNITS_COUNT',
            description: `Property ${p.propertyId} (${p.name}) fails operating stalk readiness: declared=${p.declaredUnits}, actual=${actual}, pms=${p.pms}`,
            severity: 'quarantine_entity',
            joinKey: p.propertyId,
            leftStalk: 'properties',
            rightStalk: 'units',
            leftProjection: p.declaredUnits,
            rightProjection: actual,
            residualMagnitude:
              Math.abs(p.declaredUnits - actual) + (actual === 0 ? 1 : 0),
            blocking: !store.policy.quarantineZeroUnitProperties,
            citations: [p.citationId, ...(counts.get(p.propertyId)?.cits ?? [])],
          });
        }
      }
      return out;
    },
  },
  {
    edgeId: 'E2_UNITS_TO_LEASES_STATUS',
    description:
      'Occupied/notice units have exactly 1 active lease; vacant units have 0; notice <-> notice_given',
    leftStalk: 'units',
    rightStalk: 'leases',
    severity: 'hard_integrity_error',
    blocking: true,
    evaluateEdge: (store) => {
      const leasesByUnit = new Map<string, (typeof store.leases)[number][]>();
      for (const l of store.leases) {
        const arr = leasesByUnit.get(l.unitId) ?? [];
        arr.push(l);
        leasesByUnit.set(l.unitId, arr);
      }
      const out: CoboundaryResidual[] = [];
      for (const u of store.units) {
        const ls = leasesByUnit.get(u.unitId) ?? [];
        const expectedCount = u.status === 'vacant' ? 0 : 1;
        if (ls.length !== expectedCount) {
          out.push({
            edgeId: 'E2_UNITS_TO_LEASES_STATUS',
            description: `Unit ${u.unitId} status="${u.status}" has ${ls.length} active leases (expected ${expectedCount})`,
            severity: 'hard_integrity_error',
            joinKey: u.unitId,
            leftStalk: 'units',
            rightStalk: 'leases',
            leftProjection: u.status,
            rightProjection: ls.length,
            residualMagnitude: Math.abs(ls.length - expectedCount),
            blocking: true,
            citations: [u.citationId, ...ls.map((x) => x.citationId)],
          });
        }
        for (const l of ls) {
          if ((u.status === 'notice') !== (l.renewalStatus === 'notice_given')) {
            out.push({
              edgeId: 'E2_UNITS_TO_LEASES_STATUS',
              description: `Unit ${u.unitId} status="${u.status}" disagrees with lease ${l.leaseId} renewal_status="${l.renewalStatus}"`,
              severity: 'hard_integrity_error',
              joinKey: u.unitId,
              leftStalk: 'units',
              rightStalk: 'leases',
              leftProjection: u.status,
              rightProjection: l.renewalStatus,
              residualMagnitude: 1,
              blocking: true,
              citations: [u.citationId, l.citationId],
            });
          }
        }
      }
      return out;
    },
  },
  {
    edgeId: 'E3_UNITS_TO_LEASES_RENT_FIBER',
    description:
      'Notice units market_rent vs contract monthly_rent fiber gap ($1,955/mo across portfolio; $370/mo at P06 on T12)',
    leftStalk: 'units',
    rightStalk: 'leases',
    severity: 'metric_fiber_divergence',
    blocking: false,
    evaluateEdge: (store) => {
      const unitById = new Map(store.units.map((u) => [u.unitId, u]));
      const byProp = new Map<
        string,
        { market: number; contract: number; cits: CitationId[] }
      >();
      for (const l of store.leases) {
        if (l.renewalStatus !== 'notice_given') continue;
        const u = unitById.get(l.unitId);
        if (!u) continue;
        const entry = byProp.get(l.propertyId) ?? {
          market: 0,
          contract: 0,
          cits: [`properties:${l.propertyId}` as CitationId],
        };
        entry.market += u.marketRent;
        entry.contract += l.monthlyRent;
        if (entry.cits.length < 5) {
          entry.cits.push(u.citationId, l.citationId);
        }
        byProp.set(l.propertyId, entry);
      }
      const out: CoboundaryResidual<number, number>[] = [];
      for (const [propId, entry] of byProp.entries()) {
        const diff = Math.abs(entry.market - entry.contract);
        if (diff > 0) {
          out.push({
            edgeId: 'E3_UNITS_TO_LEASES_RENT_FIBER',
            description: `Property ${propId} notice units market_rent ($${entry.market}) != contract lease monthly_rent ($${entry.contract}); residual $${diff}/mo`,
            severity: 'metric_fiber_divergence',
            joinKey: propId,
            leftStalk: 'units',
            rightStalk: 'leases',
            leftProjection: entry.market,
            rightProjection: entry.contract,
            residualMagnitude: diff,
            blocking: false,
            citations: entry.cits,
          });
        }
      }
      return out;
    },
  },
  {
    edgeId: 'E4_LEADS_TO_LEASES_PULLBACK',
    description:
      'CRM lead -> PMS lease pullback: FK existence, property_id agreement, earliest-lead quotient (9 duplicates D01490..D01498), funnel monotonicity, and 20 Q2->Q3 boundary shifts',
    leftStalk: 'leads',
    rightStalk: 'leases',
    severity: 'quarantine_row',
    blocking: false,
    evaluateEdge: (store) => {
      const leaseById = new Map(store.leases.map((l) => [l.leaseId, l]));
      const out: CoboundaryResidual[] = [];
      for (const ld of store.leads) {
        if (ld.applied && !ld.toured) {
          out.push({
            edgeId: 'E4_LEADS_TO_LEASES_PULLBACK',
            description: `Lead ${ld.leadId} violates funnel monotonicity (applied=true, toured=false)`,
            severity: 'hard_integrity_error',
            joinKey: ld.leadId,
            leftStalk: 'leads',
            rightStalk: 'leads',
            leftProjection: { toured: ld.toured, applied: ld.applied },
            rightProjection: { toured: true, applied: true },
            residualMagnitude: 1,
            blocking: true,
            citations: [ld.citationId],
          });
        }
        if (ld.isDuplicateForLease && ld.leaseId) {
          out.push({
            edgeId: 'E4_LEADS_TO_LEASES_PULLBACK',
            description: `Duplicate CRM lead ${ld.leadId} shares lease ${ld.leaseId} with earliest lead ${ld.duplicateOfLeadId}`,
            severity: 'quarantine_row',
            joinKey: ld.leaseId,
            leftStalk: 'leads',
            rightStalk: 'leases',
            leftProjection: ld.leadId,
            rightProjection: ld.duplicateOfLeadId,
            residualMagnitude: 1,
            blocking: !store.policy.deduplicateLeads,
            citations: [ld.citationId, `leases:${ld.leaseId}` as CitationId],
          });
        }
        if (ld.leaseId) {
          const ls = leaseById.get(ld.leaseId);
          if (
            !ls ||
            ls.propertyId !== ld.propertyId ||
            ld.createdDate > ls.startDate
          ) {
            out.push({
              edgeId: 'E4_LEADS_TO_LEASES_PULLBACK',
              description: `Lead ${ld.leadId} -> Lease ${ld.leaseId} pullback mismatch`,
              severity: 'hard_integrity_error',
              joinKey: ld.leaseId,
              leftStalk: 'leads',
              rightStalk: 'leases',
              leftProjection: { prop: ld.propertyId, created: ld.createdDate },
              rightProjection: ls
                ? { prop: ls.propertyId, start: ls.startDate }
                : null,
              residualMagnitude: 1,
              blocking: true,
              citations: [ld.citationId, ...(ls ? [ls.citationId] : [])],
            });
          } else if (
            ld.createdMonth !== ls.startMonth &&
            !ld.isDuplicateForLease
          ) {
            out.push({
              edgeId: 'E4_LEADS_TO_LEASES_PULLBACK',
              description: `Cross-month attribution shift on ${ld.leaseId}: lead created ${ld.createdMonth} vs lease start ${ls.startMonth}`,
              severity: 'temporal_boundary_shift',
              joinKey: ld.leaseId,
              leftStalk: 'leads',
              rightStalk: 'leases',
              leftProjection: ld.createdMonth,
              rightProjection: ls.startMonth,
              residualMagnitude: 1,
              blocking: store.policy.leaseBucketBy !== 'lease_start_date',
              citations: [ld.citationId, ls.citationId],
            });
          }
        }
      }
      return out;
    },
  },
  {
    edgeId: 'E5_SPEND_TO_LEASES_SUPPORT',
    description:
      'Spend gauge normalization (10 void rows + 13 CAD rows) and 9 zero-lease dead-spend pairs ($46,599.90)',
    leftStalk: 'spend',
    rightStalk: 'leases',
    severity: 'metric_fiber_divergence',
    blocking: false,
    evaluateEdge: (store) => {
      const spendByPair = new Map<
        string,
        { usd: number; cits: CitationId[] }
      >();
      for (const s of store.postedSpend) {
        const key = `${s.propertyId}::${s.source}`;
        const cur = spendByPair.get(key) ?? {
          usd: 0,
          cits: [`properties:${s.propertyId}` as CitationId],
        };
        cur.usd = roundTo(cur.usd + s.effectiveUsd, 2);
        if (cur.cits.length < 4) cur.cits.push(s.citationId);
        spendByPair.set(key, cur);
      }
      const leasesByPair = new Map<string, number>();
      for (const sl of store.signedLeases) {
        const key = `${sl.propertyId}::${sl.source}`;
        leasesByPair.set(key, (leasesByPair.get(key) ?? 0) + 1);
      }
      const out: CoboundaryResidual[] = [];
      for (const [key, val] of spendByPair.entries()) {
        const leases = leasesByPair.get(key) ?? 0;
        if (val.usd > 0 && leases === 0) {
          out.push({
            edgeId: 'E5_SPEND_TO_LEASES_SUPPORT',
            description: `Dead-spend support residual on ${key}: $${val.usd.toFixed(2)} posted USD with 0 signed leases`,
            severity: 'metric_fiber_divergence',
            joinKey: key,
            leftStalk: 'spend',
            rightStalk: 'leases',
            leftProjection: val.usd,
            rightProjection: 0,
            residualMagnitude: val.usd,
            blocking: false,
            citations: val.cits,
          });
        }
      }
      return out;
    },
  },
  {
    edgeId: 'E6_DECISIONS_TO_SPEND_STEP',
    description:
      'Decision step-change coboundary on accepted decisions (decisions.delta_usd vs spend(m) - spend(m-1))',
    leftStalk: 'decisions',
    rightStalk: 'spend',
    severity: 'metric_fiber_divergence',
    blocking: false,
    evaluateEdge: (store) => {
      const spendByPropSourceMonth = new Map<
        string,
        { usd: number; cit: CitationId }
      >();
      for (const s of store.postedSpend) {
        const key = `${s.propertyId}::${s.source}::${s.month}`;
        spendByPropSourceMonth.set(key, {
          usd: s.effectiveUsd,
          cit: s.citationId,
        });
      }
      const prevMonthMap: Record<string, string> = {
        '2026-05': '2026-04',
        '2026-06': '2026-05',
        '2026-07': '2026-06',
        '2026-08': '2026-07',
        '2026-09': '2026-08',
      };
      const out: CoboundaryResidual<number, number>[] = [];
      for (const d of store.decisions) {
        if (!d.accepted) continue;
        const prevM = prevMonthMap[d.month];
        if (!prevM) continue;
        const prev = spendByPropSourceMonth.get(
          `${d.propertyId}::${d.source}::${prevM}`,
        );
        const curr = spendByPropSourceMonth.get(
          `${d.propertyId}::${d.source}::${d.month}`,
        );
        if (!prev || !curr) continue;
        const actualDelta = roundTo(curr.usd - prev.usd, 2);
        const diff = roundTo(Math.abs(actualDelta - d.deltaUsd), 2);
        if (diff > 0.01) {
          out.push({
            edgeId: 'E6_DECISIONS_TO_SPEND_STEP',
            description: `Accepted decision ${d.decisionId} (${d.propertyId} ${d.source} ${d.month}) recommended delta=$${d.deltaUsd}, actual invoice step=${prevM} ($${prev.usd}) -> ${d.month} ($${curr.usd}) = $${actualDelta} (residual $${diff})`,
            severity: 'metric_fiber_divergence',
            joinKey: d.decisionId,
            leftStalk: 'decisions',
            rightStalk: 'spend',
            leftProjection: d.deltaUsd,
            rightProjection: actualDelta,
            residualMagnitude: diff,
            blocking: false,
            citations: [d.citationId, prev.cit, curr.cit],
          });
        }
      }
      return out;
    },
  },
];

// ============================================================================
// Generic Schema-Driven Cellular Sheaf & Allocation Engine (Domain-Agnostic)
// ============================================================================

export type GenericRelationalTables = Readonly<
  Record<string, ReadonlyArray<Readonly<Record<string, unknown>>>>
>;

export interface QuarantinedRecordSummary {
  readonly stalk: string;
  readonly primaryKey: string;
  readonly ruleId: string;
  readonly kind: QuarantineKind;
  readonly reason: string;
  readonly citation: string;
}

export interface GenericRestrictionResidual {
  readonly restrictionId: string;
  readonly kind: RestrictionKind;
  readonly sourceStalk: string;
  readonly targetStalk: string;
  readonly primaryKey: string;
  readonly foreignKey: string;
  readonly residualNorm: number;
  readonly detail: string;
  readonly citations: readonly string[];
}

export interface GenericSheafConsistencyReport {
  readonly schemaId: string;
  readonly domainName: string;
  readonly totalRowsScanned: number;
  readonly elapsedMs: number;
  readonly throughputRowsPerSec: number;
  readonly activeCountsByStalk: Readonly<Record<string, number>>;
  readonly quarantinedCountsByStalk: Readonly<Record<string, number>>;
  readonly quarantinedRecords: readonly QuarantinedRecordSummary[];
  readonly restrictionResiduals: readonly GenericRestrictionResidual[];
  readonly maxCoboundaryNorm: number;
  readonly isConsistentAfterQuarantine: boolean;
}

/**
 * Converts the FLOW `PortfolioStore` into generic relational tables over the 6 CSV stalks
 * (`properties`, `units`, `leases`, `leads`, `spend`, `decisions` — 3,858 rows total).
 */
export function portfolioStoreToGenericTables(
  store: PortfolioStore,
): GenericRelationalTables {
  const injectionSet = new Set(
    store.promptInjectionAttempts.map((p) => p.leadId),
  );
  const signedByLeaseId = new Map(
    store.signedLeases.map((s) => [s.leaseId, s]),
  );
  return {
    properties: store.properties.map((p) => ({
      property_id: p.propertyId,
      name: p.name,
      pms: p.pms,
      units: p.declaredUnits,
      actual_units: p.actualUnitCount,
      is_operating: p.isOperating,
    })),
    units: store.units.map((u) => ({
      unit_id: u.unitId,
      property_id: u.propertyId,
      bedrooms: u.bedrooms,
      market_rent: u.marketRent,
      status: u.status,
    })),
    leases: store.leases.map((l) => {
      const sl = signedByLeaseId.get(l.leaseId);
      return {
        lease_id: l.leaseId,
        unit_id: l.unitId,
        property_id: l.propertyId,
        source: sl?.source ?? '',
        signed_count: sl ? 1 : 0,
        start_date: l.startDate,
        end_date: l.endDate,
        monthly_rent: l.monthlyRent,
        concession_usd: l.concessionUsd,
        renewal_status: l.renewalStatus,
      };
    }),
    leads: store.leads.map((ld) => ({
      lead_id: ld.leadId,
      property_id: ld.propertyId,
      created_date: ld.createdDate,
      source: ld.source,
      toured: ld.toured,
      applied: ld.applied,
      leased: ld.leased,
      lease_id: ld.leaseId ?? '',
      is_duplicate_for_lease: ld.isDuplicateForLease,
      duplicate_of_lead_id: ld.duplicateOfLeadId ?? '',
      is_prompt_injection: injectionSet.has(ld.leadId),
    })),
    spend: store.spend.map((s) => ({
      spend_id: s.spendId,
      month: s.month,
      property_id: s.propertyId,
      source: s.source,
      raw_amount: s.rawAmount,
      currency: s.currency,
      status: s.status,
      is_void: s.isVoid,
      effective_usd: s.effectiveUsd,
    })),
    decisions: store.decisions.map((d) => ({
      decision_id: d.decisionId,
      month: d.month,
      property_id: d.propertyId,
      source: d.source,
      recommendation: d.recommendation,
      delta_usd: d.deltaUsd,
      accepted: d.accepted,
      decided_by: d.decidedBy,
    })),
  };
}

/**
 * Evaluates any `RelationalSheafSchema` in O(N) time and O(N) memory using single-pass
 * Map indices (zero nested scans).
 */
export function verifySheafConsistency(
  schema: RelationalSheafSchema = FLOW_PORTFOLIO_SCHEMA,
  tables: GenericRelationalTables,
): GenericSheafConsistencyReport {
  const t0 = performance.now();
  const activeCountsByStalk: Record<string, number> = {};
  const quarantinedCountsByStalk: Record<string, number> = {};
  const quarantinedRecords: QuarantinedRecordSummary[] = [];
  const activeIndexByStalk = new Map<
    string,
    Map<string, Readonly<Record<string, unknown>>>
  >();
  const allIndexByStalk = new Map<
    string,
    Map<string, Readonly<Record<string, unknown>>>
  >();

  let totalRowsScanned = 0;

  // 1. Evaluate 0-cell Quarantine Functors Q_v in a single O(N) pass per stalk
  for (const stalk of schema.stalks) {
    const rows = tables[stalk.name] ?? [];
    totalRowsScanned += rows.length;
    const seenKeys = new Set<string>();
    const activeMap = new Map<string, Readonly<Record<string, unknown>>>();
    const allMap = new Map<string, Readonly<Record<string, unknown>>>();
    let qCount = 0;

    for (const row of rows) {
      const pk = String(row[stalk.primaryKey] ?? '');
      allMap.set(pk, row);
      let isQuarantined = false;

      for (const rule of stalk.quarantineRules) {
        const res = rule.check(row, { asOfDate: schema.asOfDate, seenKeys });
        if (res.quarantined) {
          isQuarantined = true;
          qCount += 1;
          quarantinedRecords.push({
            stalk: stalk.name,
            primaryKey: pk,
            ruleId: rule.id,
            kind: rule.kind,
            reason: res.reason ?? rule.description,
            citation: `${stalk.name}:${pk}`,
          });
        }
      }

      if (!isQuarantined) {
        activeMap.set(pk, row);
      }
    }

    activeCountsByStalk[stalk.name] = activeMap.size;
    quarantinedCountsByStalk[stalk.name] = qCount;
    activeIndexByStalk.set(stalk.name, activeMap);
    allIndexByStalk.set(stalk.name, allMap);
  }

  // 2. Evaluate 1-cell Restriction Maps rho_{v->e} in a single O(N) hash-join pass
  const restrictionResiduals: GenericRestrictionResidual[] = [];
  let maxCoboundaryNorm = 0;

  for (const r of schema.restrictions) {
    const sourceRows = tables[r.sourceStalk] ?? [];
    const sourcePkField =
      schema.stalks.find((s) => s.name === r.sourceStalk)?.primaryKey ?? 'id';
    const targetActive = activeIndexByStalk.get(r.targetStalk) ?? new Map();
    const targetAll = allIndexByStalk.get(r.targetStalk) ?? new Map();

    if (r.kind === 'referential_support') {
      for (const [tPk, tRow] of targetAll.entries()) {
        if (!targetActive.has(tPk)) {
          restrictionResiduals.push({
            restrictionId: r.id,
            kind: r.kind,
            sourceStalk: r.sourceStalk,
            targetStalk: r.targetStalk,
            primaryKey: tPk,
            foreignKey: tPk,
            residualNorm: 1,
            detail: `Quarantined parent entity ${r.targetStalk}:${tPk} excluded from active support`,
            citations: [`${r.targetStalk}:${tPk}`],
          });
          maxCoboundaryNorm = Math.max(maxCoboundaryNorm, 1);
        }
        void tRow;
      }
      for (const row of sourceRows) {
        const sPk = String(row[sourcePkField] ?? '');
        const fk = String(row[r.foreignKey] ?? '');
        if (fk && !targetActive.has(fk)) {
          restrictionResiduals.push({
            restrictionId: r.id,
            kind: r.kind,
            sourceStalk: r.sourceStalk,
            targetStalk: r.targetStalk,
            primaryKey: sPk,
            foreignKey: fk,
            residualNorm: 1,
            detail: `${r.sourceStalk}:${sPk} references inactive/quarantined ${r.targetStalk}:${fk}`,
            citations: [`${r.sourceStalk}:${sPk}`, `${r.targetStalk}:${fk}`],
          });
          maxCoboundaryNorm = Math.max(maxCoboundaryNorm, 1);
        }
      }
    } else if (r.kind === 'conservation_law') {
      const amountField = String(r.params.amountField ?? 'monthly_rent');
      const baselineField = String(r.params.baselineField ?? 'market_rent');
      for (const row of sourceRows) {
        const sPk = String(row[sourcePkField] ?? '');
        const fk = String(row[r.foreignKey] ?? '');
        const targetRow = targetActive.get(fk);
        if (!targetRow) continue;
        if (
          r.sourceStalk === 'leases' &&
          String(row.renewal_status ?? '') !== 'notice_given'
        ) {
          continue;
        }
        const aVal = Number(row[amountField] ?? 0);
        const bVal = Number(targetRow[baselineField] ?? aVal);
        const diff = roundTo(Math.abs(aVal - bVal), 2);
        if (diff > r.tolerance) {
          restrictionResiduals.push({
            restrictionId: r.id,
            kind: r.kind,
            sourceStalk: r.sourceStalk,
            targetStalk: r.targetStalk,
            primaryKey: sPk,
            foreignKey: fk,
            residualNorm: diff,
            detail: `Conservation fiber gap on ${r.sourceStalk}:${sPk} -> ${r.targetStalk}:${fk}: ${amountField}=${aVal} vs ${baselineField}=${bVal} (||delta_s||=${diff})`,
            citations: [`${r.sourceStalk}:${sPk}`, `${r.targetStalk}:${fk}`],
          });
          maxCoboundaryNorm = Math.max(maxCoboundaryNorm, diff);
        }
      }
    } else if (r.kind === 'temporal_monotonicity') {
      const earlierField = String(r.params.earlierField ?? 'created_date');
      const laterField = String(r.params.laterField ?? 'start_date');
      for (const row of sourceRows) {
        const sPk = String(row[sourcePkField] ?? '');
        const fk = String(row[r.foreignKey] ?? '');
        if (!fk) continue;
        const targetRow = targetActive.get(fk);
        if (!targetRow) continue;
        const tEarlier = String(row[earlierField] ?? '');
        const tLater = String(targetRow[laterField] ?? '');
        if (tEarlier && tLater && tEarlier > tLater) {
          restrictionResiduals.push({
            restrictionId: r.id,
            kind: r.kind,
            sourceStalk: r.sourceStalk,
            targetStalk: r.targetStalk,
            primaryKey: sPk,
            foreignKey: fk,
            residualNorm: 1,
            detail: `Temporal monotonicity violation on ${r.sourceStalk}:${sPk} -> ${r.targetStalk}:${fk}: ${earlierField}=${tEarlier} > ${laterField}=${tLater}`,
            citations: [`${r.sourceStalk}:${sPk}`, `${r.targetStalk}:${fk}`],
          });
          maxCoboundaryNorm = Math.max(maxCoboundaryNorm, 1);
        } else if (
          tEarlier.slice(0, 7) !== tLater.slice(0, 7) &&
          row.is_duplicate_for_lease !== true
        ) {
          restrictionResiduals.push({
            restrictionId: r.id,
            kind: r.kind,
            sourceStalk: r.sourceStalk,
            targetStalk: r.targetStalk,
            primaryKey: sPk,
            foreignKey: fk,
            residualNorm: 0.5,
            detail: `Cross-month attribution shift on ${r.sourceStalk}:${sPk} -> ${r.targetStalk}:${fk}: ${tEarlier.slice(0, 7)} vs ${tLater.slice(0, 7)}`,
            citations: [`${r.sourceStalk}:${sPk}`, `${r.targetStalk}:${fk}`],
          });
          maxCoboundaryNorm = Math.max(maxCoboundaryNorm, 0.5);
        }
      }
    } else if (r.kind === 'state_duration_consistency') {
      const startField = String(r.params.startField ?? 'start_date');
      const endField = String(r.params.endField ?? 'end_date');
      for (const row of sourceRows) {
        const sPk = String(row[sourcePkField] ?? '');
        const fk = String(row[r.foreignKey] ?? '');
        const targetRow = targetActive.get(fk);
        if (!targetRow) continue;
        const sDate = String(row[startField] ?? '');
        const eDate = String(row[endField] ?? '');
        if (sDate && eDate && sDate > eDate) {
          restrictionResiduals.push({
            restrictionId: r.id,
            kind: r.kind,
            sourceStalk: r.sourceStalk,
            targetStalk: r.targetStalk,
            primaryKey: sPk,
            foreignKey: fk,
            residualNorm: 1,
            detail: `Invalid interval on ${r.sourceStalk}:${sPk}: ${sDate} > ${eDate}`,
            citations: [`${r.sourceStalk}:${sPk}`],
          });
          maxCoboundaryNorm = Math.max(maxCoboundaryNorm, 1);
        }
        if (
          r.sourceStalk === 'leases' &&
          r.targetStalk === 'units' &&
          (String(targetRow.status ?? '') === 'notice') !==
            (String(row.renewal_status ?? '') === 'notice_given')
        ) {
          restrictionResiduals.push({
            restrictionId: r.id,
            kind: r.kind,
            sourceStalk: r.sourceStalk,
            targetStalk: r.targetStalk,
            primaryKey: sPk,
            foreignKey: fk,
            residualNorm: 1,
            detail: `State mismatch: unit ${fk} status=${String(targetRow.status)} vs lease ${sPk} renewal_status=${String(row.renewal_status)}`,
            citations: [`${r.sourceStalk}:${sPk}`, `${r.targetStalk}:${fk}`],
          });
          maxCoboundaryNorm = Math.max(maxCoboundaryNorm, 1);
        }
      }
    }
  }

  const elapsedMs = Math.max(0.05, roundTo(performance.now() - t0, 3));
  const throughputRowsPerSec = Math.round((totalRowsScanned / elapsedMs) * 1000);

  return {
    schemaId: schema.schemaId,
    domainName: schema.domainName,
    totalRowsScanned,
    elapsedMs,
    throughputRowsPerSec,
    activeCountsByStalk,
    quarantinedCountsByStalk,
    quarantinedRecords,
    restrictionResiduals,
    maxCoboundaryNorm,
    isConsistentAfterQuarantine: restrictionResiduals.every(
      (res) => res.kind !== 'temporal_monotonicity' || res.residualNorm < 1,
    ),
  };
}

export interface GenericAllocationSummary {
  readonly deadPairs: ReadonlyArray<readonly [string, string]>;
  readonly totalDeadSpendUsd: number;
  readonly bestChannel: string;
  readonly bestChannelCpslUsd: number;
  readonly projectedAdditionalOutcomes: number;
  readonly posteriorByEntityChannel: ReadonlyArray<{
    readonly entityId: string;
    readonly channel: string;
    readonly spendUsd: number;
    readonly outcomes: number;
    readonly posteriorCostPerOutcome: number;
  }>;
}

/**
 * Runs dead-spend reallocation and conjugate Gamma-Poisson shrinkage over any
 * `RelationalSheafSchema` (Flow Real Estate OR B2B SaaS FinOps) without changing
 * a single line of engine code.
 */
export function evaluateGenericAllocationAndLearner(
  schema: RelationalSheafSchema,
  tables: GenericRelationalTables,
): GenericAllocationSummary {
  const consistency = verifySheafConsistency(schema, tables);
  const spec = schema.allocation;

  const quarantinedEntityPks = new Set(
    consistency.quarantinedRecords
      .filter((q) => q.stalk === spec.entityStalk)
      .map((q) => q.primaryKey),
  );
  const quarantinedSpendPks = new Set(
    consistency.quarantinedRecords
      .filter((q) => q.stalk === spec.spendStalk)
      .map((q) => q.primaryKey),
  );

  const spendPkField =
    schema.stalks.find((s) => s.name === spec.spendStalk)?.primaryKey ?? 'id';

  const spendByPair = new Map<string, number>();
  const spendByChannel = new Map<string, number>();
  const paidChannels = new Set<string>();

  for (const row of tables[spec.spendStalk] ?? []) {
    const pk = String(row[spendPkField] ?? '');
    if (quarantinedSpendPks.has(pk)) continue;
    const entityId = String(row[spec.spendEntityFk] ?? '');
    if (quarantinedEntityPks.has(entityId)) continue;
    const channel = String(row[spec.spendChannelField] ?? '');
    const amt = Number(row[spec.spendAmountField] ?? 0);
    if (amt <= 0) continue;
    paidChannels.add(channel);
    const key = `${entityId}::${channel}`;
    spendByPair.set(key, roundTo((spendByPair.get(key) ?? 0) + amt, 2));
    spendByChannel.set(channel, roundTo((spendByChannel.get(channel) ?? 0) + amt, 2));
  }

  const outcomesByPair = new Map<string, number>();
  const outcomesByChannel = new Map<string, number>();

  for (const row of tables[spec.outcomeStalk] ?? []) {
    const entityId = String(row[spec.outcomeEntityFk] ?? '');
    if (quarantinedEntityPks.has(entityId)) continue;
    const channel = String(row[spec.outcomeChannelField] ?? '');
    if (!channel || !paidChannels.has(channel)) continue;
    const cnt = Number(row[spec.outcomeCountField] ?? 0);
    if (cnt <= 0) continue;
    const key = `${entityId}::${channel}`;
    outcomesByPair.set(key, (outcomesByPair.get(key) ?? 0) + cnt);
    outcomesByChannel.set(channel, (outcomesByChannel.get(channel) ?? 0) + cnt);
  }

  const deadPairs: Array<readonly [string, string]> = [];
  let totalDeadSpendUsd = 0;

  for (const [key, spend] of [...spendByPair.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const outcomes = outcomesByPair.get(key) ?? 0;
    if (spend > 0 && outcomes === 0) {
      const [entityId, channel] = key.split('::');
      deadPairs.push([entityId, channel] as const);
      totalDeadSpendUsd = roundTo(totalDeadSpendUsd + spend, 2);
    }
  }

  let bestChannel = '';
  let bestExactCpo = Number.POSITIVE_INFINITY;

  for (const channel of paidChannels) {
    const spend = spendByChannel.get(channel) ?? 0;
    const outcomes = outcomesByChannel.get(channel) ?? 0;
    if (outcomes > 0) {
      const cpo = spend / outcomes;
      if (cpo < bestExactCpo) {
        bestExactCpo = cpo;
        bestChannel = channel;
      }
    }
  }

  const projectedAdditionalOutcomes =
    Number.isFinite(bestExactCpo) && bestExactCpo > 0
      ? Math.floor(totalDeadSpendUsd / bestExactCpo)
      : 0;

  const posteriorByEntityChannel = [...spendByPair.entries()].map(
    ([key, spendUsd]) => {
      const [entityId, channel] = key.split('::');
      const outcomes = outcomesByPair.get(key) ?? 0;
      const posteriorCostPerOutcome = roundTo(
        (spendUsd + spec.priorBeta0) / (outcomes + spec.priorAlpha0),
        2,
      );
      return {
        entityId,
        channel,
        spendUsd,
        outcomes,
        posteriorCostPerOutcome,
      };
    },
  );

  return {
    deadPairs,
    totalDeadSpendUsd,
    bestChannel,
    bestChannelCpslUsd: Number.isFinite(bestExactCpo)
      ? roundTo(bestExactCpo, 2)
      : 0,
    projectedAdditionalOutcomes,
    posteriorByEntityChannel,
  };
}
