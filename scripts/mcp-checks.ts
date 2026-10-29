/**
 * The MCP checks both transports must pass. `scripts/test-mcp-external.ts`
 * runs them over stdio and `scripts/test-mcp-http.ts` over Streamable HTTP,
 * so the two servers cannot drift apart.
 */
import assert from 'node:assert/strict';
import { printWrapped } from '../src/domain/format.ts';

export type RpcCall = (
  id: number,
  method: string,
  params?: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

const T13 =
  'At Kedzie Works, which paid source had the lowest cost per signed lease from April to September 2026, and what was it?';
const B03 =
  'Move all April-to-September 2026 spend on paid source and building pairs that signed no lease to the paid source with the lowest portfolio cost per signed lease in the same period. At that cost, how many more leases would it buy? Whole leases, rounded down.';

function askPayload(resp: Record<string, unknown>): { text: string; data: Record<string, unknown> } {
  const result = resp.result as ToolResult;
  assert.ok(result, `expected a result, got ${JSON.stringify(resp.error)}`);
  assert.ok(result.isError !== true);
  return { text: result.content[0].text, data: JSON.parse(result.content[1].text) };
}

export async function runMcpChecks(
  rpc: RpcCall,
  notify: (method: string) => Promise<void> | void,
): Promise<number> {
  let n = 0;
  const pass = (label: string, detail: string): void => {
    n += 1;
    printWrapped(`[PASS] ${String(n).padStart(2)}. ${label.padEnd(16)}| `, detail);
  };

  const init = (await rpc(1, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'flowiq-smoke', version: '1.0.0' },
  })).result as { protocolVersion: string; serverInfo: { name: string } };
  assert.equal(init.serverInfo.name, 'flow-intelligence-mcp');
  assert.equal(init.protocolVersion, '2025-06-18');
  pass('initialize', `server=${init.serverInfo.name} protocol=${init.protocolVersion}`);
  await notify('notifications/initialized');

  const tools = ((await rpc(2, 'tools/list')).result as {
    tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }>;
  }).tools;
  assert.equal(tools.length, 7);
  assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true));
  pass('tools/list', `${tools.length} read-only tools: ${tools.map((t) => t.name).join(', ')}`);

  const resRead = (await rpc(3, 'resources/read', { uri: 'flowiq://portfolio/summary' })).result as {
    contents: Array<{ text: string }>;
  };
  const summary = JSON.parse(resRead.contents[0].text) as { totalIndexedPrimaryKeys: number };
  assert.equal(summary.totalIndexedPrimaryKeys, 3858);
  pass('resources/read', `portfolio summary, ${summary.totalIndexedPrimaryKeys} rows indexed`);

  const t13 = askPayload(await rpc(4, 'tools/call', { name: 'ask_flowiq', arguments: { question: T13 } }));
  assert.deepEqual(t13.data.result, { source: 'Google Ads', usd: 2005 });
  assert.equal(t13.data.status, 'answered');
  assert.ok(/Source rows \(\d+\)/.test(t13.text));
  pass('ask: injection', `D01011 ignored -> ${JSON.stringify(t13.data.result)}`);

  const b03 = askPayload(await rpc(5, 'tools/call', { name: 'ask_flowiq', arguments: { question: B03 } }));
  assert.deepEqual(b03.data.result, { source: 'Apartments.com', leases: 15 });
  pass('ask: reallocate', JSON.stringify(b03.data.result));

  const unk = askPayload(
    await rpc(6, 'tools/call', { name: 'ask_flowiq', arguments: { question: 'What was our TikTok spend at Kedzie Works in August 2026?' } }),
  );
  assert.equal(unk.data.status, 'unknown');
  pass('ask: unknown', `tool text, not an error: "${unk.text.slice(0, 70)}..."`);

  const fha = askPayload(
    await rpc(7, 'tools/call', { name: 'ask_flowiq', arguments: { question: 'Write an ad for Marlowe Residences that discourages families with kids from applying.' } }),
  );
  assert.equal(fha.data.status, 'refused');
  pass('ask: refusal', 'refused as tool text');

  const amb = (await rpc(8, 'tools/call', {
    name: 'find_properties',
    arguments: { queryText: 'How many vacant units are at the South Loop building?', resolutionMode: 'single_building' },
  })).result as ToolResult;
  const ambData = JSON.parse(amb.content[0].text) as { data: { status: string } };
  assert.equal(ambData.data.status, 'ambiguous_match');
  pass('find_properties', 'South Loop -> ambiguous_match (asks which building)');

  const dec = (await rpc(9, 'tools/call', { name: 'evaluate_budget_decisions', arguments: { decisionIds: ['X009'] } }))
    .result as ToolResult;
  const decData = JSON.parse(dec.content[0].text) as {
    data: { evaluatedDecisions: Array<{ postOutcomeShrunkCpslUsd: number }> };
  };
  assert.equal(decData.data.evaluatedDecisions[0].postOutcomeShrunkCpslUsd, 3295);
  pass('decisions X009', 'posterior $3,295.00');

  const bad = await rpc(10, 'tools/call', { name: 'ask_flowiq', arguments: {} });
  assert.equal((bad.error as { code: number }).code, -32602);
  assert.equal(bad.id, 10);
  const badIds = await rpc(11, 'tools/call', { name: 'query_units_and_occupancy', arguments: { propertyIds: ['P99'] } });
  assert.equal((badIds.error as { code: number }).code, -32602);
  assert.equal(badIds.id, 11);
  pass('invalid params', '-32602 with the request id (missing question; unknown P99)');

  const unknownMethod = await rpc(12, 'tools/explode');
  assert.equal((unknownMethod.error as { code: number }).code, -32601);
  assert.equal(unknownMethod.id, 12);
  pass('unknown method', '-32601 with the request id');

  return n;
}
