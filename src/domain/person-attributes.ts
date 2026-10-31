import type { PortfolioStore } from '../data/schema.ts';
import { REQUIRED_COLUMNS } from '../data/loader.ts';
import { FIXED } from './vocabulary.ts';
import { STRUCTURE_WORDS } from '../agent/closed-world.ts';
import { PROTECTED_CLASS_RULES, correctCategoryTypos, normalizeForFairHousing, type ProtectedClassRule } from './fair-housing.ts';

/**
 * People appear in the exports only as lease, unit and lead rows: there is no residents file and
 * no trait column. A lookup of people ("which tenants ...", "show the ... residents", "who at ...")
 * may filter only on what those rows hold, so every word of it must be a column, a value the data
 * carries, a building name, or grammar. Any other word is an attribute nobody recorded: the lookup
 * is refused when a protected category names that attribute (the category list only picks the
 * wording) and answered IDK otherwise. The known words come from the schema and the rows, never
 * from a list of questions.
 */

/** Words that carry no attribute: function words, quantities, comparison, time, and lookup verbs. */
const GRAMMAR = new Set(`a an the of in on at to for by from with without into onto over under than then and or but not no nor
who whom whose which what that this these those there here where when how many much more most less least fewer fewest
is are was were be been being am do does did have has had having can could will would should may might must shall
i me my we us our you your they them their it its he she his her him one ones each every all any some both either neither
only just also still now currently current ever never already yet again per across between among within during before after
since until while as so if about up down out off away
show me list find name identify flag count pull look give tell display get see report
highest lowest biggest smallest largest top bottom greatest average total number percent percentage share rate
year years month months week weeks day days today quarter last next this past recent recently first latest earliest
new old long longer longest short shorter
pay pays paid paying live lives lived living stay stays stayed move moves moved moving sign signs signed signing
rent rents rented renting lease leases leased leasing renew renews renewed renewing expire expires expired expiring
end ends ended ending start starts started starting leave leaves left owe owes owed currently
tenant tenants resident residents renter renters applicant applicants occupant occupants household households
people persons person lessee lessees leaseholder leaseholders folks prospect prospects`.split(/\s+/));

/** Nouns naming people: the subject a person lookup asks about. */
const PEOPLE = /\b(?:tenants?|residents?|renters?|applicants?|occupants?|households?|people|persons?|lessees?|leaseholders?|folks|prospects?)\b/;
const LOOKUP_VERB = /\b(?:which|who|whom|whose|list|show|find|name|identify|flag|count|display|pull\s+up|look\s+up|how\s+many|what)\b/;
/** "who at Kedzie Works ...", "who here is ...": a person lookup with no people noun. */
const WHO_LOOKUP = /^\s*(?:and\s+|so\s+|now\s+)?who\b/;
/** "who covers ... for the leasing team": a bare who about the operator's own staff is not a resident lookup. */
const STAFF = /\b(?:team|staff|leasing\s+(?:agents?|office)|managers?|employees?|crew|vendors?|contractors?)\b/;
/** Words that never name what is looked up: articles, prepositions, pronouns, quantifiers. */
const FUNCTION = new Set(`a an the of in on at to for by from with all any some every each our my your their its this that these those me us
many much more most few which what who whom whose is are was were be do does did have has had s here there please
show list find name identify flag count pull look display give tell up`.split(/\s+/));

/** People are asked about unless the only people noun is a singular modifier of another noun
 * ("the resident mixer", "a tenant portal"): those describe a thing. */
const namesPeople = (s: string) => [...s.matchAll(new RegExp(PEOPLE.source, 'g'))].some((m) => {
  const next = /^\s+([a-z]+)/.exec(s.slice((m.index ?? 0) + m[0].length))?.[1];
  return /s$/.test(m[0]) || m[0] === 'people' || !next || GRAMMAR.has(next) || GRAMMAR.has(stem(next));
});
/** A lookup asks about people when the first thing named after a lookup word is a people noun:
 * "which tenants ...", "show the Muslim residents", "the residents who ..." (a word no column holds is skipped as a
 * modifier), but not "how many units have residents who ..." or "total rent from residents". */
