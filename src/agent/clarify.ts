import type { AnswerEnvelope, PortfolioStore } from '../data/schema.ts';
import { resolvePropertiesFromText } from '../domain/resolver.ts';
import { findUnknownBuildingReference } from './recognition.ts';
import { unboundNegators } from './closed-world.ts';
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
  /** S2: the full typed query that question runs. */
  readonly query?: ParsedQueryIntent;
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
    intent.unitStatusIn && `status in {${intent.unitStatusIn.join(', ')}}`,
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
  // A building name that is not in properties.csv is never resolved by a
  // shared generic word ("Lakeview Tower" is not Printers Row Tower).
  const unknownName = findUnknownBuildingReference(question, store);
  if (unknownName) return `I computed: ${what}${filters.length ? `, ${filters.join(', ')}` : ''}, at "${unknownName}" (no such building).`;
  const named = resolvePropertiesFromText(store, question).matched;
  const scope = named.length > 0 ? named.map((p) => `${p.name} (${p.propertyId})`).join(', ') : 'all operating buildings';
  return `I computed: ${what}${filters.length ? `, ${filters.join(', ')}` : ''}, at ${scope}.`;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 2-4 typed readings of a question whose words `unbound` no field carries. */
export function clarifyOptions(question: string, unbound: readonly string[], store: PortfolioStore): ClarifyOption[] {
  const options: ClarifyOption[] = [];
  // Dropping a negator inverts the question ("not vacant" -> "vacant"), so
  // no reading is offered; the turn is an honest "I don't know".
  // An unknown building has no reading: guessing one by a shared word, or
  // widening to the portfolio, answers a different question.
  if (findUnknownBuildingReference(question, store)) return [];
  if (unboundNegators(question).length > 0) return negatedStatusOptions(question, store);
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
    if (q !== null) options.push({ label: `${prefix}${label(intent, here && building ? building.name : '')}`, question: q, query: parseQueryIntent(q, store) });
  }
  return options.slice(0, 4);
}

const STATUS_NEG_RE = /\b(?:(?:that|which)\s+)?(?:(?:are|is)\s+not|(?:are|is)n['’]t|not|non-?|except|excluding|other\s+than)\s*(?:currently\s+)?(vacant|occupied|on[-\s]notice|notice)\b(?:\s+units?\b)?/i;
const ALL_STATUSES = ['notice', 'occupied', 'vacant'] as const;

/**
 * A negated status ("not vacant") has no single-status reading, so the
 * options are its complement as a typed status set, then each remaining
 * status on its own. Never the inverted reading. Any other negation has no
 * typed reading and returns no options.
 */
function negatedStatusOptions(question: string, store: PortfolioStore): ClarifyOption[] {
  const m = question.match(STATUS_NEG_RE);
  if (!m) return [];
  const neg = m[1].toLowerCase().replace(/^on[-\s]/, '');
  const rest = ALL_STATUSES.filter((s) => s !== neg);
  const stripped = question.replace(STATUS_NEG_RE, m[0].trim().endsWith('units') || /units?$/i.test(m[0]) ? ' units ' : ' ').replace(/\s+/g, ' ').replace(/\s+([?.!,])/g, '$1').trim();
  if (unboundNegators(stripped).length > 0) return [];
  const base = parseQueryIntent(stripped, store);
  if (base.domain !== 'units' || base.measure === 'unsupported') return [];
  const named0 = resolvePropertiesFromText(store, question).matched;
  // A stated status already inside the complement ("on notice and not
  // vacant") is that status alone; one equal to the negated status is a
  // contradiction with no reading.
  if (base.unitStatus !== undefined) {
    if (base.unitStatus === neg) return [];
    const scopes = named0.length === 1 ? [named0[0].name, undefined] : [undefined];
    return scopes.flatMap((b, k) => {
      const q = canonicalQuestion(base, b);
      if (q === null) return [];
      const query = parseQueryIntent(q, store);
      return [{ label: `Only ${base.unitStatus} (already not ${neg})${k ? ', across the portfolio' : ''}: ${restate(query, q, store).replace(/^I computed: /, '').replace(/\.$/, '')}`, question: q, query }];
    });
  }
  const named = resolvePropertiesFromText(store, question).matched;
  const building = named.length === 1 ? named[0] : undefined;
  const out: ClarifyOption[] = [];
  const readings: Array<[ParsedQueryIntent, string]> = [
    [{ ...base, unitStatus: undefined, unitStatusIn: [...rest] }, `Every status except ${neg}: `],
    ...rest.map((st): [ParsedQueryIntent, string] => [{ ...base, unitStatus: st, unitStatusIn: undefined }, `Only ${st}: `]),
  ];
  for (const [intent, prefix] of readings) {
    const q = canonicalQuestion(intent, building?.name);
    if (q === null) continue;
    const query = parseQueryIntent(q, store);
    out.push({ label: `${prefix}${restate(query, q, store).replace(/^I computed: /, '').replace(/\.$/, '')}`, question: q, query });
  }
  return out.slice(0, 4);
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
  const statusSet = intent.unitStatusIn ? ` whose status is ${intent.unitStatusIn.join(' or ')}` : '';
  const parts = [`${head[intent.measure]} ${status}units${statusSet}`, withs.length ? `with ${withs.join(' and ')}` : null, floor, building ? (intent.measure === 'unit_count' ? `are at ${building}` : `at ${building}`) : (intent.measure === 'unit_count' ? 'are there' : 'in the portfolio')];
  return `${parts.filter(Boolean).join(' ')}?`;
}
