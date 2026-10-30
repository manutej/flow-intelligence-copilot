import type { PortfolioStore, UnitStatus } from './schema.ts';

/** A lease rent this far from its unit's market rent is a data error, not a deal. */
export const RENT_TO_MARKET_MAX_RATIO = 3;
export const UNIT_STATUSES: ReadonlySet<UnitStatus> = new Set<UnitStatus>(['occupied', 'notice', 'vacant']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface RowFactViolation {
  readonly table: string;
  readonly target: string;
  readonly key: string;
  readonly description: string;
  readonly citations: readonly string[];
  readonly left: unknown;
  readonly right: unknown;
}

/**
 * The per-row facts every answer assumes, in one place. The loader refuses
 * a store that breaks any of them (exit 10), and the sheaf's E0 edge reports
 * the same list for a store built or changed in memory.
 */
export function rowFactViolations(store: Pick<PortfolioStore, 'units' | 'leases'>): RowFactViolation[] {
  const out: RowFactViolation[] = [];
  const unitById = new Map(store.units.map((u) => [u.unitId, u]));
  for (const u of store.units) {
    if (!UNIT_STATUSES.has(u.status)) out.push({ table: 'units', target: 'units', key: u.unitId, description: `${u.citationId} has status ${JSON.stringify(u.status)}; a unit is occupied, notice or vacant`, citations: [u.citationId], left: u.status, right: [...UNIT_STATUSES] });
    if (!Number.isInteger(u.sqft) || u.sqft <= 0) out.push({ table: 'units', target: 'units', key: u.unitId, description: `${u.citationId} has sqft ${u.sqft}; a unit's size is a positive whole number`, citations: [u.citationId], left: u.sqft, right: 0 });
  }
  for (const l of store.leases) {
    if (!ISO_DATE.test(l.startDate) || !ISO_DATE.test(l.endDate) || Number.isNaN(Date.parse(l.startDate)) || Number.isNaN(Date.parse(l.endDate))) {
      out.push({ table: 'leases', target: 'leases', key: l.leaseId, description: `${l.citationId} has dates ${l.startDate} to ${l.endDate}; both must be YYYY-MM-DD`, citations: [l.citationId], left: l.startDate, right: l.endDate });
    } else if (l.endDate < l.startDate) {
      out.push({ table: 'leases', target: 'leases', key: l.leaseId, description: `${l.citationId} ends ${l.endDate}, before it starts ${l.startDate}`, citations: [l.citationId], left: l.startDate, right: l.endDate });
    }
    const u = unitById.get(l.unitId);
    if (u && u.propertyId === l.propertyId && (!(l.monthlyRent >= 0) || !(u.marketRent > 0) || l.monthlyRent / u.marketRent > RENT_TO_MARKET_MAX_RATIO || u.marketRent / Math.max(l.monthlyRent, 1e-9) > RENT_TO_MARKET_MAX_RATIO)) {
      out.push({ table: 'leases', target: 'units', key: l.unitId, description: `${l.citationId} rent ${l.monthlyRent} is implausible against market ${u.marketRent}`, citations: [l.citationId, u.citationId], left: l.monthlyRent, right: u.marketRent });
    }
  }
  return out;
}
