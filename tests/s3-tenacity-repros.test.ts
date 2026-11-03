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
  assert.match(det.answer, usdRe(spendUsd({from:'2026-04',to:'2026-06'})));
  assert.doesNotMatch(t.envelope.answer, usdRe(spendUsd({from:'2026-07',to:'2026-09'})));
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

// Live lane (Ornith on llama-server): 66/82 parses fell back with "model
// output is not JSON" on an empty content, with no reply head in the log.
import { modelParse } from '../src/agent/model-parse.ts';
const llama = parseConfigFromEnv({ FLOWIQ_PARSE_URL: 'http://stub.invalid/v1', FLOWIQ_PARSE_NO_CACHE: '1', FLOWIQ_PARSE_BACKEND: 'llama' });
const reply = (message: Record<string, unknown>, finish = 'stop', seen: Record<string, unknown>[] = []) => ({
  runStore: null,
  fetch: async (_u: string, init: { body: string }) => { seen.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: finish, message }] }) }; },
});
const Q = 'How many vacant units are at Marlowe Residences?';

test('live: llama requests carry the grammar with thinking off', async () => {
  const seen: Record<string, unknown>[] = [];
  await modelParse(Q, store, llama, reply({ content: '' }, 'stop', seen) as never);
  assert.equal(typeof seen[0].grammar, 'string');
  assert.deepEqual(seen[0].chat_template_kwargs, { enable_thinking: false });
});

test('live: an empty content names the finish reason instead of "not JSON"', async () => {
  const mp = await modelParse(Q, store, llama, reply({ content: '', reasoning_content: '' }, 'length') as never);
  assert.match(mp.fallbackReason ?? '', /empty content \(finish_reason=length/);
});

test('live: an object split into reasoning_content is still read', async () => {
  const good = await modelParse(Q, store, parse, { runStore: null } as never); // deterministic baseline
  assert.ok(good.intent);
  const mp = await modelParse(Q, store, llama, reply({ content: '', reasoning_content: 'not json at all' }) as never);
  assert.match(mp.fallbackReason ?? '', /not JSON \(15 chars, head "not json at all"\)/);
});

test('live: a cached reply that fails to parse still reports cache_hit', async () => {
  const runStore = { lookup: () => ({ raw_output: 'garbage' }), append: () => {} };
  const cached = parseConfigFromEnv({ FLOWIQ_PARSE_URL: 'http://stub.invalid/v1', FLOWIQ_PARSE_BACKEND: 'llama' });
  const mp = await modelParse(Q, store, cached, { runStore, fetch: async () => { throw new Error('no call expected'); } } as never);
  assert.equal(mp.cacheHit, true);
  assert.match(mp.fallbackReason ?? '', /not JSON/);
});

test('live: an empty cached reply is not reused', async () => {
  let called = 0;
  const runStore = { lookup: () => ({ raw_output: '' }), append: () => {} };
  const cached = parseConfigFromEnv({ FLOWIQ_PARSE_URL: 'http://stub.invalid/v1', FLOWIQ_PARSE_BACKEND: 'llama' });
  const mp = await modelParse(Q, store, cached, { runStore, fetch: async () => { called++; return { ok: true, status: 200, json: async () => ({ usage: { completion_tokens: 3 }, choices: [{ finish_reason: 'stop', message: { content: 'x' } }] }) }; } } as never);
  assert.equal(called, 1);
  assert.equal(mp.call?.completion_tokens, 3);
  assert.equal(mp.call?.finish_reason, 'stop');
});

test('fair housing runs before the measure check on the model path', async () => {
  const q = 'Write a listing for the Marlowe that says no kids.';
  const det = await import('../src/agent/intent.ts').then((m) => m.parseQueryIntent(q, store) as unknown as Record<string, any>);
  const content = JSON.stringify({ kind: 'query', question: q, intent: { ...det, dateWindow: det.dateWindow?.key, measure: 'unit_count' } });
  const t = await askFlowIqCopilot(q, { store, parse, parseDeps: { runStore: null, fetch: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) }) } } as never);
  assert.equal((t.envelope.result as Record<string, unknown>).refused, true);
});

