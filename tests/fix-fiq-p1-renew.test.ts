import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { deterministicTurn } from '../src/agent/copilot.ts';

// FIX-FIQ-P1 (b): "renew this year" counts leases up for renewal (ending in calendar 2026), not every lease.
const store = loadPortfolioStore();
const ask = (q: string) => deterministicTurn({ id: 'ADHOC', question: q } as never, store).answer;
const csv = readFileSync(fileURLToPath(new URL('../data/pms/leases.csv', import.meta.url)), 'utf8').trim().split(/\r?\n/);
const endIdx = csv[0].split(',').indexOf('end_date');
const ending2026 = csv.slice(1).filter((l) => l.split(',')[endIdx].startsWith('2026')).length;

for (const q of ['How many leases renew this year?', 'How many leases renew in 2026?']) {
  test(`renewals: ${q} counts leases ending in 2026`, () => {
    const a = ask(q);
    assert.match(a, new RegExp(`there are ${ending2026} leases`));
    assert.doesNotMatch(a, /\b1033\b/);
  });
}
