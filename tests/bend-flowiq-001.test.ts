import assert from 'node:assert/strict';
import { test } from 'node:test';
import { wellFormedOptions } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

// FIX-BEND-FLOWIQ-001: seen.add runs only after the answerability check.
const store = loadPortfolioStore();
const qRecord = { id: 'bend-001', question: 'Vacancy rate at Kedzie Wroks?' } as any;
const good = 'Vacancy rate at Kedzie Works?';
const bad = 'Vacancy rate at Nowhere Towers?';

test('bend-001: an unanswerable option is dropped and does not claim its text', () => {
  const out = wellFormedOptions(
    [{ label: 'nowhere', question: bad }, { label: 'kedzie', question: good }, { label: 'kedzie again', question: good.toUpperCase() }],
    qRecord, store);
  assert.deepEqual(out.map((o) => o.question), [good]);
});

test('bend-001: an answerable option still dedupes case-insensitively', () => {
  const out = wellFormedOptions([{ label: 'a', question: good }, { label: 'b', question: ` ${good.toLowerCase()} ` }], qRecord, store);
  assert.equal(out.length, 1);
});
