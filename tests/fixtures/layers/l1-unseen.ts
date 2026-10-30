// L1 unseen probes, written after the coverage rules and never tuned against.
import type { L1Case } from './l1-cases.ts';
import type { PortfolioStore, UnitRecord } from '../../../src/data/schema.ts';
const units = (pid: string, f: (u: UnitRecord) => boolean = () => true) => (s: PortfolioStore) =>
  s.units.filter((u) => u.propertyId === pid && f(u)).length;
export const L1_UNSEEN: readonly L1Case[] = [
  { q: 'How many apartments are occupied at Kedzie Works right now?', oracle: units('P06', (u) => u.status === 'occupied'), unknownOk: true },
  { q: 'Count the occupied homes at Fulton Yards.', oracle: units('P03', (u) => u.status === 'occupied'), unknownOk: true },
  { q: 'How many Kedzie Works units sit empty?', oracle: units('P06', (u) => u.status === 'vacant'), unknownOk: true },
  { q: 'How many units at Kedzie Works lack a view?', oracle: units('P06', (u) => u.view === 'none'), unknownOk: true },
  { q: 'How many park-view or city-view units at Kedzie Works?', oracle: units('P06', (u) => u.view === 'park' || u.view === 'city'), unknownOk: true },
  { q: 'How many units at Kedzie Works are vacant and on notice?', oracle: null, unknownOk: true },
  { q: 'How many units at Kedzie Works face the lake?', oracle: units('P06', (u) => u.view === 'lake'), unknownOk: true },
  { q: 'How many units at Kedzie Works are furnished?', oracle: null },
  { q: 'How many corner units at Kedzie Works?', oracle: null },
  { q: 'What is the typical lease rent at Kedzie Works?', oracle: null, unknownOk: true },
  { q: 'How many units at Kedzie Works are unavailable?', oracle: null, unknownOk: true },
  { q: 'How many 1-bedroom units at Kedzie Works are taken?', oracle: null, unknownOk: true },
];