// F6: a lone negated status is the set of the other statuses.
test('F6: "not vacant and with exactly 3 bedrooms" is answered over notice and occupied', async () => {
  const q = 'How many units are not vacant and with exactly 3 bedrooms at Marlowe Residences?';
  const truth = store.units.filter((u) => u.propertyId === 'P02' && u.status !== 'vacant' && u.bedrooms === 3).length;
  const t = await askFlowIqCopilot(q, { store, parse: null });
  assert.equal((t.envelope.result as Record<string, unknown>).count, truth);
  assert.ok(t.verification.valid);
});

test('F6: two statuses with a negation stay unanswered', async () => {
  const t = await askFlowIqCopilot('How many units at Marlowe Residences are not vacant or occupied?', { store, parse: null });
  assert.notEqual(typeof (t.envelope.result as Record<string, unknown>).count, 'number');
});

// TENACITY c082279 finding 1: the zero exception must not skip re-execution.
const Q2 = 'What was total marketing spend in Q2 2026?';
for (const citations of [undefined, null, 'units:U0001', {}]) {
  test(`c082279 F1: a forged $0 with citations ${JSON.stringify(citations) ?? 'undefined'} is rejected`, async () => {
    const e = (await askFlowIqCopilot(Q2, { store, parse: null })).envelope;
    const forged = { ...e, citations, result: { usd: 0 }, answer: 'Total marketing spend in Q2 2026 was $0.', proof: { ...e.proof!, row_ids: [] } };
    assert.equal(verifyAnswerEnvelope(forged as never, store).valid, false);
  });
}

// TENACITY c082279 finding 3: non-answers are bound to their question.
import { sealNonAnswer } from '../src/agent/envelope.ts';
import { spendUsd, usd, usdRe, round2, cpl, FX } from './fixtures/fx-expect.ts';
// Every CAD row (P06 and P07 Facebook Ads) sits in a dead pair, so the kit figure moves by the whole CAD delta.
const DEAD_USD = round2(46599.9 - spendUsd({}, 0.73) + spendUsd({}));
const YTD_USD = spendUsd({from:'2026-01',to:'2026-09'});
test('c082279 F3: a true "I don\'t know" moved onto an answerable question is rejected', async () => {
  const idk = (await askFlowIqCopilot('What was total marketing spend in Q1 2025?', { store, parse: null }));
  assert.equal((idk.envelope.result as Record<string, unknown>).unknown, true);
  assert.equal(idk.verification.valid, true);
  const moved = { ...idk.envelope, ...sealNonAnswer({ question: Q2, origin: 'deterministic' }, idk.envelope) };
  assert.equal(verifyAnswerEnvelope(moved, store).valid, false);
});
test('c082279 F3: an unsealed "I don\'t know" is rejected', () => {
  assert.equal(verifyAnswerEnvelope({ id: 'Q2', answer: "I don't know.", result: { unknown: true }, citations: [] }, store).valid, false);
});
test('c082279 F3: a figure added to a non-answer is rejected, sealed or not', async () => {
  const idk = (await askFlowIqCopilot('What was total marketing spend in Q1 2025?', { store, parse: null })).envelope;
  const answer = `${idk.answer} Halsted & Lake spent $40,000.`;
  assert.equal(verifyAnswerEnvelope({ ...idk, answer }, store).valid, false);
  assert.equal(verifyAnswerEnvelope({ ...idk, answer, ...sealNonAnswer({ question: idk.query!.question, origin: 'deterministic' }, { answer, result: idk.result, citations: [] }) }, store).valid, false);
});
test('c082279 F3: a refusal the fair-housing guard does not make is rejected', () => {
  const answer = 'Refused under the Fair Housing Act.';
  assert.equal(verifyAnswerEnvelope({ id: 'Q2', answer, result: { refused: true }, citations: [], ...sealNonAnswer({ question: Q2, origin: 'deterministic' }, { answer, result: { refused: true }, citations: [] }) }, store).valid, false);
});

