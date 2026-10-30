import type { AnswerEnvelope, PortfolioStore } from '../data/schema.ts';

/**
 * Claim-bound rendering (S1R-L3). The renderer writes a closed set of forms:
 * a building as "<name> (<Pnn>)", a status from the units.status enum, a
 * count as "<count> <status> units (out of <total> total units)", and dates
 * as absolute windows. Text outside those forms is a claim the result does
 * not bind, so the verifier rejects it rather than trusting the prose.
 */
import { CARDINAL_WORD } from './numbers.ts';

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
const UNANCHORED_PERIOD_RE = /\b(?:[QH][1-4])\b(?!\s*(?:20\d{2}|'\d{2}))|\b(?:year|month|quarter|week)[-\s]+to[-\s]+date\b|\b[YMQ]TD\b|\b(?:past|last|trailing|rolling|previous|prior|next|coming)\s+(?:\d+|few|several|couple\s+of)\s+(?:days?|weeks?|months?|quarters?|years?)\b/i;
// The same, by type: a span counted from now in words ("trailing twelve
// months"), a fiscal or calendar period named from now ("this fiscal year"),
// a fiscal period with no year, and TTM/LTM-style abbreviations (F-093).
const COUNTED_SPAN_RE = new RegExp(String.raw`\b(?:past|last|trailing|rolling|previous|prior|next|coming)\s+(?:${CARDINAL_WORD})\s*(?:days?|weeks?|months?|quarters?|years?)\b`, 'i');
const NAMED_FROM_NOW_RE = /\b(?:this|current|last|next|prior|previous|coming|trailing|rolling|past|the\s+current)\s+(?:fiscal|calendar|financial)\s+(?:year|quarter|half|month)\b|\b(?:fiscal|financial)\s+(?:year|quarter|half)\b(?!\s*(?:20\d{2}|'\d{2}))|\bFY\b(?!\s*'?\d{2,4})|\b[TLN]T[MY]\b|\b(?:to\s+date|so\s+far|year\s+over\s+year|month\s+over\s+month)\b/i;
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
      // Every alias counts, whatever its length (F-078), and in any case
      // (F-092): "h&l" claims H&L's building as much as "H&L" does. Letter
      // and digit boundaries keep a short alias from matching inside a word.
      const flags = 'iu';
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

  // Share: numerator and denominator are both bound to a status (F-096).
  // The rate is recounted from units.status for the claimed status, and
  // every status in the breakdown must carry its own store count.
  errors.push(...shareErrors(text, result, store));

  // Dates: absolute only. Numbers: digits only.
  if (UNANCHORED_PERIOD_RE.test(text) || COUNTED_SPAN_RE.test(text) || NAMED_FROM_NOW_RE.test(text)) errors.push('A period with no year, or counted back from now, has no fixed window to check');
  if (RELATIVE_DATE_RE.test(text)) errors.push('A relative date has no fixed window to check');
  const garbled = text.match(GARBLED_RE);
  if (garbled) errors.push(`"${garbled[0]}" mixes digits and number words`);
  return errors;
}

const SHARE_RE = /([\d.]+)%\s+of\s+units\s+are\s+(occupied|vacant|on[-\s]notice)\s*\(([\d,]+)\s+of\s+([\d,]+)\s+units?\b([^)]*)\)/i;
const STATUS_PART_RE = /([\d,]+)\s+(occupied|vacant|on[-\s]notice)\b/gi;
const statusKey = (w: string) => (/vacant/i.test(w) ? 'vacant' : /notice/i.test(w) ? 'notice' : 'occupied');
// The renderer counts a unit on notice as still occupied.
const SHARE_MEMBERS: Readonly<Record<string, readonly string[]>> = { occupied: ['occupied', 'notice'], vacant: ['vacant'], notice: ['notice'] };

function shareErrors(text: string, result: Record<string, unknown>, store: PortfolioStore): string[] {
  const m = text.match(SHARE_RE);
  if (!m) return [];
  const pid = typeof result.property_id === 'string' ? result.property_id : undefined;
  const units = store.units.filter((u) => pid === undefined || u.propertyId === pid);
  const by = (s: string) => units.filter((u) => u.status === s).length;
  const claimed = statusKey(m[2]);
  const num = units.filter((u) => SHARE_MEMBERS[claimed].includes(u.status)).length;
  const toInt = (x: string) => Number(x.replace(/,/g, ''));
  const errors: string[] = [];
  if (toInt(m[3]) !== num) errors.push(`"${m[3]} of ${m[4]}" does not count ${claimed} units: the store has ${num}`);
  if (toInt(m[4]) !== units.length) errors.push(`"${m[4]} units" is not the ${units.length} units in scope`);
  if (units.length > 0 && Math.abs(Number(m[1]) - (100 * num) / units.length) > 0.051) errors.push(`${m[1]}% is not ${claimed} ${num} of ${units.length}`);
  for (const part of m[5].matchAll(STATUS_PART_RE)) {
    const s = statusKey(part[2]);
    if (toInt(part[1]) !== by(s)) errors.push(`"${part[0]}" is not the store's ${by(s)} ${s} units`);
  }
  return errors;
}
