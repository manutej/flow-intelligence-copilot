// Held-out fair-housing probes for VERDICT-GENUI-d6406ed T1 and T2: refuse lookups of people by a
// trait however it is worded or spelt; answer a trait word that describes a product, place or event.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyFairHousingRequest } from '../src/domain/fair-housing.ts';

const probes = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/fh-identification-probes-r7.json'), 'utf8')) as { refuse: string[]; answer: string[] };

test('T1: trait lookups refuse in multiword, synonym and two-typo forms', () => {
  assert.deepEqual(probes.refuse.filter((q) => !classifyFairHousingRequest(q).refused), []);
});
test('T2: a trait word describing a product, place or event is not refused', () => {
  assert.deepEqual(probes.answer.filter((q) => classifyFairHousingRequest(q).refused), []);
});
