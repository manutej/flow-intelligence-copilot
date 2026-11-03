import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { revenue, termMonths, REVENUE_DESCRIPTION } from '../src/tools/revenue.ts';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';

const store = loadPortfolioStore();

test('revenue: rent roll $2,558,235, loss to vacancy $168,995 (truth)', () => {
  const v = revenue(store).value!;
  assert.equal(v.rent_roll_monthly, 2558235);
  assert.equal(v.loss_to_vacancy_monthly, 168995);
  assert.equal(v.effective_rent_monthly, 2550922.5);
  assert.equal(v.label, 'monthly, as of 2026-10-01');
});

test('revenue: per building matches truth (P01 effective 345,495; P03 rent roll 311,270)', () => {
  assert.equal(revenue(store, { property_id: 'P01' }).value?.effective_rent_monthly, 345495);
  assert.equal(revenue(store, { property_id: 'P03' }).value?.rent_roll_monthly, 311270);
  assert.equal(revenue(store, { property_id: 'P09' }).unknown, true);
  assert.equal(termMonths('2026-05-01', '2027-04-30'), 12);
  assert.equal(termMonths('2026-05-04', '2027-05-03'), 12);
  assert.match(REVENUE_DESCRIPTION, /Do NOT use for NOI/);
});

test('copilot: rent roll / loss to vacancy answer from the tool; filtered asks fall through', async () => {
  const ask = async (q: string) => (await askFlowIqCopilot(q, { store, parse: null } as never)).envelope;
  assert.equal((await ask('What is our rent roll?')).result.rent_roll_usd, 2558235);
  assert.equal((await ask('What is loss to vacancy?')).result.loss_to_vacancy_usd, 168995);
  assert.equal((await ask('Rent roll for 2 bedroom units?')).result.unknown, true);
});
