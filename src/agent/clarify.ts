import type { AnswerEnvelope, PortfolioStore } from '../data/schema.ts';
import { resolvePropertiesFromText } from '../domain/resolver.ts';
import { findUnknownBuildingReference, findUnresolvedPlace } from './recognition.ts';
import { isMeasureNoun, onlyInFilterClause } from './intent.ts';
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

/** Words that carry the ask itself: a ranking, a comparison, a cause or a "why". */
const ASK_WORD = /^(?:highest|lowest|most|least|top|bottom|best|worst|slowest|fastest|largest|smallest|biggest|rank|ranks|ranking|ranked|vs|versus|compare|compared|comparison|move|moved|moving|change|changed|trend|trending|why|affect|affects|impact|impacts|cause|causes|drive|drives)$/i;

/**
 * A reading that removes the place or the ask answers a different question:
 * "vacant units at Riverside" read for the portfolio, "which property has
 * the highest vacancy" read as one count. No reading is offered when the
 * question names a place that resolves to no building, when a dropped word
 * stands where a place does (after at/near/in/around, or a capitalised word
 * inside a sentence), when an unresolved capitalised name sits in the
 * question, or when a dropped word is the ranking, comparison or cause.
 */
function dropsPlaceOrAsk(question: string, unbound: readonly string[], store: PortfolioStore): boolean {
  if (findUnresolvedPlace(question, store)) return true;
  if (unbound.some((w) => ASK_WORD.test(w))) return true;
  // A dropped locative ("vacancy around X") turns a place-relative ask into one about X itself.
  if (unbound.some((w) => /^(?:at|near|in|around|within|by)$/i.test(w))) return true;
  const labels = store.properties.flatMap((p) => [p.name, ...p.aka]).map((l) => l.toLowerCase());
  const labelWords = new Set(labels.flatMap((l) => l.split(/\s+/)));
  for (const w of unbound) {
    const at = new RegExp(String.raw`\b(?:at|near|in|around)\s+(?:the\s+)?(?:[\p{L}'’&-]+\s+){0,2}${escape(w)}(?![\p{L}\p{N}])`, 'iu');
    if (at.test(question)) return true;
    const cap = new RegExp(String.raw`(?<=[\p{L}\p{N},;]\s+)(${escape(w)})(?![\p{L}\p{N}])`, 'giu');
    // Acronyms ("LPs", "NOI") are not names.
    for (const m of question.matchAll(cap)) if (/^\p{Lu}/u.test(m[1]) && !/^\p{Lu}{2,}s?$/u.test(m[1])) return true;
  }
  // A capitalised name of two or more words inside the sentence ("the
  // Market Square retail vacancy") that is no building's name or alias.
  for (const m of question.matchAll(/(?<=[\p{L}\p{N},;]\s+)(\p{Lu}[\p{L}'’]+(?:\s+\p{Lu}[\p{L}'’]+)+)/gu)) {
    const phrase = m[1].toLowerCase();
    if (labels.some((l) => l === phrase || l.endsWith(phrase) || l.replace(/^the\s+/, '') === phrase)) continue;
    if (phrase.split(/\s+/).some((w) => !labelWords.has(w))) return true;
  }
  return false;
}

/** Optimal-string-alignment distance capped at 2: one insertion, deletion, substitution or adjacent swap is 1. */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return Math.min(d[a.length][b.length], 2);
}

interface NearMiss { readonly start: number; readonly end: number; readonly written: string; readonly name: string }
/**
 * A building label written one edit away: a run of question words that
 * matches a property's name or alias word for word, with exactly one edit
 * in total (in a word of four or more letters). It counts only when exactly
 * one property has such a run and the run is not already an exact label.
 */
