import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import askHandler from '../api/ask.js';
import { setRateSource, resetRateSource } from '../src/tools/fx-rate.ts';
import { NO_LIVE_RATE_NOTE } from '../src/agent/live-cad.ts';

// M-3: chat uses the live, dated CAD rate; with none it says so.
after(() => resetRateSource());
async function ask(question: string, extra: Record<string, unknown> = {}) {
  let out = '';
  const res = { statusCode: 0, setHeader() {}, end(s: string) { out = s; } };
  await askHandler({ method: 'POST', body: { question, ...extra }, headers: {}, url: '/api/ask' } as never, res as never);
  return JSON.parse(out) as { answer: string; cadRate: { rate: number; date: string; status: string } };
}
const Q = 'Spend at Kedzie Works in Q3 2026?';

test('live rate: answer uses it and states its date', async () => {
  setRateSource(async () => ({ rate: 0.7, rate_date: '2026-11-02', source: 'stub' }));
  const r = await ask(Q);
  assert.equal(r.cadRate.status, 'live');
  assert.match(r.answer, /1 CAD = 0\.7 USD \(stub, live, 2026-11-02\)/);
  assert.ok(!r.answer.includes(NO_LIVE_RATE_NOTE));
});

test('no live rate: the answer says so and names the pinned dated rate', async () => {
  setRateSource(async () => null);
  const r = await ask(Q);
  assert.equal(r.cadRate.status, 'unavailable');
  assert.ok(r.answer.endsWith(NO_LIVE_RATE_NOTE));
  assert.match(r.answer, /2026-10-31/);
});

test('a what-if rate wins over the live rate', async () => {
  setRateSource(async () => ({ rate: 0.7, rate_date: '2026-11-02', source: 'stub' }));
  const r = await ask(Q, { policy: { cadToUsdRate: 0.8 } });
  assert.equal(r.cadRate.status, 'override');
  assert.equal(r.cadRate.rate, 0.8);
});
