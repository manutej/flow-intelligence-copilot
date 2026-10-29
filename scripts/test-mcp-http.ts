/**
 * Smoke test for the Streamable HTTP transport. Starts the local server
 * (the same handler as api/mcp.js) on a free port, runs the shared MCP
 * checks over POST, then checks the HTTP-only behaviour.
 *   npm run mcp:http:smoke
 *   MCP_URL=https://<deployment>/api/mcp npm run mcp:http:smoke   # against a deployment
 */
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { printWrapped } from '../src/domain/format.ts';
import { runMcpChecks } from './mcp-checks.ts';
import { MCP_HTTP_PATH, startMcpHttpServer } from './mcp-http-server.ts';

const MCP_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
  'MCP-Protocol-Version': '2025-06-18',
};

export async function runHttpSmokeTest(): Promise<void> {
  const server = process.env.MCP_URL ? null : await startMcpHttpServer(0);
  const url =
    process.env.MCP_URL ??
    `http://127.0.0.1:${(server!.address() as AddressInfo).port}${MCP_HTTP_PATH}`;
  console.log('='.repeat(72));
  console.log(`FLOW-104 MCP STREAMABLE HTTP SMOKE TEST (${url})`);
  console.log('='.repeat(72));

  const post = (body: string) => fetch(url, { method: 'POST', headers: MCP_HEADERS, body });
  try {
    const rpc = async (id: number, method: string, params?: Record<string, unknown>) => {
      const res = await post(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      assert.equal(res.status, 200, `${method} -> HTTP ${res.status}`);
      assert.ok((res.headers.get('content-type') ?? '').includes('application/json'));
      return (await res.json()) as Record<string, unknown>;
    };
    const notify = async (method: string) => {
      const res = await post(JSON.stringify({ jsonrpc: '2.0', method }));
      assert.equal(res.status, 202);
    };
    let passed = await runMcpChecks(rpc, notify);

    const extra = (label: string, detail: string): void => {
      passed += 1;
      printWrapped(`[PASS] ${String(passed).padStart(2)}. ${label.padEnd(16)}| `, detail);
    };

    const garbage = await post('{"jsonrpc":"2.0","id":');
    assert.equal(garbage.status, 400);
    assert.equal(((await garbage.json()) as { error: { code: number } }).error.code, -32700);
    extra('parse error', 'HTTP 400, -32700, id null');

    const batch = await post(
      JSON.stringify([
        { jsonrpc: '2.0', id: 'a', method: 'ping' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 'b', method: 'tools/call', params: { name: 'ask_flowiq', arguments: { question: '  ' } } },
      ]),
    );
    const batchBody = (await batch.json()) as Array<{ id: string; error?: { code: number } }>;
    assert.deepEqual(batchBody.map((r) => r.id), ['a', 'b']);
    assert.equal(batchBody[1].error?.code, -32602);
    extra('batch', 'ping ok, notification skipped, blank question -32602 with id "b"');

    const get = await fetch(url, { method: 'GET', headers: { Accept: 'text/event-stream' } });
    assert.equal(get.status, 405);
    const del = await fetch(url, { method: 'DELETE' });
    assert.equal(del.status, 405);
    extra('GET / DELETE', '405: stateless, no SSE stream or session');

    const big = await post(JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'ping', params: { pad: 'x'.repeat(70_000) } }));
    assert.equal(big.status, 413);
    extra('body limit', 'HTTP 413 over 64 KB');

    console.log('-'.repeat(72));
    console.log(`Summary: ${passed}/${passed} MCP checks passed over Streamable HTTP.`);
    console.log('='.repeat(72));
  } finally {
    server?.close();
  }
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  runHttpSmokeTest().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
