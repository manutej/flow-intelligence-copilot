import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { wellFormedOptions } from '../src/agent/copilot.ts';

// Bend flowiq-clarify-options-001 observation: an unanswerable "a" must not block
// a later answerable "A" (same text case-insensitively). Real case-dependent pair:
// the all-caps reading does not answer, the normal-case one does.
test('FIX-BEND-FLOWIQ-001: a rejected duplicate does not block a valid one', () => {
  const store = loadPortfolioStore();
  const qr = { id: 'BEND-001', question: 'zzz unrelated?' } as never;
  const bad = { label: 'caps', question: 'WHICH AD SOURCE HAS THE HIGHEST COST PER LEAD?' };
  const good = { label: 'normal', question: 'Which ad source has the highest cost per lead?' };
  assert.equal(wellFormedOptions([bad] as never, qr, store).length, 0);
  assert.deepEqual(wellFormedOptions([bad, good] as never, qr, store).map((o) => o.label), ['normal']);
  // Dedup still holds between kept options.
  assert.deepEqual(wellFormedOptions([good, { ...good, label: 'dup' }] as never, qr, store).map((o) => o.label), ['normal']);
});
