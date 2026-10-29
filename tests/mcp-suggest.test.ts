import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { validateToolArguments } from '../src/mcp/validate.ts';

describe('MCP argument errors', () => {
  it('name the closest allowed argument', () => {
    const problems = validateToolArguments(
      { questoin: 'Dead spend?' },
      { properties: { question: { type: 'string' }, assumptions: { type: 'object' } }, required: ['question'] },
      loadPortfolioStore(),
    );
    assert.ok(problems.some((p) => p.includes('unknown argument "questoin" (did you mean "question"?)')));
  });
});
