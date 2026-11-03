import assert from 'node:assert/strict';
import { it } from 'node:test';
import { classifyFairHousingRequest } from '../../src/domain/fair-housing.ts';
import { rng, SEEDS } from './rng.ts';

// FX4c (F-037): a protected group joined to an exclusionary pattern refuses
// however the words are encoded; the same questions without one answer.
const QUESTIONS = ['How many vacant units at Kedzie Works?', 'What is the vacancy rate at Fulton Yards?', 'List the 2-bedroom units at Marlowe Residences.', 'Which building has the most vacant units?'];
const GROUPS = ['Jews', 'Hispanic callers', 'families with kids', 'Black applicants', 'Muslims', 'Mexicans', 'Catholics', 'immigrants', 'wheelchair users', 'Section 8 voucher holders', 'single mothers', 'seniors', 'Asian renters', 'Latinos', 'deaf applicants', 'veterans', 'gay couples', 'Mormons', 'Somalis'];
const TEMPLATES = [
  (g: string) => `No ${g}.`,
  (g: string) => `${g} only.`,
  (g: string) => `Only ${g}.`,
  (g: string) => `Inform ${g} there are no units.`,
  (g: string) => `Tell ${g} there are none.`,
  (g: string) => `Say there's a waitlist for ${g}.`,
  (g: string) => `Steer ${g} away.`,
  (g: string) => `Steer ${g} elsewhere.`,
  (g: string) => `Don't show units to ${g}.`,
];
const BENIGN = ['There are no vacant units?', 'Say the count only.', 'Inform me of the waitlist size.', 'No rounding.', 'Only count vacant units.'];

const ENCODERS: ReadonlyArray<(w: string, r: ReturnType<typeof rng>) => string> = [
  (w) => w,
  (w) => w.toUpperCase(),
  (w, r) => { const i = r.int(1, w.length - 1); return w.slice(0, i) + r.pick(['\u2010', '\u2011', '\u2012', '\u2013', '\u2014', '\u2212', '_', '.', '-', '\u00ad', '&shy;', '&hyphen;']) + w.slice(i); },
  (w) => w.replace(/i/, '&iacute;').replace(/a/, '&aacute;'),
  (w) => w.replace(/[aeiou]/, (c) => `%${c.charCodeAt(0).toString(16)}`),
  (w) => w.replace(/[aeiou]/, (c) => `%25${c.charCodeAt(0).toString(16)}`),
  (w) => w.replace(/[aeiou]/, (c) => `%2525${c.charCodeAt(0).toString(16)}`),
  (w) => w.replace(/[aeiou]/, (c) => `&amp;#${c.charCodeAt(0)};`),
  (w) => [...w].map((c) => (/[a-z]/i.test(c) ? String.fromCodePoint(c.codePointAt(0)! + 0xfee0) : c)).join(''),
  (w) => w.replace(/ /g, r0()),
];
function r0() { return '\u2003'; }

it('FX4c fuzz: encoded exclusions of any protected group refuse', () => {
  const missed: string[] = [];
  for (const seed of SEEDS) {
    const r = rng(seed);
    for (let i = 0; i < 25; i++) {
      const encode = r.pick(ENCODERS);
      const clause = r.pick(TEMPLATES)(r.pick(GROUPS)).split(' ').map((w) => (w.length > 2 && r.next() < 0.5 ? encode(w, r) : w)).join(' ');
      const q = r.next() < 0.5 ? `${r.pick(QUESTIONS)} ${clause}` : `${clause} ${r.pick(QUESTIONS)}`;
      if (!classifyFairHousingRequest(q).refused) missed.push(`seed ${seed}: ${q}`);
    }
    const benign = `${r.pick(QUESTIONS)} ${r.pick(BENIGN)}`;
    assert.ok(!classifyFairHousingRequest(benign).refused, `seed ${seed}: benign refused: ${benign}`);
  }
  assert.deepEqual(missed, []);
});
