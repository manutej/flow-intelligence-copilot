import type { AnswerEnvelope, PortfolioStore } from '../data/schema.ts';
import { resolvePropertiesFromText } from '../domain/resolver.ts';
import { parseQueryIntent, type ParsedQueryIntent } from './intent.ts';

/**
 * Clarify and restate (S1R-L1-5, L1-6). A question with content the typed
 * query does not bind is not answered; the user gets 2-4 typed readings to
 * choose from, each a question FlowIQ can run, and every reading is shown
 * as a plain-language restatement of the bound query, built from the
 * TypedQuery and the store, never from the question's own words.
 */
export interface ClarifyOption {
  readonly label: string;
  /** The question one click on this option runs. */
  readonly question: string;
}

const MEASURE_WORDS: Readonly<Record<string, string>> = {
  unit_count: 'the number of units',
  vacancy_rate: 'the vacancy rate',
  occupied_share: 'the occupied share',
  avg_market_rent: 'the average market rent',
  avg_sqft: 'the average size in sqft',
  avg_market_rent_and_sqft: 'the average market rent and size',
  rent_per_sqft: 'the average market rent per sqft',
};

function range(label: string, min?: number, max?: number, unit = ''): string | null {
  if (min === undefined && max === undefined) return null;
  if (min !== undefined && max !== undefined) return min === max ? `${label} = ${min}${unit}` : `${label} ${min}${unit} to ${max}${unit}`;
  return min !== undefined ? `${label} >= ${min}${unit}` : `${label} <= ${max}${unit}`;
}

/** "I computed: the number of vacant units, floor >= 5, at Kedzie Works (P06)." */
export function restate(intent: ParsedQueryIntent, question: string, store: PortfolioStore): string {
  const what = MEASURE_WORDS[intent.measure] ?? intent.measure.replace(/_/g, ' ');
  const filters = [
    intent.unitStatus && `status = ${intent.unitStatus}`,
    intent.bedrooms !== undefined && `bedrooms = ${intent.bedrooms}`,
    intent.bathrooms !== undefined && `bathrooms = ${intent.bathrooms}`,
    range('bedrooms', intent.bedroomsMin, intent.bedroomsMax),
    range('bathrooms', intent.bathroomsMin, intent.bathroomsMax),
    range('sqft', intent.sqftMin, intent.sqftMax),
    range('floor', intent.floorMin, intent.floorMax),
    range('market rent', intent.rentMin, intent.rentMax, ' USD'),
    intent.view && `view = ${intent.view}`,
    intent.buildingClass && `class ${intent.buildingClass}`,
  ].filter(Boolean);
  const named = resolvePropertiesFromText(store, question).matched;
  const scope = named.length > 0 ? named.map((p) => `${p.name} (${p.propertyId})`).join(', ') : 'all operating buildings';
  return `I computed: ${what}${filters.length ? `, ${filters.join(', ')}` : ''}, at ${scope}.`;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 2-4 typed readings of a question whose words `unbound` no field carries. */
export function clarifyOptions(question: string, unbound: readonly string[], store: PortfolioStore): ClarifyOption[] {
  const options: ClarifyOption[] = [];
  const quoted = unbound.map((w) => `"${w}"`).join(', ');
  let stripped = question;
  for (const w of unbound) stripped = stripped.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(w)}(?![\\p{L}\\p{N}])`, 'giu'), ' ');
  stripped = stripped.replace(/\s+/g, ' ').replace(/\s+([?.!,])/g, '$1').trim();
  const strippedIntent = parseQueryIntent(stripped, store);
  // A reading keeps a measure the question itself states (F-077): with the
  // unbound words removed, the question must still parse to a unit measure.
  // Otherwise there is no reading, because a unit count in place of, say, a
  // spend figure is a different question.
  if (strippedIntent.measure === 'unsupported' || strippedIntent.domain !== 'units') return [];
  const asked = strippedIntent;
  const named = resolvePropertiesFromText(store, question).matched;
  const building = named.length === 1 ? named[0] : undefined;
  const label = (i: ParsedQueryIntent, scope: string) => restate(i, scope, store).replace(/^I computed: /, '').replace(/\.$/, '');
  // Each option's question is rendered from the typed reading, never cut out
  // of the user's words, so it is always a whole question.
  const unfiltered: ParsedQueryIntent = { ...asked, ...Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])) } as ParsedQueryIntent;
  const readings: Array<[ParsedQueryIntent, boolean, string]> = [
    [strippedIntent, true, `Without ${quoted}: `],
    [strippedIntent, false, `Without ${quoted}, across the portfolio: `],
    [unfiltered, true, 'No filters: '],
  ];
  for (const [intent, here, prefix] of readings) {
    if (!here && building === undefined) continue;
    const q = canonicalQuestion(intent, here ? building?.name : undefined);
    if (q !== null) options.push({ label: `${prefix}${label(intent, here && building ? building.name : '')}`, question: q });
  }
  return options.slice(0, 4);
}

export function clarifyEnvelope(id: string, question: string, unbound: readonly string[], store: PortfolioStore): { envelope: AnswerEnvelope; options: ClarifyOption[] } {
  const options = clarifyOptions(question, unbound, store);
  const envelope: AnswerEnvelope = {
    id,
    answer: `I don't know — FlowIQ has no meaning for ${unbound.map((w) => `"${w}"`).join(', ')} in this question, so it will not answer a different question in its place. Did you mean: ${options.map((o, k) => `(${k + 1}) ${o.label}`).join('; ')}?`,
    result: { unknown: true, clarification_needed: true },
    citations: ['properties:P01'],
  };
  return { envelope, options };
}

