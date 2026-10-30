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

describe('MCP presentation', () => {
  it('lists eight closed, titled tools with ask_flowiq first and flowiq_about last', async () => {
    const { handleMcpJsonRpcRequest } = await import('../src/mcp/server.ts');
    const res = await handleMcpJsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const tools = (res?.result as { tools: Array<{ name: string; title: string; inputSchema: { additionalProperties?: boolean } }> }).tools;
    assert.equal(tools.length, 8);
    assert.equal(tools[0].name, 'ask_flowiq');
    assert.equal(tools[7].name, 'flowiq_about');
    assert.ok(tools.every((t) => t.title && t.inputSchema.additionalProperties === false));
  });

  it('serves the executive audit prompt and names the closest unknown tool', async () => {
    const { handleMcpJsonRpcRequest } = await import('../src/mcp/server.ts');
    const prompt = await handleMcpJsonRpcRequest({ jsonrpc: '2.0', id: 2, method: 'prompts/get', params: { name: 'portfolio-executive-audit' } });
    assert.ok((prompt?.result as { messages: unknown[] }).messages.length === 1);
    const unknown = await handleMcpJsonRpcRequest({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'flowiq_abut', arguments: {} } });
    assert.equal(unknown?.error?.code, -32602);
    assert.equal(unknown?.id, 3);
    assert.match(unknown?.error?.message ?? '', /did you mean "flowiq_about"/);
  });
});
