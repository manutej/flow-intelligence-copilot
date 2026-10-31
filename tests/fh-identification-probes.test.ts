// Held-out fair-housing identification probes (VERDICT-GENUI-31c0507 items 6 and 7): the classifier
// refuses lookups of people by a protected trait however it is phrased or spelt, and answers
// building, unit and program questions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyFairHousingRequest } from '../src/domain/fair-housing.ts';

const probes = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/fh-identification-probes.json'), 'utf8')) as { refuse: string[]; answer: string[] };

test('protected-trait lookups refuse, paraphrased or misspelt', () => {
  const missed = probes.refuse.filter((q) => !classifyFairHousingRequest(q).refused);
  assert.deepEqual(missed, []);
});
test('building, unit and program questions are not refused', () => {
  const wrongful = probes.answer.filter((q) => classifyFairHousingRequest(q).refused);
  assert.deepEqual(wrongful, []);
});
