import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseQueryIntent } from '../../src/agent/intent.ts';
import { loadPortfolioStore } from '../../src/data/loader.ts';
import { SEEDS, rng } from './rng.ts';

// FX2c / EVAL F-035: a unit question with any qualifier no filter reads must
// never be answered with a count. Each seed builds unseen questions from a
// grammar: a known frame, a building, and either only understood qualifiers
// or one qualifier drawn from open classes (invented words, superlatives,
// thresholds on unfiltered columns, unmodelled attributes, statistics).
const store = loadPortfolioStore();
const BUILDINGS = store.properties.filter((p) => p.isOperating).map((p) => p.name);
const KNOWN = ['vacant', 'occupied', 'studio', '2-bedroom', 'one-bedroom', 'city view', 'lake view', '3BR', ''];
const FRAMES_COUNT = [
  (q: string, b: string) => `How many ${q} units are at ${b}?`,
  (q: string, b: string) => `Number of ${q} apartments at ${b}`,
  (q: string, b: string) => `Count the ${q} units at ${b}.`,
  (q: string, b: string) => `At ${b}, how many ${q} units are there?`,
];
const ADJ = ['furnished', 'corner', 'renovated', 'pet-friendly', 'accessible', 'smoke-free', 'penthouse', 'duplex', 'loft-style', 'sunny', 'quiet', 'haunted', 'garden-level', 'top-floor', 'ground-floor', 'unavailable', 'taken', 'reserved', 'luxury', 'affordable'];
const PRED = ['have a balcony', 'face the lake', 'were renovated', 'allow pets', 'have in-unit laundry', 'are on the top floor', 'are newer than 2010', 'cost over $3,000', 'are under $2000', 'are bigger than 900 sq ft', 'have hardwood floors', 'are cheaper than average', 'have two parking spots'];
const STAT = [
  (b: string) => `What is the cheapest unit at ${b}?`,
  (b: string) => `What's the priciest apartment at ${b}?`,
  (b: string) => `What is the median market rent at ${b}?`,
  (b: string) => `What percent of units at ${b} have a lake view?`,
  (b: string) => `What share of ${b} is vacant?`,
  (b: string) => `What is the biggest unit at ${b}?`,
  (b: string) => `What is the average monthly rent on leases at ${b}?`,
  (b: string) => `What is the typical lease rent at ${b}?`,
  (b: string) => `Total bathrooms at ${b}?`,
];

function unknownVariant(r: ReturnType<typeof rng>): string {
  const b = r.pick(BUILDINGS);
  switch (r.int(0, 3)) {
    case 0: return r.pick(FRAMES_COUNT)(r.pick(ADJ), b);
    case 1: return r.pick(FRAMES_COUNT)(`${r.pick(KNOWN)} ${r.word()}`.trim(), b);
    case 2: return `How many ${r.pick(KNOWN)} units at ${b} ${r.pick(PRED)}?`.replace(/\s+/g, ' ');
    default: return r.pick(STAT)(b);
  }
}

describe('fuzz FX2c: unresolved qualifiers never become a count', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}`, () => {
      const r = rng(seed);
      for (let i = 0; i < 25; i++) {
        const q = unknownVariant(r);
        const intent = parseQueryIntent(q, store);
        assert.equal(intent.measure, 'unsupported', `seed ${seed}: "${q}" -> ${intent.domain}/${intent.measure}`);
      }
    });
  }
  it('still counts questions built only from understood qualifiers', () => {
    const r = rng(SEEDS[0]);
    for (let i = 0; i < 200; i++) {
      const q = r.pick(FRAMES_COUNT)(r.pick(KNOWN), r.pick(BUILDINGS)).replace(/\s+/g, ' ');
      assert.equal(parseQueryIntent(q, store).measure, 'unit_count', q);
    }
  });
});
