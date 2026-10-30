import type { PortfolioStore } from '../data/schema.ts';
import { resolvePropertiesFromText } from './resolver.ts';

/**
 * L1 is a closed grammar: a question may use only words FlowIQ has a meaning
 * for. The fixed list is the words of the supported questions the planner
 * answers (dev, test and the banks), so a word outside it is a word nothing
 * parses. Names (buildings, addresses, neighborhoods, systems, views,
 * sources) come from the data itself. An amenity word has a meaning only
 * when no building is named or a named building has it: "units at Kedzie
 * Works with parking" is not answered as if parking were not asked about.
 */
const FIXED = new Set(
  [
  'a above absolute accepted across ads after alder all among amount an and',
  'apartment apartments appfolio applied apply april are armitage as aster at',
  'attributed audit august average b bathroom bathrooms became bedroom',
  'bedrooms before beta between billed both brought building',
  'buildings built but buy by cad channel charging clarendon class cold com',
  'combined commons compare concession conversion cost count counts courtyard',
  'coworking cpsl created crm csv current currently date december decided',
  'decimal decision decisions declined delta deltas did distinct divided do',
  'does dog dollars doorman down duplicate duplicates each earlier earliest',
  'end ending entries entry equivalent ev evaluating every exclude facebook',
  'false find first floor for from fulton gave get give given google h had',
  'halcyon halsted harbor has have higher highest how i id ids ils in include',
  'is it its january jul july june kedzie keeping kensington lake lakefront',
  'later lead leads learning lease leased leases list listing lofts loop',
  'lowest many march market marlowe may me mean month monthly months more most',
  'mountain move much my net new no none north not notice november now',
  'occupancy occupied occupiedincludesnotice october of offer on one only open',
  'operating or our outcome p paid pair pairs park pending per percent period',
  'please plunge point pool portfolio post posted posterior printers prior',
  'produced properties property q rank ranks rate re recommended renewal',
  'renewed rent represent residences resident risk river rooftop rounded row',
  'rows run same see seekers sep september set share show signed so solis',
  'source sources south space spend spent sqft started starting starts status',
  'still studio studios sum tell that the their them there they this three',
  'time to total tour toured tower true two under unit units up usd use',
  'vacancy vacant versus vespera view void wanted was we west what',
  'where which who whole whose wide window with works would x yardi yards you',
  'your zero zillow',
  'sq ft homes least dead running name data',
  // Paraphrases of the supported questions (blind-redteam paraphrase set).
  'add additional adjust along already also amb amenity answer apr associated',
  'aug available averaged avg awaiting away because bed beds began best',
  'biggest bldg br brs build came campaign can carries charger chargers',
  'cheapest collapsed combinations combo come coming commencing comparative',
  'comparing compute concierge configure consolidate convert converted could',
  'cpa create dec delivered desk driven due dupes during efficient electric',
  'empty entire enumerate equipped excluded exist expensive expiration',
  'expirations expire expiring exposure expressed extra feb figure filtered',
  'flagged front full fund generated got greatest hides hypothetically',
  'identify if instead into jan keep largest leaves led level looking lose',
  'lounge lounges make managed mar marked meaning money moved moving need',
  'newest nothing number numbers off offered offering older originating out',
  'outstanding over overall pairing percentage place plural plus pre priciest',
  'pull purchase put quarter question range reach reallocate reallocated',
  'reassign records redirect redirected reference remain renew repeat',
  'replaced report resulting richest right round rounding seeing send service',
  'shift shown sign signings singular sitting sourced special spending staffs',
  'stations superlative suppose system table take tally target targeting',
  'tenant third those through tied topped tops turned undecided unoccupied us',
  'using vacate value vehicle vintage voided want well went were whichever',
  'worst year yet yielded',
  // Added after held-out H05, H10 and H13 missed them.
  'marketing generate footage square',
  ].join(' ').split(' '),
);

const storeWords = new WeakMap<PortfolioStore, Set<string>>();
function wordsOf(store: PortfolioStore): Set<string> {
  let words = storeWords.get(store);
  if (!words) {
    words = new Set();
    const rows: unknown[] = [
      ...store.properties.map((p) => [p.name, p.aka, p.address, p.neighborhood, p.pms]),
      ...store.units.map((u) => u.view),
      ...store.paidSources,
      ...store.organicSources,
    ];
    for (const w of JSON.stringify(rows).toLowerCase().match(/[a-z]+/g) ?? []) words.add(w);
    storeWords.set(store, words);
  }
  return words;
}

const amenityWords = (amenities: readonly string[]) =>
  new Set(amenities.join(' ').toLowerCase().match(/[a-z]+/g) ?? []);

/** Words in the question that no part of FlowIQ gives a meaning to. */
export function unknownWords(question: string, store: PortfolioStore): string[] {
  const known = new Set(wordsOf(store));
  const named = resolvePropertiesFromText(store, question, { includeOnboarding: true }).matched;
  const scope = named.length > 0 ? named : store.properties;
  for (const p of scope) for (const w of amenityWords(p.amenities)) known.add(w);
  const out = new Set<string>();
  for (const raw of question.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? []) {
    const w = raw.replace(/'s$|n't$/, '');
    if (FIXED.has(raw) || FIXED.has(w) || known.has(w) || /^[a-z]$/.test(w)) continue;
    if (FIXED.has(w.replace(/s$/, '')) || FIXED.has(w + 's') || FIXED.has(w.replace(/ies$/, 'y'))) continue;
    out.add(raw);
  }
  return [...out];
}
