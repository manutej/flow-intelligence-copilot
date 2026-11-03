import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { deterministicTurn, askFlowIqCopilot, ILS_LABEL } from '../src/agent/copilot.ts';

// Phase 1b item 3 (M-10): CPL "from ILS" is all paid sources, labelled as such.
const store = loadPortfolioStore();
const det = (q: string) => deterministicTurn({ id: 'ADHOC', question: q } as never, store);
const label = ILS_LABEL.replace(/\.$/, '');

test('CPL from ILS: same figure as all paid sources, with the label', async () => {
  const ils = det('Cost per lead from ILS at Kedzie Works in Q3 2026?');
  const paid = det('Cost per lead for paid sources at Kedzie Works in Q3 2026?');
  assert.deepEqual(ils.result, paid.result);
  assert.ok(ils.answer.includes(label));
  assert.ok(!paid.answer.includes(label));
  assert.ok((await askFlowIqCopilot('Cost per lead from ILS at Kedzie Works in Q3 2026?')).envelope.answer.includes(label));
});

test('ILS spend still declines (M-10), without the CPL label', () => {
  const t = det('Marketing spend on ILS sites in Q3 2026?');
  assert.ok(!t.answer.includes(label));
});
