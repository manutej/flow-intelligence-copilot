import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { verifyAnswerEnvelope } from '../src/domain/guards.ts';

// A malformed query_hash makes the envelope invalid; the verifier never throws.
const store = loadPortfolioStore();
const idk = (await askFlowIqCopilot('What was total marketing spend in Q1 2025?', { store, parse: null })).envelope;
const h = idk.proof!.query_hash as string;
for (const [name, bad] of [
  ['odd-length hex', h.slice(0, 63)],
  ['hex then spaces', h.slice(0, 32) + ' '.repeat(32)],
  ['non-hex tail', h.slice(0, 60) + 'gggg'],
  ['unicode', 'é'.repeat(64)],
  ['number', 12345],
  ['empty', ''],
] as const) {
  test(`malformed query_hash is invalid, not an exception: ${name}`, () => {
    const r = verifyAnswerEnvelope({ ...idk, proof: { ...idk.proof!, query_hash: bad as never } }, store);
    assert.equal(r.valid, false);
  });
}
test('the genuine non-answer still verifies', () => assert.equal(verifyAnswerEnvelope(idk, store).valid, true));
