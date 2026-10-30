import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { typedQuery } from '../src/agent/recompute.ts';
import { executeCompositionalPlan } from '../src/agent/planner.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { verifyAnswerEnvelope } from '../src/domain/guards.ts';

const store = loadPortfolioStore();
const SP = ['properties:P05', 'spend:S0101', 'spend:S0102', 'spend:S0103'];
const V6 = ['properties:P06', 'units:U0691', 'units:U0693', 'units:U0700', 'units:U0707', 'units:U0726'];
const VAC = typedQuery('How many vacant units are at Kedzie Works?', store);
const SPEND = typedQuery('How much was total posted marketing spend at Armitage Commons?', store);
const ok = (answer: string, result: Record<string, unknown>, citations = V6, query = VAC) =>
  verifyAnswerEnvelope({ id: 'X', answer, result, citations: citations as never, query }, store).valid;

describe('L3: every figure is the exact recompute of the typed query (TENACITY three-layer)', () => {
  it('S2: keeps only the template render; a true figure reworded is not a render', () => {
    const real = executeCompositionalPlan({ id: 'X', type: 'adhoc', question: SPEND.question }, store, { verify: false }).envelope;
    assert.ok(verifyAnswerEnvelope(real, store).valid);
    assert.equal(verifyAnswerEnvelope({ ...real, answer: real.answer.replace(/\.$/, '!') }, store).valid, false);
  });
  it('rejects spend x10 and +$1', () => {
    assert.equal(ok('Total posted marketing spend was $123,000.00 USD.', { usd: 123000 }, SP, SPEND), false);
    assert.equal(ok('Total posted marketing spend was $12,301.00 USD.', { usd: 12301 }, SP, SPEND), false);
  });
  it('rejects undercounts and reworded forgeries', () => {
    assert.equal(ok('Kedzie Works (P06) has 13 vacant units.', { count: 13 }), false);
    assert.equal(ok('There are 99 vacant units at Kedzie Works (P06).', { count: 99 }), false);
    assert.equal(ok('Kedzie Works (P06): 110 units are vacant.', { count: 110 }), false);
  });
  it('rejects arithmetic and outside figures', () => {
    assert.equal(ok('Kedzie Works (P06) has 14 vacant units, 28 expected next month.', { count: 14 }), false);
    assert.equal(ok('Kedzie Works (P06) has 14 vacant units; comparable units list at $4,000 on Zillow.', { count: 14 }), false);
  });
  it('rejects a figure with no typed query, and a query that lies about its intent', () => {
    assert.equal(verifyAnswerEnvelope({ id: 'X', answer: 'Kedzie Works (P06) has 14 vacant units.', result: { count: 14 }, citations: V6 as never }, store).valid, false);
    assert.equal(ok('Kedzie Works (P06) has 14 vacant units.', { count: 14 }, V6, { ...VAC, intent: { ...VAC.intent!, unitStatus: 'occupied' } }), false);
  });
});

describe('L3: stated names, ids, totals, dates and citations bind to the recompute (S0b F-054, F-059)', () => {
  const real = executeCompositionalPlan({ id: 'X', type: 'adhoc', question: VAC.question }, store, { verify: false }).envelope;
  const forged = (answer: string, citations = real.citations) =>
    verifyAnswerEnvelope({ ...real, answer, citations: citations as never }, store).valid;
  it('keeps the real envelope', () => assert.ok(forged(real.answer)));
  it('rejects a swapped building name, id, total or date', () => {
    assert.equal(forged(real.answer.replace('Kedzie Works', 'Marlowe Residences')), false);
    assert.equal(forged(real.answer.replace('P06', 'P60')), false);
    assert.equal(forged(real.answer.replace(/(\d+) total/, '$10 total')), false);
    assert.equal(forged(`${real.answer} As of 2026-12-31.`), false);
  });
  it('rejects an answer whose citations were dropped', () => {
    assert.equal(forged(real.answer, real.citations.filter((c) => c.startsWith('properties:'))), false);
  });
});
