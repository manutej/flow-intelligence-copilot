/**
 * TENACITY S2 verdict (ce875c5) repros, as tests: each failed on ce875c5.
 * F2: a model intent that differs from the lexicon reading in a field the
 * old coverage did not compare (period, scope) was executed and verified.
 * F3: a coherent forgery (another question's render, resealed) verified.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { sealProof } from '../src/agent/envelope.ts';
import { parseConfigFromEnv } from '../src/agent/model-parse.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { verifyAnswerEnvelope } from '../src/domain/guards.ts';

const store = loadPortfolioStore();
const parse = parseConfigFromEnv({ FLOWIQ_PARSE_URL: 'http://stub.invalid/v1', FLOWIQ_PARSE_NO_CACHE: '1' });
const stub = (reply: unknown) => ({
  runStore: null,
  fetch: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(reply) } }] }) }),
});
const dwKey = (i: any) => i.dateWindow?.key ?? i.dateWindow?.id;

async function mutated(q: string, m: (det: any) => Record<string, unknown>) {
  const det = (await askFlowIqCopilot(q, { store, parse: null })).envelope as any;
  const i = det.query.intent;
  const reply = { kind: 'query', question: q, intent: { ...i, dateWindow: dwKey(i), ...m(i) } };
  const t = await askFlowIqCopilot(q, { store, parse, parseDeps: stub(reply) } as never);
  return { det, t };
}

test('F2: a model period swap is not answered (Q2 question, Q3 intent)', async () => {
  const { det, t } = await mutated('What was total marketing spend in Q2 2026?', () => ({ dateWindow: 'Q3_2026' }));
  assert.match(det.answer, /112,706\.60/);
  assert.doesNotMatch(t.envelope.answer, /111,893\.30/);
  assert.notEqual(t.parsePath, 'model');
});

test('F2: a model scope flip is not answered', async () => {
  const { t } = await mutated('How many units are vacant at Fulton Yards?', (i) => ({ isWholePortfolioExplicit: !i.isWholePortfolioExplicit }));
  assert.notEqual(t.parsePath, 'model');
});

test('F2: measure, paidOnly and period mutations never reach path=model', async () => {
  for (const q of ['What was total marketing spend in Q2 2026?', 'What is the cost per lead for Zillow in Q3 2026?']) {
    for (const m of [{ measure: 'lead_count' }, { paidOnly: true }, { dateWindow: 'H1_2026' }]) {
      const { det, t } = await mutated(q, () => m);
      const same = JSON.stringify((det.query.intent as any)[Object.keys(m)[0]]) === JSON.stringify(Object.values(m)[0]);
      if (!same) assert.notEqual(t.parsePath, 'model', `${q} ${JSON.stringify(m)}`);
    }
  }
});

test("F3: another question's render resealed under this question is rejected", async () => {
  const a = (await askFlowIqCopilot('What was total marketing spend in Q2 2026?', { store, parse: null })).envelope as any;
  const b = (await askFlowIqCopilot('What was total marketing spend in Q3 2026?', { store, parse: null })).envelope as any;
  const q = { ...b.query, question: a.query.question };
  const resealed = { ...b, id: a.id, query: q, proof: sealProof(q, b.result, b.proof.row_ids) };
  assert.equal(verifyAnswerEnvelope(resealed, store).valid, false);
  assert.equal(verifyAnswerEnvelope(a, store).valid, true);
});
