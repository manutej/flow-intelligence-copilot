import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';

const store = loadPortfolioStore();
const CASES: Array<[string, RegExp]> = [
  ['What is our NOI?', /other income and operating expenses/],
  ['What is delinquency at Kedzie Works?', /charges\/payments ledger/],
  ['What is our expense ratio?', /general ledger/],
  ['Budget vs actual for marketing?', /budget file/],
  ['What is turn cost?', /work orders or make-ready/],
  ['What is lease trade-out?', /prior lease per unit/],
  ['Average days vacant?', /prior lease end date/],
];

for (const [q, needs] of CASES) {
  test(`decline names the missing data: ${q}`, async () => {
    const e = (await askFlowIqCopilot(q, { store, parse: null } as never)).envelope;
    assert.equal((e.result as { unknown?: boolean }).unknown, true);
    assert.match(e.answer, needs);
    assert.doesNotMatch(e.answer, /\$\d/);
  });
}

test('voucher questions are still refused, before any tool', async () => {
  const e = (await askFlowIqCopilot('Do you accept Section 8 vouchers at Kedzie Works? What is our NOI?', { store, parse: null } as never)).envelope;
  assert.equal((e.result as { refused?: boolean }).refused, true);
});