export function nearMissBuilding(question: string, store: PortfolioStore): NearMiss | null {
  const words = [...question.matchAll(/[\p{L}\p{N}'’&]+/gu)];
  const found = new Map<string, NearMiss>();
  for (const p of store.properties) {
    for (const label of [p.name, ...p.aka].filter(isDisplayLabel)) {
      const lw = label.toLowerCase().replace(/^the\s+/, '').split(/\s+/);
      for (let i = 0; i + lw.length <= words.length; i++) {
        let edits = 0;
        for (let k = 0; k < lw.length && edits < 2; k++) {
          const w = words[i + k][0].toLowerCase();
          const e = w === lw[k] ? 0 : Math.min(w.length, lw[k].length) >= 4 ? editDistance(w, lw[k]) : 2;
          edits += e;
        }
        if (edits !== 1) continue;
        const start = words[i].index!, last = words[i + lw.length - 1];
        const end = last.index! + last[0].length;
        const prev = found.get(p.propertyId);
        // The longest run wins: "armitage common" is one mention of "Armitage Commons", not "Commons".
        if (!prev || end - start > prev.end - prev.start) found.set(p.propertyId, { start, end, written: question.slice(start, end), name: p.name });
      }
    }
  }
  return found.size === 1 ? [...found.values()][0] : null;
}
const isDisplayLabel = (l: string) => /^[\p{L}\p{N}'’& .-]+$/u.test(l.trim()) && l.trim().length >= 3;

/**
 * Did-you-mean for a building one edit away: the only option is the user's
 * own question with that one name corrected, so the measure and every
 * filter stay as written. Any other unbound word goes through the ordinary
 * readings of the corrected question, each still naming the building.
 */
function didYouMean(question: string, typo: NearMiss, unbound: readonly string[], store: PortfolioStore): ClarifyOption[] {
  const corrected = `${question.slice(0, typo.start)}${typo.name}${question.slice(typo.end)}`;
  const typoWords = new Set(typo.written.toLowerCase().split(/[^\p{L}\p{N}'’&]+/u));
  const rest = unbound.filter((w) => !typoWords.has(w.toLowerCase()));
  if (rest.length > 0) {
    return clarifyOptions(corrected, rest, store).map((o) => ({ ...o, label: `"${typo.written}" as ${typo.name}, ${o.label}` }));
  }
  const query = parseQueryIntent(corrected, store);
  if (query.measure === 'unsupported') return [];
  return [{ label: `"${typo.written}" as ${typo.name}: ${restate(query, corrected, store).replace(/^I computed: /, '').replace(/\.$/, '')}`, question: corrected, query }];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 2-4 typed readings of a question whose words `unbound` no field carries. */
export function clarifyOptions(question: string, unbound: readonly string[], store: PortfolioStore): ClarifyOption[] {
  // A reading without a measure noun the question states ("units, vacancy, leads") answers less than was asked.
  const nouns = unbound.filter((w) => isMeasureNoun(w) && !onlyInFilterClause(question, w));
  const states = (q: string, w: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(w)}(?![\\p{L}\\p{N}])`, 'iu').test(q);
  return readings(question, unbound, store).filter((o) => nouns.every((w) => states(o.question, w)));
}

function readings(question: string, unbound: readonly string[], store: PortfolioStore): ClarifyOption[] {
  const options: ClarifyOption[] = [];
  // Dropping a negator inverts the question ("not vacant" -> "vacant"), so
  // no reading is offered; the turn is an honest "I don't know".
  // An unknown building has no reading: guessing one by a shared word, or
  // widening to the portfolio, answers a different question.
  const typo = nearMissBuilding(question, store);
  if (typo) return didYouMean(question, typo, unbound, store);
  if (findUnknownBuildingReference(question, store)) return [];
  if (dropsPlaceOrAsk(question, unbound, store)) return [];
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
    // A named building stays named: widening to the portfolio drops the place.
    const scopes = named0.length === 1 ? [named0[0].name] : [undefined];
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
    answer: `I don't know — FlowIQ has no meaning for ${unbound.map((w) => `"${w}"`).join(', ')} in this question, so it will not answer a different question in its place.${options.length > 0 ? ` Did you mean: ${options.map((o, k) => `(${k + 1}) ${o.label}`).join('; ')}?` : ''}`,
    result: options.length > 0 ? { unknown: true, clarification_needed: true } : { unknown: true },
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
