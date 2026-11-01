// F-TSC-1 (Tau): an explicit upload ask gets the demo-only reply first,
// then a short capability line; other capability questions are unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

const store = loadPortfolioStore();

test('"can I upload my rent roll?" gets demo-only first, then a capability line', async () => {
  const r = await askFlowIqCopilot('can I upload my rent roll?', { store, parse: null });
  const a = r.envelope.answer;
  const result = r.envelope.result as Record<string, unknown>;
  assert.equal(result.demo_only, true);
  assert.equal(result.capability, undefined);
  assert.ok(a.startsWith('This is a demo.'));
  const demoAt = a.indexOf("You can't upload a rent roll");
  const capAt = a.indexOf('What you can do here:');
  assert.ok(demoAt >= 0 && capAt > demoAt, a);
  assert.match(a, /\/help/);
});

test('non-upload capability question still gets the capability answer', async () => {
  const r = await askFlowIqCopilot('is this my data or a demo?', { store, parse: null });
  assert.equal((r.envelope.result as Record<string, unknown>).capability, true);
  assert.doesNotMatch(r.envelope.answer, /What you can do here:/);
});
