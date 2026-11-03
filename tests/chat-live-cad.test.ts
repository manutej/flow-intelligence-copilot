import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import askHandler from '../api/ask.js';
import { setRateSource, resetRateSource } from '../src/tools/fx-rate.ts';
import { NO_LIVE_RATE_NOTE } from '../src/agent/live-cad.ts';

// D-24: chat uses the fixed rate by default; FLOWIQ_LIVE_FX=1 opts in to the live rate (with none, it says so).
after(() => { resetRateSource(); delete process.env.FLOWIQ_LIVE_FX; });
async function ask(question: string, extra: Record<string, unknown> = {}) {
  let out = '';
  const res = { statusCode: 0, setHeader() {}, end(s: string) { out = s; } };
  await askHandler({ method: 'POST', body: { question, ...extra }, headers: {}, url: '/api/ask' } as never, res as never);
  return JSON.parse(out) as { answer: string; cadRate: { rate: number; date: string; status: string } };
}
const Q = 'Spend at Kedzie Works in Q3 2026?';

test('default (flag off): fixed rate, labelled, even when a live rate exists', async () => {
  delete process.env.FLOWIQ_LIVE_FX;
  setRateSource(async () => ({ rate: 0.7, rate_date: '2026-11-02', source: 'stub' }));
  const r = await ask(Q);
  assert.equal(r.cadRate.status, 'fixed');
  assert.match(r.answer, /1 CAD = 0\.71588 USD \(fixed rate, 2026-10-31\)/);
});

test('FLOWIQ_LIVE_FX=1: answer uses the live rate and states its date', async () => {
  process.env.FLOWIQ_LIVE_FX = '1';
  setRateSource(async () => ({ rate: 0.7, rate_date: '2026-11-02', source: 'stub' }));
  const r = await ask(Q);
  assert.equal(r.cadRate.status, 'live');
  assert.match(r.answer, /1 CAD = 0\.7 USD \(stub, live, 2026-11-02\)/);
  assert.ok(!r.answer.includes(NO_LIVE_RATE_NOTE));
});

test('FLOWIQ_LIVE_FX=1 with no live rate: the answer says so and names the fixed dated rate', async () => {
  process.env.FLOWIQ_LIVE_FX = '1';
  setRateSource(async () => null);
  const r = await ask(Q);
  assert.equal(r.cadRate.status, 'unavailable');
  assert.ok(r.answer.endsWith(NO_LIVE_RATE_NOTE));
  assert.match(r.answer, /2026-10-31/);
});

test('a what-if rate wins over the live rate', async () => {
  process.env.FLOWIQ_LIVE_FX = '1';
  setRateSource(async () => ({ rate: 0.7, rate_date: '2026-11-02', source: 'stub' }));
  const r = await ask(Q, { policy: { cadToUsdRate: 0.8 } });
  assert.equal(r.cadRate.status, 'override');
  assert.equal(r.cadRate.rate, 0.8);
});
