import type { AnswerEnvelope, PortfolioStore } from '../data/schema.ts';

/**
 * Claim-bound rendering (S1R-L3). The renderer writes a closed set of forms:
 * a building as "<name> (<Pnn>)", a status from the units.status enum, a
 * count as "<count> <status> units (out of <total> total units)", and dates
 * as absolute windows. Text outside those forms is a claim the result does
 * not bind, so the verifier rejects it rather than trusting the prose.
 */
const NUMBER_WORD = 'zero|one|two|three|four|five|six|seven|eight|nine|ten';
const MONTH = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const WEEKDAY = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday';

// Any spelling of a property id: p06, P-06, P 06, P6, P006.
const ID_LIKE_RE = /(?<![\p{L}\d])[Pp][-\s]?(\d{1,3})(?![\p{L}\d])/gu;
const CANONICAL_ID_RE = /^P\d{2}$/;

const RELATIVE_DATE_RE = new RegExp(
  String.raw`\b(?:yesterday|tomorrow|ago|recently|lately)\b|\b(?:last|this|next|past)\s+(?:week|month|quarter|year|${WEEKDAY})\b|\b(?:since|as\s+of|until|before|after)\s+(?:(?:${MONTH})\b(?!\s+\d)|(?:${WEEKDAY})\b|(?:last|this|next)\b)`,
  'i',
);
// A negated status bound to the counted noun: "14 non-vacant units".
// A period with no year, a to-date span, or a span counted back from now
// (F-080). The renderer always writes "Q3 2026" or an ISO window.
const UNANCHORED_PERIOD_RE = /\b(?:[QH][1-4])\b(?!\s*(?:20\d{2}|'\d{2}))|\b(?:year|month|quarter|week)[-\s]+to[-\s]+date\b|\b[YMQ]TD\b|\b(?:past|last|trailing|previous|prior|next|coming)\s+(?:\d+|few|several|couple\s+of)\s+(?:days?|weeks?|months?|quarters?|years?)\b/i;
const STATUS_INVERSION_RE = /([\d,]+)\s+(?:non|not|un)[-\s]?(?:vacant|occupied|on[-\s]notice)\s+(?:units?|apartments?|homes?)\b/gi;
const GARBLED_RE = new RegExp(String.raw`(?<![\p{L}])(?:[Pp]?\d+(?:${NUMBER_WORD})|(?:${NUMBER_WORD})\d+|[Pp](?:${NUMBER_WORD}))[\p{L}\d]*`, 'iu');

export function bindingErrors(envelope: AnswerEnvelope, store: PortfolioStore): string[] {
  const errors: string[] = [];
  const text = envelope.answer ?? '';
  const result = envelope.result ?? {};

  // Identity: ids only in canonical form, and of real buildings.
  const ids = new Set(store.properties.map((p) => p.propertyId));
  for (const m of text.matchAll(ID_LIKE_RE)) {
    if (!CANONICAL_ID_RE.test(m[0]) || !ids.has(m[0])) errors.push(`"${m[0]}" is not a property id the store renders`);
  }
  // An alias claims the building it belongs to; that building must be named.
  const named = new Set(
    store.properties.filter((p) => new RegExp(`\\b${p.propertyId}\\b`).test(text) || text.includes(p.name)).map((p) => p.propertyId),
  );
  for (const p of store.properties) {
    for (const alias of p.aka) {
      if (named.has(p.propertyId)) continue;
      // Every alias counts, whatever its length (F-078). A short one ("FY")
      // is matched in its own case, so it is not found inside ordinary words.
      const flags = alias.length <= 3 ? 'u' : 'iu';
      const re = new RegExp(`(?<![\\p{L}\\d])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\d])`, flags);
      if (store.properties.some((o) => o.propertyId !== p.propertyId && o.name.toLowerCase().includes(alias.toLowerCase()) && text.includes(o.name))) continue;
      if (re.test(text)) errors.push(`"${alias}" is ${p.propertyId}'s alias, but the answer does not name ${p.propertyId}`);
    }
  }

  // Status: the counted set carries an enum value, never its negation.
  for (const m of text.matchAll(STATUS_INVERSION_RE)) {
    if (typeof result.count === 'number' && Number(m[1].replace(/,/g, '')) === result.count) {
      errors.push(`"${m[0]}" negates a status the units.status enum holds; the count is of one status`);
    }
  }

  // Measure kind: the matching count is the count; the total bounds it.
  if (typeof result.count === 'number') {
    for (const m of text.matchAll(/([\d,]+)\s+total\s+units\b/gi)) {
      const total = Number(m[1].replace(/,/g, ''));
      if (total < result.count) errors.push(`"${m[0]}" is fewer than the count ${result.count}`);
    }
    const matching = text.match(/([\d,]+)\s+matching\s+units?\b/i);
    if (matching && Number(matching[1].replace(/,/g, '')) !== result.count) {
      errors.push(`"${matching[0]}" is not the count ${result.count}`);
    }
  }

  // Dates: absolute only. Numbers: digits only.
  if (UNANCHORED_PERIOD_RE.test(text)) errors.push('A period with no year, or counted back from now, has no fixed window to check');
  if (RELATIVE_DATE_RE.test(text)) errors.push('A relative date has no fixed window to check');
  const garbled = text.match(GARBLED_RE);
  if (garbled) errors.push(`"${garbled[0]}" mixes digits and number words`);
  return errors;
}
