import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { deterministicTurn, CHART_NOT_AVAILABLE, stripChartAsk } from '../src/agent/copilot.ts';

// Phase 1b item 2: a clear chart ask returns the data table plus one line; no chart yet.
const store = loadPortfolioStore();
const turn = (q: string) => deterministicTurn({ id: 'ADHOC', question: q } as never, store);
const plain = turn('Cost per lead by marketing source at Kedzie Works in Q3 2026');

for (const q of [
  'Plot cost per lead by marketing source at Kedzie Works in Q3 2026',
  'Show me a bar chart of cost per lead by marketing source at Kedzie Works in Q3 2026',
  'Cost per lead by marketing source at Kedzie Works in Q3 2026 as a chart',
]) {
  test(`chart ask: ${q}`, () => {
    const t = turn(q);
    assert.deepEqual(t.result, plain.result);
    assert.ok(t.answer.startsWith(plain.answer));
    assert.match(t.answer, /\| source \| usd \|\n\| --- \| --- \|\n\| Apartment List \| 196\.15 \|/);
    assert.equal(t.answer.split('\n').filter((l) => l === CHART_NOT_AVAILABLE).length, 1);
  });
}

test('not a chart ask: "chart of accounts" and plain questions are untouched', () => {
  assert.equal(stripChartAsk('What is the chart of accounts?'), null);
  assert.doesNotMatch(plain.answer, /chart/i);
});

test('chart ask on an unanswerable question stays a non-answer without the chart line', () => {
  const t = turn('Plot tenant satisfaction by building');
  assert.equal((t.result as { unknown?: boolean }).unknown, true);
  assert.doesNotMatch(t.answer, /chart isn't available/);
});

test('chat path: askFlowIqCopilot gives the same table plus the chart line', async () => {
  const { askFlowIqCopilot } = await import('../src/agent/copilot.ts');
  const t = await askFlowIqCopilot('Plot cost per lead by marketing source at Kedzie Works in Q3 2026');
  assert.match(t.envelope.answer, /\| Facebook Ads \| 118\.12 \|/);
  assert.ok(t.envelope.answer.endsWith(CHART_NOT_AVAILABLE));
});
