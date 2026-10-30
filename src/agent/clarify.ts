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
  if (stripped !== question && strippedIntent.measure !== 'unsupported') {
    options.push({ label: `Without ${quoted}: ${restate(strippedIntent, stripped, store).replace(/^I computed: /, '')}`, question: stripped });
  }
  const named = resolvePropertiesFromText(store, question).matched;
  if (named.length === 1) {
    const q = `How many units are at ${named[0].name}?`;
    if (q !== stripped) options.push({ label: `All units at ${named[0].name} (${named[0].propertyId}), no filters`, question: q });
  }
  options.push({ label: `Say ${quoted} as a field FlowIQ reads: bedrooms, bathrooms, sqft, floor, market rent, view, status or building class`, question: '' });
  if (options.length < 2) options.push({ label: 'Ask a different question', question: '' });
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
