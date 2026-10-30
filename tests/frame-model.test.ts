import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyFrame, composeFrame, frameModelConfig, parseFrameAnswers } from '../src/agent/frame-model.ts';

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
