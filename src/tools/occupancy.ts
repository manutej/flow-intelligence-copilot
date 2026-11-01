/**
 * occupancy (FIQ-TOOLS-1 §2.5). Snapshot as of the units export date.
 * Rates use 004's rate kernel (ratePercent1: integer half-up, 1 dp).
 */
import type { PortfolioStore } from '../data/schema.ts';
import { ratePercent1 } from '../data/rate.ts';
import { periodLabel, type PeriodInput, type ToolEnvelope, unknownEnvelope } from './envelope.ts';
import { resolvePeriod } from './period-total.ts';

export const OCCUPANCY_DESCRIPTION =
  "Units, occupied share ((occupied+notice)/units), vacancy (vacant/units), and lease expirations by month, for a building or the portfolio. Use for occupancy, vacancy and 'leases ending in M'. Do NOT use for economic occupancy (Phase 2) or rent.";

export interface OccupancyArgs { readonly property_id?: string; readonly expirations_window?: PeriodInput; readonly bedrooms?: number }
export interface OccupancyValue {
  readonly units: number; readonly occupied: number; readonly notice: number; readonly vacant: number;
  readonly occupied_share_pct: number; readonly vacancy_pct: number;
  readonly expirations: Readonly<Record<string, number>>; readonly as_of: string;
}

export function occupancy(store: PortfolioStore, args: OccupancyArgs = {}): ToolEnvelope<OccupancyValue> {
  const operating = new Set(store.operatingProperties.map((p) => p.propertyId));
  if (args.property_id && !operating.has(args.property_id)) return unknownEnvelope(`${args.property_id} is not an operating building (no units)`);
  const units = store.units.filter((u) => operating.has(u.propertyId) && (!args.property_id || u.propertyId === args.property_id) && (args.bedrooms === undefined || u.bedrooms === args.bedrooms));
  if (units.length === 0) return unknownEnvelope('No units match');
  const n = (s: string) => units.filter((u) => u.status === s).length;
  const occupied = n('occupied'), notice = n('notice'), vacant = n('vacant');
  const unitIds = new Set(units.map((u) => u.unitId));
  const win = args.expirations_window ? resolvePeriod(args.expirations_window) : null;
  if (args.expirations_window && !win) return unknownEnvelope('Unrecognised expirations window');
  const ex: Record<string, number> = {};
  for (const l of store.leases) {
    if (!unitIds.has(l.unitId)) continue;
    if (win && (l.endDate < win.start || l.endDate > win.end)) continue;
    ex[l.endMonth] = (ex[l.endMonth] ?? 0) + 1;
  }
  const expirations = Object.fromEntries(Object.entries(ex).sort(([a], [b]) => a.localeCompare(b)));
  const asOf = store.policy.asOfDate;
  return {
    value: { units: units.length, occupied, notice, vacant, occupied_share_pct: ratePercent1(occupied + notice, units.length), vacancy_pct: ratePercent1(vacant, units.length), expirations, as_of: asOf },
    period: win ? { label: periodLabel(win.start, win.end), start: win.start, end: win.end, partial: win.partial, basis: 'leases.end_date (expirations); units.status as of ' + asOf } : { label: `as of ${asOf}`, start: asOf, end: asOf, partial: false, basis: 'units.status snapshot' },
    fx: null, dedup: null, unknown: false, unknown_reason: null,
    citations: units.slice(0, 8).map((u) => u.citationId),
  };
}
