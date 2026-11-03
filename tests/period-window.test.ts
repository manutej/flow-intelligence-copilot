import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveDateWindow, UnresolvedPeriodError } from '../src/domain/metrics.ts';
import { executeAgentTool } from '../src/agent/tools.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

// The MCP audit's periods: each resolves to its own window or raises,
// never to the April to September 2026 default.
test('a period resolves to the window it names', () => {
  for (const [p, start, end] of [
    ['2026Q3', '2026-07-01', '2026-09-30'], ['2026Q1', '2026-01-01', '2026-03-31'], ['2025Q4', '2025-10-01', '2025-12-31'],
    ['Q2 2025', '2025-04-01', '2025-06-30'], ['August 2026', '2026-08-01', '2026-08-31'], ['2026-08', '2026-08-01', '2026-08-31'],
    ['H1 2026', '2026-01-01', '2026-06-30'], ['Apr-Sep 2026', '2026-04-01', '2026-09-30'],
  ] as const) {
    const w = resolveDateWindow({ period: p });
    assert.deepEqual([w.startDate, w.endDate], [start, end], p);
  }
});

test('a period that names no exact window raises', () => {
  for (const p of ['last month', 'bogus', 'q2', 'H3 2026', '2026-13', 'this quarter']) {
    assert.throws(() => resolveDateWindow({ period: p }), UnresolvedPeriodError, p);
  }
});

test('the marketing tool never answers an unresolved period with default numbers', () => {
  const store = loadPortfolioStore();
  assert.throws(() => executeAgentTool(store, 'query_marketing_spend_and_funnel', { period: 'last month' }), UnresolvedPeriodError);
});
