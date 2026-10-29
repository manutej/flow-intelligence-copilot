import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { handleMcpHttpRequest } from '../src/mcp/http.ts';

const post = (body: unknown) =>
  handleMcpHttpRequest({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('FLOW-104 · Streamable HTTP transport (/api/mcp)', () => {
  it('answers a tools/call with the plain answer and the request id', async () => {
    const res = await post({
      jsonrpc: '2.0',
      id: 'q1',
      method: 'tools/call',
      params: {
        name: 'ask_flowiq',
        arguments: { question: 'At Kedzie Works, which paid source had the lowest cost per signed lease from April to September 2026, and what was it?' },
      },
    });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body) as {
      id: string;
      result: { content: Array<{ text: string }>; structuredContent: { result: unknown } };
    };
    assert.equal(body.id, 'q1');
    assert.deepEqual(body.result.structuredContent.result, { source: 'Google Ads', usd: 2005 });
    assert.ok(body.result.content[0].text.startsWith('At Kedzie Works'));
  });

  it('rejects bad arguments with -32602 and keeps the id', async () => {
    const res = await post({ jsonrpc: '2.0', id: 42, method: 'tools/call', params: { name: 'ask_flowiq', arguments: {} } });
    const body = JSON.parse(res.body) as { id: number; error: { code: number } };
    assert.equal(res.status, 200);
    assert.equal(body.id, 42);
    assert.equal(body.error.code, -32602);
  });

  it('accepts notifications with 202, rejects bad JSON with 400 / -32700, and refuses GET', async () => {
    assert.equal((await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
    const bad = await post('{"jsonrpc":');
    assert.equal(bad.status, 400);
    assert.equal((JSON.parse(bad.body) as { error: { code: number } }).error.code, -32700);
    const get = await handleMcpHttpRequest({ method: 'GET', headers: {}, body: '' });
    assert.equal(get.status, 405);
  });
});