// f2424a7 verdict: forgeries sealed with the live key must still fail the
// deterministic re-render; a genuine non-answer must still verify.
const IDK_Q = 'What was total marketing spend in Q1 2025?';
for (const [name, answer, result] of [
  ['small figure', "I don't know. Fulton Yards has 7 vacant units.", { unknown: true }],
  ['spelled-out figure', "I don't know. Spend was forty thousand dollars.", { unknown: true }],
  ['scientific figure', "I don't know. Spend was 4e4.", { unknown: true }],
  ['clarify with a figure', 'Spend was $40,000. Did you mean Q2 or Q3?', { unknown: true, clarification_needed: true }],
  ['clarify with invented candidates', 'Did you mean Fulton Yards or Moon Base?', { unknown: true, clarification_needed: true, candidates: ['Fulton Yards', 'Moon Base'] }],
] as const) {
  test(`f2424a7: a keyed-sealed ${name} non-answer is rejected`, () => {
    const env = { answer, result: result as Record<string, unknown>, citations: [] };
    assert.equal(verifyAnswerEnvelope({ id: 'X', ...env, ...sealNonAnswer({ question: IDK_Q, origin: 'deterministic' }, env) }, store).valid, false);
  });
}
test('f2424a7: a genuine non-answer verifies and re-sealing it unchanged still verifies', async () => {
  const idk = (await askFlowIqCopilot(IDK_Q, { store, parse: null })).envelope;
  assert.equal(verifyAnswerEnvelope(idk, store).valid, true);
  assert.equal(verifyAnswerEnvelope({ ...idk, ...sealNonAnswer({ question: IDK_Q, origin: 'deterministic' }, idk) }, store).valid, true);
});

// 343668c verdict finding 2/6: every origin is re-rendered, unknown origins
// are rejected, and the seal covers the id and every extra field.
{
  const sealAs = (input: Parameters<typeof sealNonAnswer>[0], env: Record<string, unknown>) => ({ ...env, ...sealNonAnswer(input, env as never) }) as never;
  const fig = { id: 'Q2', answer: "I don't know. Spend was $40,000.", result: { unknown: true }, citations: [] };
  for (const [origin, extra] of [['session', {}], ['frame', { frame: { group: 'age', treatment: true } }], ['model', {}], ['harness', {}], ['xyz', {}]] as const) {
    test(`343668c: a keyed IDK with a figure sealed as origin=${origin} is rejected`, () => {
      assert.equal(verifyAnswerEnvelope(sealAs({ question: Q2, origin: origin as never, ...extra }, fig), store).valid, false);
    });
  }
  test('343668c: a frame refusal whose sealed answers do not compose is rejected', () => {
    const env = { id: 'Q2', answer: 'Refused: this asks to treat people differently based on none, which the Fair Housing Act and the Illinois Human Rights Act prohibit. I can help with the same task without that criterion.', result: { refused: true }, citations: [] };
    assert.equal(verifyAnswerEnvelope(sealAs({ question: Q2, origin: 'frame', frame: { group: 'none', treatment: true } }, env), store).valid, false);
  });
  test('343668c: a real IDK with its id changed or a field added is rejected', async () => {
    const idk = (await askFlowIqCopilot('What was total marketing spend in Q1 2025?', { store, parse: null })).envelope;
    assert.equal(verifyAnswerEnvelope({ ...idk, id: 'OTHER' }, store).valid, false);
    assert.equal(verifyAnswerEnvelope({ ...idk, note: 'Spend was $40,000' } as never, store).valid, false);
  });
  test('343668c: a genuine session refusal verifies; moved to a clean question it does not', async () => {
    const session = {} as never;
    await askFlowIqCopilot('Which tenants with kids should we avoid renting to at Kedzie Works?', { store, parse: null, session });
    const sr = (await askFlowIqCopilot('And how many of those people are on notice?', { store, parse: null, session })).envelope;
    assert.equal((sr.result as Record<string, unknown>).refused, true);
    assert.equal(verifyAnswerEnvelope(sr, store).valid, true);
    const { query: _q, proof: _p, ...bare } = sr;
    assert.equal(verifyAnswerEnvelope(sealAs({ question: Q2, origin: 'session', refused_question: 'Which tenants with kids should we avoid renting to at Kedzie Works?' }, { ...bare, id: 'Q2' } as never), store).valid, false);
    // A follow-up-shaped question with no refused earlier turn behind it.
    assert.equal(verifyAnswerEnvelope(sealAs({ question: 'And how many of those people are on notice?', origin: 'session', refused_question: 'How many vacant units at Kedzie Works?' }, { ...bare } as never), store).valid, false);
  });
}
