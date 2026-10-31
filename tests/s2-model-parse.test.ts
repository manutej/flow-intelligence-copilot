import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { DEFAULT_GRAMMAR, coverage, modelParse, toIntent, type ParseConfig } from '../src/agent/model-parse.ts';
import { parseQueryIntent } from '../src/agent/intent.ts';
import { RunStore } from '../src/agent/run-store.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { verifyAnswerEnvelope } from '../src/domain/guards.ts';

// S2-L1 model path against a recorded endpoint: no network in tests.
const store = loadPortfolioStore();
const cfg: ParseConfig = { baseUrl: 'http://mock/v1', model: 'mock', timeoutMs: 200, backend: 'llama', quant: 'q4', grammarPath: DEFAULT_GRAMMAR, cache: false };

/** The model "answers" with the TypedQuery the deterministic parser would emit, edited by `edit`. */
function replay(edit: (i: Record<string, unknown>) => Record<string, unknown> = (i) => i, sent: unknown[] = []) {
  return async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { messages: Array<{ content: string }> };
    sent.push(body);
    const q = body.messages[1].content;
    const det = parseQueryIntent(q, store) as unknown as Record<string, unknown>;
    const intent = edit({ ...det, dateWindow: (det.dateWindow as { key: string }).key });
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ kind: 'query', question: q, intent }) } }] }) };
  };
}
const ask = (q: string, fetch: unknown, runStore: RunStore | null = null) => askFlowIqCopilot(q, { store, parse: cfg, parseDeps: { fetch: fetch as never, runStore } });

