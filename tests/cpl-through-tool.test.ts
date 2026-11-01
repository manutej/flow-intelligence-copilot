import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { deterministicTurn } from '../src/agent/copilot.ts';
import { costPerLead } from '../src/tools/cost-per-lead.ts';
import { queryMarketingSpendAndFunnel } from '../src/domain/metrics.ts';

// Phase 1b item 4: the planner's pooled / paid-only / overall CPL is the cost_per_lead tool's figure.
const store = loadPortfolioStore();
const Q3 = { start_date: '2026-07-01', end_date: '2026-09-30' };
const usd = (q: string) => (deterministicTurn({ id: 'ADHOC', question: q } as never, store).result as { usd?: number }).usd;

test('planner CPL paths equal the tool', () => {
  assert.equal(usd('Cost per lead at Kedzie Works in Q3 2026?'), costPerLead(store, { property_id: 'P06', ...Q3 }).value?.cpl_usd);
  assert.equal(usd('Cost per lead for paid sources at Kedzie Works in Q3 2026?'), costPerLead(store, { property_ids: ['P06'], sources: store.paidSources, paid_leads_only: true, ...Q3 }).value?.cpl_usd);
  assert.equal(usd('Cost per lead from Zillow and Apartments.com at Kedzie Works in Q3 2026?'), costPerLead(store, { property_ids: ['P06'], sources: ['Zillow', 'Apartments.com'], ...Q3 }).value?.cpl_usd);
  assert.equal(usd('Cost per lead in Q3 2026?'), costPerLead(store, Q3).value?.cpl_usd);
});

test('tool: several buildings and a bedroom filter match the funnel totals', () => {
  for (const filter of [{ propertyIds: ['P06', 'P08'] }, { propertyIds: ['P06'], bedroomsWanted: 2 }]) {
    const m = queryMarketingSpendAndFunnel(store, { ...filter, startDate: Q3.start_date, endDate: Q3.end_date, period: 'Q3 2026' } as never);
    const t = costPerLead(store, { property_ids: filter.propertyIds, bedrooms_wanted: (filter as { bedroomsWanted?: number }).bedroomsWanted, ...Q3 }).value!;
    assert.equal(t.unique_leads, m.totalLeadsCreated, JSON.stringify(filter));
    assert.ok(Math.abs(t.spend_usd - m.totalSpendUsd) < 0.02, JSON.stringify(filter));
  }
});
