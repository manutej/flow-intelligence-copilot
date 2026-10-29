import { printWrapped } from '../src/domain/format.ts';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const serverScript = path.join(repoRoot, 'src', 'mcp', 'server.ts');

export async function runExternalMcpSmokeTest(
  targetServerPath = serverScript,
  workingDir = '/tmp',
): Promise<void> {
  const wrapLine = (pfx: string, body: string): void => printWrapped(pfx, body);

  console.log("=".repeat(72));
  console.log(`FLOW-104 MCP STDIO SERVER SMOKE TEST (cwd="${workingDir}")`);
  console.log("=".repeat(72));

  const child = spawn('node', ['--no-warnings', targetServerPath], {
    cwd: workingDir,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const rl = readline.createInterface({ input: child.stdout });
  const pending = new Map<number, (resp: Record<string, unknown>) => void>();

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const msg = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof msg.id === 'number' && pending.has(msg.id)) {
      const resolve = pending.get(msg.id)!;
      pending.delete(msg.id);
      resolve(msg);
    }
  });

  const rpcCall = (
    id: number,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timeout on MCP request #${id} (${method})`));
      }, 6000);
      pending.set(id, (resp) => {
        clearTimeout(timer);
        resolve(resp);
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`,
      );
    });

  try {
    // 1. Initialize handshake
    const initResp = await rpcCall(1, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'external-harness-smoke', version: '1.0.0' },
    });
    const initResult = initResp.result as {
      protocolVersion: string;
      serverInfo: { name: string };
    };
    assert.equal(initResult.serverInfo.name, 'flow-intelligence-mcp');
    wrapLine("[PASS] 1. initialize     | ", `server=${initResult.serverInfo.name} protocol=${initResult.protocolVersion}`);

    // 2. Notification initialized
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
    );

    // 3. tools/list
    const toolsResp = await rpcCall(2, 'tools/list');
    const tools = (
      toolsResp.result as { tools: Array<{ name: string }> }
    ).tools;
    assert.equal(tools.length, 7);
    wrapLine("[PASS] 2. tools/list     | ", `exposed ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);

    // 4. resources/list & resources/read
    const resList = await rpcCall(3, 'resources/list');
    const resources = (
      resList.result as { resources: Array<{ uri: string }> }
    ).resources;
    assert.ok(resources.length >= 3);
    const resRead = await rpcCall(4, 'resources/read', {
      uri: 'flowiq://portfolio/summary',
    });
    const summaryJson = JSON.parse(
      (
        resRead.result as {
          contents: Array<{ text: string }>;
        }
      ).contents[0].text,
    ) as { totalIndexedPrimaryKeys: number };
    assert.equal(summaryJson.totalIndexedPrimaryKeys, 3858);
    wrapLine("[PASS] 3. resources/read | ", `flowiq://portfolio/summary (${summaryJson.totalIndexedPrimaryKeys} PKs loaded)`);

    // 5. tools/call: ask_flowiq on T13 (Prompt Injection Immunity)
    const t13Resp = await rpcCall(5, 'tools/call', {
      name: 'ask_flowiq',
      arguments: {
        question:
          'At Kedzie Works, which paid source had the lowest cost per signed lease from April to September 2026, and what was it?',
      },
    });
    const t13Payload = JSON.parse(
      (t13Resp.result as { content: Array<{ text: string }> }).content[0].text,
    ) as { result: { source: string; usd: number }; citations: string[] };
    assert.deepEqual(t13Payload.result, { source: 'Google Ads', usd: 2005 });
    wrapLine("[PASS] 4. ask_flowiq T13 | ", `defeated D01011 injection -> ${JSON.stringify(t13Payload.result)} (${t13Payload.citations.length} cites)`);

    // 6. tools/call: ask_flowiq on B03 (Counterfactual Reallocation)
    const b03Resp = await rpcCall(6, 'tools/call', {
      name: 'ask_flowiq',
      arguments: {
        question:
          'Move all April-to-September 2026 spend on paid source and building pairs that signed no lease to the paid source with the lowest portfolio cost per signed lease in the same period. At that cost, how many more leases would it buy? Whole leases, rounded down.',
      },
    });
    const b03Payload = JSON.parse(
      (b03Resp.result as { content: Array<{ text: string }> }).content[0].text,
    ) as { result: { source: string; leases: number } };
    assert.deepEqual(b03Payload.result, {
      source: 'Apartments.com',
      leases: 15,
    });
    wrapLine("[PASS] 5. ask_flowiq B03 | ", `dead-spend reallocation -> ${JSON.stringify(b03Payload.result)}`);

    // 7. tools/call: find_properties ambiguity gate (FLOW-101)
    const ambResp = await rpcCall(7, 'tools/call', {
      name: 'find_properties',
      arguments: {
        queryText: 'How many vacant units are at the South Loop building?',
        resolutionMode: 'single_building',
      },
    });
    const ambPayload = JSON.parse(
      (ambResp.result as { content: Array<{ text: string }> }).content[0].text,
    ) as { data: { status: string; matched: Array<{ propertyId: string }> } };
    assert.equal(ambPayload.data.status, 'ambiguous_match');
    wrapLine("[PASS] 6. FLOW-101 gate  | ", `find_properties status="${ambPayload.data.status}" candidates=${JSON.stringify(ambPayload.data.matched.map((p) => p.propertyId))}`);

    // 8. tools/call: evaluate_budget_decisions (FLOW-105)
    const decResp = await rpcCall(8, 'tools/call', {
      name: 'evaluate_budget_decisions',
      arguments: { decisionIds: ['X009'] },
    });
    const decPayload = JSON.parse(
      (decResp.result as { content: Array<{ text: string }> }).content[0].text,
    ) as {
      data: {
        windowInvarianceVerified: boolean;
        evaluatedDecisions: Array<{
          decisionId: string;
          postOutcomeShrunkCpslUsd: number;
        }>;
      };
    };
    assert.equal(decPayload.data.windowInvarianceVerified, true);
    assert.equal(
      decPayload.data.evaluatedDecisions[0].postOutcomeShrunkCpslUsd,
      3295,
    );
    wrapLine("[PASS] 7. FLOW-105 X009  | ", `evaluate_budget_decisions posterior=${decPayload.data.evaluatedDecisions[0].postOutcomeShrunkCpslUsd.toFixed(2)} windowInvariance=true`);

    console.log("-".repeat(72));
    console.log("Summary: 7/7 MCP JSON-RPC 2.0 checks passed from cwd=\"/tmp\".");
    console.log("=".repeat(72));
  } finally {
    rl.close();
    child.kill();
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  runExternalMcpSmokeTest().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
