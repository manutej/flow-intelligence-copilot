// L1 query-intent cases (Round-3 FX2c probes, F-040). Each case names the
// typed query it should map to as an oracle over the store, or null when the
// grammar cannot express it and the only right outcome is "I don't know".
// `unknownOk` marks questions where a conservative "I don't know" is fine.
import type { PortfolioStore, UnitRecord } from '../../../src/data/schema.ts';

type Oracle = ((s: PortfolioStore) => number) | null;
export interface L1Case { readonly q: string; readonly oracle: Oracle; readonly unknownOk?: boolean }

const units = (pid: string, f: (u: UnitRecord) => boolean = () => true) => (s: PortfolioStore) =>
  s.units.filter((u) => u.propertyId === pid && f(u)).length;
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const K = 'P06';
const F = 'P03';

export const L1_CASES: readonly L1Case[] = [
  // Known-goods that must keep their answers.
  { q: 'How many units are vacant at Kedzie Works?', oracle: units(K, (u) => u.status === 'vacant') },
  { q: 'How many studios are at Kedzie Works?', oracle: units(K, (u) => u.bedrooms === 0) },
  { q: 'How many units at Kedzie Works have at least 2 bathrooms?', oracle: units(K, (u) => u.bathrooms >= 2) },
  { q: 'What is the average sq ft of units at Kedzie Works?', oracle: (s) => avg(s.units.filter((u) => u.propertyId === K).map((u) => u.sqft)) },
  { q: 'How many units at Kedzie Works have a lake view?', oracle: units(K, (u) => u.view === 'lake') },
  { q: 'How many units at Kedzie Works have a city view?', oracle: units(K, (u) => u.view === 'city') },
  { q: 'How many occupied units are at Kedzie Works?', oracle: units(K, (u) => u.status === 'occupied') },
  { q: 'How many units at Kedzie Works with view none?', oracle: units(K, (u) => u.view === 'none') },
  { q: 'How many units at Kedzie Works are on notice?', oracle: units(K, (u) => u.status === 'notice') },
  { q: 'How many units at Kedzie Works are on floor 2?', oracle: units(K, (u) => u.floor === 2) },
  { q: 'How many units in Fulton Market are vacant?', oracle: units(F, (u) => u.status === 'vacant') },
  { q: 'How many homes at Kedzie Works are vacant?', oracle: units(K, (u) => u.status === 'vacant') },
  { q: 'Kedzie Works: vacant units count please', oracle: units(K, (u) => u.status === 'vacant') },
  { q: 'How many vacant 2-bedroom units with a city view at Kedzie Works?', oracle: units(K, (u) => u.status === 'vacant' && u.bedrooms === 2 && u.view === 'city') },
  // F-040: understood words that were not turned into a filter.
  { q: 'How many units at Kedzie Works are currently occupied?', oracle: units(K, (u) => u.status === 'occupied'), unknownOk: true },
  { q: 'How many units at Kedzie Works are occupied?', oracle: units(K, (u) => u.status === 'occupied'), unknownOk: true },
  { q: 'How many units at Fulton Yards are occupied?', oracle: units(F, (u) => u.status === 'occupied'), unknownOk: true },
  { q: 'How many units at Kedzie Works are available?', oracle: units(K, (u) => u.status === 'vacant'), unknownOk: true },
  { q: 'How many units at Kedzie Works have no view?', oracle: units(K, (u) => u.view === 'none'), unknownOk: true },
  { q: 'How many vacant units at Kedzie Works have no view?', oracle: units(K, (u) => u.status === 'vacant' && u.view === 'none'), unknownOk: true },
  { q: 'How many units at Kedzie Works are vacant or on notice?', oracle: units(K, (u) => u.status === 'vacant' || u.status === 'notice'), unknownOk: true },
  // F-040 sibling: a lease question answered with the market average.
  { q: 'Average lease rent at the Yards?', oracle: (s) => avg(s.leases.filter((l) => l.propertyId === F).map((l) => l.monthlyRent)), unknownOk: true },
  { q: "What's the mean monthly rent at FY?", oracle: null, unknownOk: true },
  // Outside the grammar: must say "I don't know".
  { q: 'How many units at Kedzie Works have a dishwasher?', oracle: null },
  { q: 'How many units at Kedzie Works allow dogs?', oracle: null },
  { q: 'How many units at Kedzie Works are leased?', oracle: null, unknownOk: true },
  { q: 'What is the most expensive unit at Kedzie Works?', oracle: null },
  { q: 'How many units at Kedzie Works are big?', oracle: null },
  { q: 'How many units at Kedzie Works are not vacant?', oracle: null, unknownOk: true },
  { q: 'How many units at Kedzie Works will be vacant next month?', oracle: null },
  { q: 'Roughly how many units at Kedzie Works are vacant?', oracle: null, unknownOk: true },
  { q: 'How many doors at Kedzie Works are vacant?', oracle: null, unknownOk: true },
];
