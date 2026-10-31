import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

// A ranking cue with a dimension noun is never one pooled figure. Wordings are new.
const store = loadPortfolioStore();
const ask = async (q: string) => (await askFlowIqCopilot(q, { store, parse: null })).envelope;

for (const q of [
  'Of all our communities, which ones posted the lowest renewal rate in 2026?',
  'Top 4 bldgs by renewal rate for 2026?',
  'Rank the channels on cost per lead for Q2 2026',
  'List all properties with their renewal rate in 2026',
  'Renewal rate per bldg in 2026?',
  'Marketing spend per lead at Marlowe in Q2 2026?',
]) {
  test(`a ranking or ratio cue is not a pooled scalar: ${q}`, async () => {
    const e = await ask(q);
    const r = e.result as Record<string, unknown>;
    const pooled = r.unknown !== true && r.clarification_needed !== true && !/\n|;/.test(e.answer) && /matching|across the matching/.test(e.answer);
    assert.ok(!pooled, `pooled scalar: ${e.answer}`);
  });
}
