import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { costPerLead, COST_PER_LEAD_DESCRIPTION } from '../src/tools/cost-per-lead.ts';
import { POLICY_RULES_OFF } from '../src/config/rules.ts';
import { spendUsd, usd, usdRe, round2, cpl, FX } from './fixtures/fx-expect.ts';
// Every CAD row (P06 and P07 Facebook Ads) sits in a dead pair, so the kit figure moves by the whole CAD delta.
const DEAD_USD = round2(46599.9 - spendUsd({}, 0.73) + spendUsd({}));
const YTD_USD = spendUsd({from:'2026-01',to:'2026-09'});

const store = loadPortfolioStore();
// Truth values: drafts/flowiq-tools/checks/values.json at the kit rate 0.73.
const KIT: Record<string, number> = { P01: 170.17, P02: 148.07, P03: 156.36, P04: 129.9, P05: 128.13, P06: cpl(spendUsd({ pid: 'P06' }), 158), P07: cpl(spendUsd({ pid: 'P07' }), Math.round(spendUsd({ pid: 'P07' }, 0.73) / 147.37)), P08: 153.48 };

test('cost_per_lead: portfolio CPL (fixture rate) over 1,489 unique leads, 9 removed', () => {
  const r = costPerLead(store);
  assert.equal(r.value?.cpl_usd, cpl(YTD_USD, 1489));
  assert.equal(r.value?.unique_leads, 1489);
  assert.equal(r.value?.duplicates_removed, 9);
  assert.equal(r.value?.spend_usd, YTD_USD);
  assert.deepEqual(r.dedup, { key: 'lease_id', kept: 'earliest' });
  assert.equal(r.period?.label, '2026-04-01 to 2026-09-30');
  assert.equal(r.fx?.applied, true);
});

test('cost_per_lead: every operating building matches the kit truth', () => {
  for (const [pid, v] of Object.entries(KIT)) assert.equal(costPerLead(store, { property_id: pid }).value?.cpl_usd, v, pid);
});

test('cost_per_lead: by source uses that source; free source is null', () => {
  assert.equal(costPerLead(store, { source: 'Zillow' }).value?.cpl_usd, 262.34);
  assert.equal(costPerLead(store, { source: 'Facebook Ads' }).value?.cpl_usd, cpl(spendUsd({ sources: ['Facebook Ads'] }), 119));
  const organic = store.organicSources[0];
  if (organic) assert.equal(costPerLead(store, { source: organic }).value?.cpl_usd, null);
});

test('cost_per_lead: no policy preset turns lead dedup off (M-2)', () => {
  assert.notEqual(POLICY_RULES_OFF.deduplicateLeads, false);
  assert.match(COST_PER_LEAD_DESCRIPTION, /Do NOT use/);
});