const FILTER_KEYS = ['bedrooms', 'bathrooms', 'bedroomsMin', 'bedroomsMax', 'bathroomsMin', 'bathroomsMax', 'sqftMin', 'sqftMax', 'floorMin', 'floorMax', 'rentMin', 'rentMax', 'view', 'buildingClass'] as const;
const STATUS_WORD: Readonly<Record<string, string>> = { vacant: 'vacant', occupied: 'occupied', notice: 'on-notice' };
const between = (noun: string, min?: number, max?: number, prefix = ''): string | null => {
  if (min === undefined && max === undefined) return null;
  if (min !== undefined && max !== undefined) return min === max ? `${prefix}${min} ${noun}` : `between ${prefix}${min} and ${prefix}${max} ${noun}`;
  return min !== undefined ? `at least ${prefix}${min} ${noun}` : `at most ${prefix}${max} ${noun}`;
};

/** A whole question for one typed reading, or null when the reading has no unit measure FlowIQ phrases. */
export function canonicalQuestion(intent: ParsedQueryIntent, building?: string): string | null {
  const head: Readonly<Record<string, string>> = {
    unit_count: 'How many',
    avg_market_rent: 'What is the average market rent of',
    avg_sqft: 'What is the average sq ft of',
  };
  if (intent.domain !== 'units' || head[intent.measure] === undefined) return null;
  const withs = [
    intent.bedrooms !== undefined ? `${intent.bedrooms} bedrooms` : between('bedrooms', intent.bedroomsMin, intent.bedroomsMax),
    intent.bathrooms !== undefined ? `${intent.bathrooms} bathrooms` : between('bathrooms', intent.bathroomsMin, intent.bathroomsMax),
    between('sq ft', intent.sqftMin, intent.sqftMax),
    intent.rentMin !== undefined || intent.rentMax !== undefined ? `rent ${between('', intent.rentMin, intent.rentMax, '$')!.trim()}` : null,
  ].filter((x): x is string => x !== null);
  const floor = intent.floorMin === undefined && intent.floorMax === undefined ? null
    : intent.floorMin === intent.floorMax ? `on floor ${intent.floorMin}`
      : intent.floorMin !== undefined && intent.floorMax !== undefined ? `on floors ${intent.floorMin} to ${intent.floorMax}`
        : intent.floorMin !== undefined ? `on floor ${intent.floorMin} or above` : `on floor ${intent.floorMax} or below`;
  const status = intent.unitStatus ? `${STATUS_WORD[intent.unitStatus]} ` : '';
  const parts = [`${head[intent.measure]} ${status}units`, withs.length ? `with ${withs.join(' and ')}` : null, floor, building ? (intent.measure === 'unit_count' ? `are at ${building}` : `at ${building}`) : (intent.measure === 'unit_count' ? 'are there' : 'in the portfolio')];
  return `${parts.filter(Boolean).join(' ')}?`;
}
