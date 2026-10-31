import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseQueryIntent } from '../src/agent/intent.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

const store = loadPortfolioStore();

const label = (q: string) => (parseQueryIntent(q, store) as { dateWindow?: { key?: string } | null }).dateWindow?.key ?? null;

for (const q of ['Which vendors cost more than $2000?', 'Show expenses over $2025', 'Any invoices above 2000 dollars?', 'spend over USD 2024', 'invoices over $2,024.50', 'budget over 2024k']) {
  test(`money is not a year: ${q}`, () => assert.ok(!/^YEAR_20\d{2}$/.test(String(label(q))), String(label(q))));
}
for (const [q, y] of [['What was marketing spend in 2024?', 'YEAR_2024'], ['Leases signed during 2023', 'YEAR_2023']]) {
  test(`a bare year is still a year: ${q}`, () => assert.equal(label(q), y));
}