/** Prepositions that make the people noun the owner of what is asked. */
const OF_PEOPLE = new Set(['of', 'from', 'for', 'by', 'among', 'across']);
function asksAboutPeople(ws: readonly string[], vocab: Set<string>): boolean {
  const verbs = new Set(['which', 'who', 'whom', 'whose', 'list', 'show', 'find', 'name', 'identify', 'flag', 'count', 'display', 'many', 'what', 'up']);
  // the start of the sentence counts as a lookup word: a bare "the residents who ..." is a list
  return ['', ...ws].some((v, j) => {
    const i = j - 1;
    if (j > 0 && (!verbs.has(v) || (v === 'up' && !['pull', 'look'].includes(ws[i - 1])) || (v === 'many' && ws[i - 1] !== 'how'))) return false;
    let skipped = false;
    for (let k = i + 1; k < ws.length; k++) {
      const w = ws[k];
      // "the satisfaction score from residents": a thing asked of people, not a lookup of them
      if (skipped && OF_PEOPLE.has(w)) return false;
      if (FUNCTION.has(w)) continue;
      if (PEOPLE.test(w)) return namesPeople(ws.slice(k).join(' '));
      if (vocab.has(w) || vocab.has(stem(w))) return false;
      skipped = true;
    }
    return false;
  });
}
const stem = (w: string) => w.replace(/(?:'s|’s)$/, '').replace(/(?:ings?|edly|ed|es|s|al|ly|ment|ers?)$/, '');
/** Letter words only: a token with a digit (Q3, H1, 2br, 2027) is a period, size or number. */
const tokens = (s: string) => (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => !/\d/.test(t));
const camelWords = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
/** Fields that are identifiers, dates or free text: their contents are not a vocabulary. */
const SKIP_FIELD = /(?:Id|citationId|Date|Month|notes?|rawNote|injectionReason|Urls?|onboardingReadiness)$/;

/** Month names in full and short form, from the platform calendar rather than a list. */
const MONTHS = Array.from({ length: 12 }, (_, m) => ['long', 'short'].map((f) => new Date(Date.UTC(2026, m, 15)).toLocaleString('en-US', { month: f as 'long' | 'short', timeZone: 'UTC' }).toLowerCase())).flat();
/** Conversational filler: carries no condition on anyone. */
const FILLER = 'hey hi hello um uh er hmm ok okay so basically actually kindly please thanks soon quick quickly real really like just above below mentioned again'.split(' ');
/** A word some protected category matches is never "known", whatever list it came from (fail closed). */
const isTrait = (w: string) => PROTECTED_CLASS_RULES.some((r) => r.pattern.test(w));

const vocabularies = new WeakMap<PortfolioStore, Set<string>>();
/** Every column name and every categorical value in the store, as stems. */
export function schemaVocabulary(store: PortfolioStore): Set<string> {
  const cached = vocabularies.get(store);
  if (cached) return cached;
  const words = new Set<string>();
  const add = (text: string) => { for (const t of tokens(text)) { words.add(t); words.add(stem(t)); } };
  for (const [file, cols] of Object.entries(REQUIRED_COLUMNS)) { add(file.replace(/\.csv$/, '').replace(/[/_]/g, ' ')); for (const c of cols) add(c.replace(/_/g, ' ')); }
  const tables: ReadonlyArray<readonly object[]> = [store.properties, store.units, store.leases, store.leads, store.spend, store.decisions];
  for (const rows of tables) for (const row of rows) for (const [k, v] of Object.entries(row)) {
    add(camelWords(k));
    if (SKIP_FIELD.test(k)) continue;
    for (const x of Array.isArray(v) ? v : [v]) if (typeof x === 'string' && !/\d{3,}/.test(x)) add(x.replace(/_/g, ' '));
  }
  // the words the question parser itself reads (its closed vocabulary and structure words),
  // dates, and filler: none is an attribute of a person
  for (const w of [...FIXED, ...STRUCTURE_WORDS, ...MONTHS, ...FILLER]) if (!isTrait(w)) { words.add(w); words.add(stem(w)); }
  for (const w of [...words]) if (isTrait(w)) words.delete(w);
  vocabularies.set(store, words);
  return words;
}

export interface PersonAttributeLookup {
  /** Words of the lookup that no column, value, name or grammar accounts for. */
  readonly unknown: readonly string[];
  /** Categories that name one of those words as a trait of the people asked about. */
  readonly classes: readonly ProtectedClassRule[];
}

const known = (w: string, vocab: Set<string>) => w.length < 2 || GRAMMAR.has(w) || vocab.has(w) || vocab.has(stem(w)) || GRAMMAR.has(stem(w));

/**
 * The unknown attributes of a person lookup, or null when the question is not one. A trait word
 * whose next word (after a hyphen compound) is a column or data noun describes that thing
 * ("family-size units"), not people, and names no category.
 */
export function personAttributeLookup(question: string, store: PortfolioStore): PersonAttributeLookup | null {
  // the words are read from the question as typed (lowercased, NFKC), not from the leet-folded
  // fair-housing text, so "Q3" stays a period token instead of becoming "qe"
  const text = correctCategoryTypos(question.normalize('NFKC').toLowerCase().replace(/[\u2018\u2019]/g, "'"));
  const sentences = text.match(/[^.?!;\n]+/g) ?? [];
  const vocab = schemaVocabulary(store);
  const unknown = new Set<string>();
  const classes = new Set<ProtectedClassRule>();
  for (const s of sentences) {
    const ws = tokens(s);
    if (!(asksAboutPeople(ws, vocab) || (WHO_LOOKUP.test(s) && !STAFF.test(s)))) continue;
    const miss = ws.filter((w) => !known(w, vocab));
    if (!miss.length) continue;
    for (const w of miss) unknown.add(w);
    for (const r of PROTECTED_CLASS_RULES) {
      const re = new RegExp(r.pattern.source, 'gi');
      for (const m of [...s.matchAll(re), ...normalizeForFairHousing(s).matchAll(re)]) {
        const span = tokens(m[0]);
        if (!span.some((w) => miss.includes(w))) continue;
        const compound = /^((?:-[a-z]+)+)\s+([a-z]+)/.exec(s.slice((m.index ?? 0) + m[0].length));
        const describesThing = !!compound && vocab.has(stem(compound[2])) && !PEOPLE.test(compound[2]);
        if (!describesThing) classes.add(r);
      }
    }
  }
  return unknown.size ? { unknown: [...unknown], classes: [...classes] } : null;
}
