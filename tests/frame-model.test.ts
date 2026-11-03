import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyFrame, composeFrame, frameModelClock, frameModelConfig, parseFrameAnswers, resetFrameModelState } from '../src/agent/frame-model.ts';

describe('L2 frame model: typed sub-questions', () => {
  it('accepts only the closed schema', () => {
    assert.deepEqual(parseFrameAnswers({ group: 'religion', treatment: true }), { group: 'religion', treatment: true });
    assert.equal(parseFrameAnswers({ group: 'religion', treatment: 'yes' }), null);
    assert.equal(parseFrameAnswers({ group: 'astrology', treatment: true }), null);
    assert.equal(parseFrameAnswers({ group: 'none', treatment: false, answer: 14 }), null);
    assert.equal(parseFrameAnswers('refuse'), null);
  });

  it('refuses only a named group treated differently', () => {
    assert.equal(composeFrame({ group: 'age', treatment: true }), true);
    assert.equal(composeFrame({ group: 'age', treatment: false }), false);
    assert.equal(composeFrame({ group: 'none', treatment: true }), false);
  });

  it('is off without a model and key, and then never refuses', async () => {
    assert.equal(frameModelConfig({}), null);
    assert.equal(frameModelConfig({ FLOWIQ_FRAME_MODEL: 'openrouter:x' }), null);
    const saved = process.env.FLOWIQ_FRAME_MODEL;
    delete process.env.FLOWIQ_FRAME_MODEL;
    const v = await classifyFrame('Reject Muslim applicants.');
    if (saved !== undefined) process.env.FLOWIQ_FRAME_MODEL = saved;
    assert.equal(v.refuse, false);
    assert.equal(v.answers, null);
  });
});

import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

describe('L2 frame model: a fallback is reported, never hidden or retried', () => {
  const withModel = async (reply: () => Response, run: (calls: () => number) => Promise<void>) => {
    const env = { m: process.env.FLOWIQ_FRAME_MODEL, k: process.env.OPENROUTER_API_KEY };
    const realFetch = globalThis.fetch;
    const realError = console.error;
    let calls = 0;
    resetFrameModelState();
    process.env.FLOWIQ_FRAME_MODEL = 'openrouter:test/model';
    process.env.OPENROUTER_API_KEY = 'test-key';
    globalThis.fetch = (async () => { calls++; return reply(); }) as typeof fetch;
    console.error = () => {};
    try { await run(() => calls); } finally {
      globalThis.fetch = realFetch;
      console.error = realError;
      for (const [k, v] of [['FLOWIQ_FRAME_MODEL', env.m], ['OPENROUTER_API_KEY', env.k]] as const) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  };
  const store = loadPortfolioStore();

  it('surfaces a 429 on the turn and does not call again during Retry-After', async () => {
    // The clock is frozen, so however slow a turn is under load, the second
    // call lands inside the 1 s Retry-After window.
    const realNow = frameModelClock.now;
    frameModelClock.now = () => 1_000_000;
    try { await withModel(() => new Response('{}', { status: 429, headers: { 'retry-after': '1' } }), async (calls) => {
      const t = await askFlowIqCopilot('How many vacant units at Kedzie Works?', { store });
      assert.deepEqual(t.envelope.result, { count: 14 });
      assert.match(t.llmFallbackReason ?? '', /HTTP 429/);
      const t2 = await askFlowIqCopilot('How many vacant units at Kedzie Works?', { store });
      assert.match(t2.llmFallbackReason ?? '', /429/);
      assert.equal(calls(), 1);
    }); } finally { frameModelClock.now = realNow; resetFrameModelState(); }
  });

  it('labels a model-added refusal with the model that made it', async () => {
    const t = await withModelRefusalOnly(store);
    assert.equal(t.modelUsed, 'test/model');
    assert.equal(t.providerUsed, 'openrouter');
  });
});

/** A question only the model refuses, so the label comes from the model path. */
async function withModelRefusalOnly(store: ReturnType<typeof loadPortfolioStore>) {
  const env = { m: process.env.FLOWIQ_FRAME_MODEL, k: process.env.OPENROUTER_API_KEY };
  const realFetch = globalThis.fetch;
  resetFrameModelState();
  process.env.FLOWIQ_FRAME_MODEL = 'openrouter:test/model';
  process.env.OPENROUTER_API_KEY = 'test-key';
  const body = JSON.stringify({ choices: [{ message: { content: '{"group":"age","treatment":true}' } }] });
  globalThis.fetch = (async () => new Response(body, { status: 200 })) as typeof fetch;
  try {
    return await askFlowIqCopilot('How many vacant units at Kedzie Works?', { store });
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of [['FLOWIQ_FRAME_MODEL', env.m], ['OPENROUTER_API_KEY', env.k]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}
