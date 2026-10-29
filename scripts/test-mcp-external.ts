import { runMcpChecks } from './mcp-checks.ts';
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
    const passed = await runMcpChecks(rpcCall, (method) => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
    });
    console.log('-'.repeat(72));
    console.log(`Summary: ${passed}/${passed} MCP checks passed over stdio from cwd="${workingDir}".`);
    console.log('='.repeat(72));
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
