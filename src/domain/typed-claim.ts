import type { AnswerEnvelope, PortfolioStore, UnitRecord } from '../data/schema.ts';

/**
 * L3, the evidence layer: the calculation behind a claim is not the
 * understanding of the question, so the verifier does not trust the
 * producer's arithmetic. It reads the sentence back as a typed claim from a
 * closed grammar and recomputes what the store allows for it:
 *
 *   "<P> has N <status> units"       N within the status count, every cited unit of that status
 *   "vacancy rate is X% (a/b units)" a within the vacant count, b within the unit count
 *   "vacancy rate is X%"             X is the building's own rate
 *   "average market rent ... $V"     V between the cheapest and dearest unit in scope
 *   "average square footage ... V"   V between the smallest and largest unit in scope
 *
 * A mean lies between its least and greatest term, and a filtered count
 * never exceeds the unfiltered one, so each rule is sound for any filter
 * the producer applied. A sentence outside the grammar falls back to the
 * figure checks in claim.ts.
 */

const STATUS_WORDS: ReadonlyArray<readonly [RegExp, UnitRecord['status'] | 'any']> = [
  [/\b(?:vacant|empty|available|unrented|unleased|free|open|ready\s+to\s+(?:lease|rent)|unoccupied)\b/, 'vacant'],
  [/\b(?:occupied|leased|rented|taken)\b/, 'occupied'],
  [/\b(?:on\s+)?notice\b/, 'notice'],
  [/\b(?:matching|total)\b/, 'any'],
];

function scopeOf(envelope: AnswerEnvelope, store: PortfolioStore): string[] {
  const text = envelope.answer ?? '';
  const named = store.properties.filter((p) => new RegExp(`\\b${p.propertyId}\\b`).test(text) || text.includes(p.name)).map((p) => p.propertyId);
  if (named.length > 0) return named;
  const cited = new Set((envelope.citations ?? []).filter((c) => c.startsWith('properties:')).map((c) => c.slice(11)));
  return [...cited];
}

const num = (s: string) => Number(s.replace(/,/g, ''));

export function typedClaimErrors(envelope: AnswerEnvelope, store: PortfolioStore): string[] {
  const errors: string[] = [];
  const text = (envelope.answer ?? '').normalize('NFKC');
  const scope = scopeOf(envelope, store);
  const units = store.units.filter((u) => scope.length === 0 || scope.includes(u.propertyId));
  const countOf = (status: UnitRecord['status'] | 'any') => units.filter((u) => status === 'any' || u.status === status).length;

  // "has N <status> units" / "has N units ready to lease"
  for (const m of text.matchAll(/\bhas\s+([\d,]+)\s+((?:[\w-]+\s+){0,3}?)(?:units?|apartments?|homes?)\b([^.;,(]{0,24})/gi)) {
    const n = num(m[1]);
    const words = `${m[2]} ${m[3]}`.toLowerCase();
    const status = STATUS_WORDS.find(([re]) => re.test(words))?.[1];
    if (!status) continue;
    if (n > countOf(status)) {
      errors.push(`"${m[0].trim()}" claims ${n}, but the store holds ${countOf(status)} ${status === 'any' ? '' : `${status} `}units in scope`);
    }
    // Each cited unit is evidence for the status the sentence names.
    for (const u of store.units) {
      if (status !== 'any' && envelope.citations.includes(u.citationId) && u.status !== status) {
        errors.push(`"${m[0].trim()}" cites ${u.unitId}, which is ${u.status}, not ${status}`);
      }
    }
  }

  // Vacancy rate, with or without its part and whole.
  for (const m of text.matchAll(/\bvacancy\s+rate\s+(?:is|was|of)\s+([\d.]+)%(?:\s*\((\d+)\s*(?:\/|of)\s*(\d+))?/gi)) {
    const [p, a, b] = [Number(m[1]), m[2] && Number(m[2]), m[3] && Number(m[3])];
    if (typeof a === 'number' && typeof b === 'number') {
      if (a > countOf('vacant') || b > countOf('any')) errors.push(`Vacancy ${a}/${b} exceeds the ${countOf('vacant')}/${countOf('any')} vacant units in scope`);
    } else if (scope.length === 1) {
      const own = Math.round((1000 * countOf('vacant')) / Math.max(1, countOf('any'))) / 10;
      if (Math.abs(own - p) > 0.051) errors.push(`Vacancy rate ${p}% is not ${scope[0]}'s ${own}%; a filtered rate must state its part and whole`);
    } else if (scope.length === 0) errors.push(`Vacancy rate ${p}% names no building and no part and whole`);
  }

  // A mean lies between its least and greatest term.
  const bounds = (xs: number[]) => [Math.min(...xs), Math.max(...xs)] as const;
  const checks: ReadonlyArray<readonly [RegExp, (u: UnitRecord) => number, string]> = [
    [/\baverage\s+market\s+rent\b[^$]{0,80}\$\s*([\d,]+(?:\.\d+)?)/gi, (u) => u.marketRent, 'market rent'],
    [/\baverage\s+(?:square\s+footage|sq\.?\s*ft|sqft|size)\b[^\d]{0,40}([\d,]+(?:\.\d+)?)/gi, (u) => u.sqft, 'square footage'],
  ];
  if (units.length > 0) {
    for (const [re, field, label] of checks) {
      const [lo, hi] = bounds(units.map(field));
      for (const m of text.matchAll(re)) {
        const v = num(m[1]);
        if (v < lo - 0.051 || v > hi + 0.051) errors.push(`Average ${label} ${v} lies outside every unit in scope (${lo} to ${hi})`);
      }
    }
  }
  return errors;
}