describe('S2-L1: model parse under the grammar', () => {
  it('sends the GBNF in the grammar field (llama-server) and a JSON schema for Ollama', async () => {
    const sent: Array<Record<string, unknown>> = [];
    await modelParse('How many vacant units are at Kedzie Works?', store, cfg, { fetch: replay(undefined, sent) as never, runStore: null });
    assert.equal(sent[0].grammar, fs.readFileSync(DEFAULT_GRAMMAR, 'utf8'));
    assert.equal(sent[0].temperature, 0);
    await modelParse('How many vacant units are at Kedzie Works?', store, { ...cfg, backend: 'ollama' }, { fetch: replay(undefined, sent) as never, runStore: null });
    assert.equal(sent[1].grammar, undefined);
    assert.equal((sent[1].response_format as { type: string }).type, 'json_schema');
  });
  it('answers from a valid, covering model query, and the answer verifies', async () => {
    const r = await ask('How many vacant units are at Kedzie Works?', replay());
    assert.equal(r.parsePath, 'model');
    assert.equal(r.envelope.result.count, 14);
    assert.ok(verifyAnswerEnvelope(r.envelope, store).valid);
    assert.match(r.restatement ?? '', /^I computed: /);
  });
  it('a model that drops a stated filter is never answered on its reading: the turn is the model-off turn', async () => {
    const q = 'How many vacant two-bedroom units are at Kedzie Works?';
    const r = await ask(q, replay(({ bedrooms: _b, ...i }) => i));
    const off = await askFlowIqCopilot(q, { store, parse: null });
    assert.equal(r.parsePath, 'deterministic');
    assert.notEqual(r.envelope.result.count, 14);
    assert.deepEqual(r.envelope, off.envelope);
  });
  it('a model reading that differs in a stated field still clarifies with typed options', async () => {
    const r = await ask('How many vacant units are at Kedzie Works?', replay((i) => ({ ...i, unitStatus: 'occupied' })));
    assert.equal(r.parsePath, 'model-clarify');
    assert.equal(r.envelope.result.clarification_needed, true);
    for (const o of r.clarifyOptions ?? []) assert.ok(o.query, 'each option carries a typed query');
  });
  it('a model that invents a filter no word states gets the model-off turn', async () => {
    const q = 'How many vacant units are at Kedzie Works?';
    const r = await ask(q, replay((i) => ({ ...i, buildingClass: 'A', topK: 10 })));
    assert.deepEqual(r.envelope, (await askFlowIqCopilot(q, { store, parse: null })).envelope);
  });
  for (const [name, content] of [
    ['garbage', '{"kind":"query","intent":{"domain":"nope"}}'],
    ['not JSON', 'sorry, I cannot'],
    ['kind=clarify', '<think>\n\n</think>\n\n{"kind":"clarify","options":["a?","b?"]}'],
    ['kind=draft', '{"kind":"draft","request":"write a listing"}'],
    ['unitStatus inside unitStatusIn', null],
  ] as const) {
    it(`model ${name} gives exactly the model-off result`, async () => {
      for (const q of ['How many vacant units are at Kedzie Works?', 'Which building has the most vacant units?', 'What was total marketing spend in Q2 2026?', 'Write a listing that avoids families with kids.']) {
        const fetch = content !== null
          ? async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) })
          : replay((i) => ({ ...i, unitStatus: 'occupied', unitStatusIn: ['occupied', 'vacant'] }));
        const r = await ask(q, fetch);
        const off = await askFlowIqCopilot(q, { store, parse: null });
        assert.deepEqual(r.envelope, off.envelope, q);
      }
    });
  }
  it('a model that adds a filter the question does not state is unbound', () => {
    const q = 'How many vacant units are at Kedzie Works?';
    const det = parseQueryIntent(q, store);
    assert.equal(coverage(q, { ...det, floorMin: 3 }, det, store).ok, false);
  });
  it('rejects off-schema output: unknown fields, out-of-list measure, protected fields, min > max', () => {
    const base = { kind: 'query', question: 'q', intent: { domain: 'units', measure: 'unit_count', aggregation: 'value', isWholePortfolioExplicit: false, isClassComparison: false, dateWindow: 'APR_SEP_2026', dateExplicit: false, mentionedSources: [], paidOnly: false, decisionIds: [] } };
    assert.equal(typeof toIntent(base), 'object');
    assert.equal(typeof toIntent({ ...base, intent: { ...base.intent, familialStatus: 'none' } }), 'string');
    assert.equal(typeof toIntent({ ...base, intent: { ...base.intent, measure: 'unsupported' } }), 'string');
    assert.equal(typeof toIntent({ ...base, intent: { ...base.intent, sqftMin: 900, sqftMax: 600 } }), 'string');
    assert.equal(typeof toIntent({ ...base, intent: { ...base.intent, dateWindow: 'LAST_MONTH' } }), 'string');
    assert.equal(typeof toIntent({ kind: 'clarify', options: ['a', 'b'] }), 'string');
  });
  it('falls back to the deterministic parser when the model is down or slow, and records why', async () => {
    const down = async () => { throw new Error('ECONNREFUSED'); };
    const r = await ask('How many vacant units are at Kedzie Works?', down);
    assert.equal(r.parsePath, 'deterministic');
    assert.match(r.parseFallbackReason ?? '', /unavailable/);
    assert.equal(r.envelope.result.count, 14);
    const slow = (_u: string, init: { signal: AbortSignal }) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('t'), { name: 'TimeoutError' }))));
    const s = await ask('How many vacant units are at Kedzie Works?', slow);
    assert.match(s.parseFallbackReason ?? '', /timeout/);
    const junk = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'not json' } }] }) });
    assert.equal((await ask('How many vacant units are at Kedzie Works?', junk)).parsePath, 'deterministic');
  });
  it('off by default: no FLOWIQ_PARSE_URL means no model call', async () => {
    const r = await askFlowIqCopilot('How many vacant units are at Kedzie Works?', { store });
    assert.equal(r.parsePath, undefined);
  });
});

describe('S2 run memory', () => {
  it('stores each parse once and serves a hit without a model call', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's2-runs-'));
    const runs = await RunStore.open(dir);
    const sent: unknown[] = [];
    const c = { ...cfg, cache: true };
    const a = await modelParse('How many vacant units are at Kedzie Works?', store, c, { fetch: replay(undefined, sent) as never, runStore: runs });
    const b = await modelParse('how many  VACANT units are at Kedzie Works?', store, c, { fetch: replay(undefined, sent) as never, runStore: runs });
    assert.equal(sent.length, 1);
    assert.equal(b.cacheHit, true);
    assert.deepEqual(b.intent, a.intent);
    await modelParse('How many vacant units are at Kedzie Works?', store, { ...c, cache: false }, { fetch: replay(undefined, sent) as never, runStore: runs });
    assert.equal(sent.length, 2, '--no-cache always calls the model');
    assert.ok(fs.readFileSync(path.join(dir, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).length >= 2);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'runs.jsonl'), 'utf8'), /sk-or-|U0\d{3},/);
    fs.rmSync(dir, { recursive: true });
  });
});
