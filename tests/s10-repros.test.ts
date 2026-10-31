import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

// TENACITY's s10 rows (VERDICT-S2-b71b6e8) plus rewordings written at
// 2026-10-31 02:11 CST against b71b6e8, before any s10 fix ran.
const store = loadPortfolioStore();
const ask = async (q: string) => (await askFlowIqCopilot(q, { store, parse: null })).envelope;
const r = (e: { result: unknown }) => e.result as Record<string, unknown>;
const refused = (e: { result: unknown }) => r(e).unknown === true || r(e).clarification_needed === true;

// Pooled truths from repros/s10-probes.ts.
for (const [q, want] of [
  ['Tour to lease rate at Kedzie Works in Q3 2026?', /33\.3%/],
  ['Tour to lease rate in Q3 2026?', /28\.7%/],
  ['Cost per lead at Kedzie Works in Q3 2026?', /\$159\.34/],
  ['Marketing spend July and August 2026?', /\$73,301\.60/],
  ['How many leads in Q2 2026 at Marlowe Residences?', /\b139\b/],
  ['Spend at FY in Q2 2026?', /Fulton Yards \(P03\)/],
] as const) {
  test(`s10: answers: ${q}`, async () => {
    const e = await ask(q);
    assert.ok(!refused(e), e.answer);
    assert.match(e.answer, want);
  });
}
for (const q of [
  // VERDICT-S2-d1091cb finding 5: an unranked which names no source.
  'Cost per signed lease, which channel, Kedzie Works Q3 2026?',
  // s10 rows.
  'Tour to lease rate and leads at Kedzie Works in Q3 2026?', 'Cost per lead over tours at Kedzie Works in Q3 2026?',
  'Spend, leads at Kedzie Works in Q3 2026?', 'Spend : leads at Kedzie Works in Q3 2026?', 'Spend over signings at Kedzie Works in Q3 2026?',
  'Spend over leads that toured at Kedzie Works in Q3 2026?', 'How many leads toured and applied at Kedzie Works in Q3 2026?',
  'Leads that toured and leased at Kedzie Works in Q3 2026?', 'Marketing spend in Q2 and Q3 2026?',
  'How many leads and how many leases at Kedzie Works in Q3 2026?', 'Spend at F.Y. in Q3 2026?',
  // Own rewordings (02:11 file).
  'Spend at F.Y. in Q2 2026?', 'Spend at f.y in Q2 2026?', 'Spend; leads at Marlowe Residences in Q2 2026?',
  'Marketing spend alongside tours at Marlowe Residences in Q2 2026?', 'Spend over lease signings at Marlowe Residences in Q2 2026?',
  'Cost per lead plus tours at Marlowe Residences in Q2 2026?', 'Tour to lease rate with applications at Marlowe Residences in Q2 2026?',
  'Marketing spend for Q2 plus Q3 2026?', 'Marketing spend in April and July 2026?', 'Lead count at Marlowe Residences in Q2 and Q3 2026?',
  'Leads that applied and toured at Marlowe Residences in Q2 2026?', 'Lead count and lease count at Marlowe Residences in Q2 2026?',
]) {
  test(`s10: not one figure: ${q}`, async () => {
    const e = await ask(q);
    assert.ok(refused(e), `answered: ${e.answer}`);
  });
}
test('s10: an unranked cost per tour does not name one source', async () => {
  const e = await ask('Cost per tour at Kedzie Works in Q3 2026?');
  assert.ok(refused(e), e.answer);
});
