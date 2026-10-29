/**
 * One-step setup for local MCP clients (stdio). Prints the exact config for
 * Claude Code, Claude Desktop and Cursor with absolute paths, checks that
 * the server starts from outside the repo, and optionally merges the entry
 * into a client's config file.
 *
 *   npm run mcp:install                          # print config, run the check
 *   npm run mcp:install -- --write cursor        # merge into ~/.cursor/mcp.json
 *   npm run mcp:install -- --write claude-desktop
 *
 * Writing keeps every other server in the file and saves a .bak copy first.
 * No keys are needed: the server runs the deterministic engine.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_NAME = 'flowiq';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(repoRoot, 'src', 'mcp', 'server.ts');
// Absolute node path: Claude Desktop does not inherit the shell PATH.
const nodePath = process.execPath;
const serverEntry = { command: nodePath, args: ['--no-warnings', serverPath] };

function claudeDesktopConfigPath(): string {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  }
  return path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
}

const TARGETS: Record<string, () => string> = {
  cursor: () => path.join(os.homedir(), '.cursor', 'mcp.json'),
  'claude-desktop': claudeDesktopConfigPath,
};

function shellQuote(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Start the server from the temp dir and list its tools over stdio. */
function checkServerStarts(): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(nodePath, serverEntry.args, { cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('server did not answer tools/list within 10 s'));
    }, 10_000);
    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString();
      for (const line of buf.split('\n')) {
        try {
          const msg = JSON.parse(line) as { id?: number; result?: { tools?: unknown[] } };
          if (msg.id === 2 && msg.result?.tools) {
            clearTimeout(timer);
            child.kill();
            resolve(msg.result.tools.length);
          }
        } catch {
          // partial line; wait for more
        }
      }
    });
    child.on('error', reject);
    const send = (m: object) => child.stdin.write(`${JSON.stringify(m)}\n`);
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mcp-install', version: '1' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  });
}

function writeConfig(target: string): string {
  const file = TARGETS[target]();
  let config: { mcpServers?: Record<string, unknown> } = {};
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf-8');
    try {
      config = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      throw new Error(`${file} is not valid JSON; fix or move it, then run again`);
    }
    fs.copyFileSync(file, `${file}.bak`);
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  config.mcpServers = { ...(config.mcpServers ?? {}), [SERVER_NAME]: serverEntry };
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return file;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const writeIdx = args.indexOf('--write');
  const target = writeIdx >= 0 ? args[writeIdx + 1] : undefined;
  if (writeIdx >= 0 && (!target || !TARGETS[target])) {
    console.error(`usage: npm run mcp:install [-- --write ${Object.keys(TARGETS).join('|')}]`);
    process.exit(2);
  }
  const major = Number(process.versions.node.split('.')[0]);
  const minor = Number(process.versions.node.split('.')[1]);
  if (major < 22 || (major === 22 && minor < 6)) {
    console.error(`Node ${process.versions.node} found; the server needs Node 22.6 or newer.`);
    process.exit(1);
  }

  const toolCount = await checkServerStarts();
  console.log(`Server check: started from ${os.tmpdir()} with ${nodePath}, ${toolCount} tools listed.\n`);

  const block = JSON.stringify({ mcpServers: { [SERVER_NAME]: serverEntry } }, null, 2);
  console.log('Claude Code (one command):');
  console.log(`  claude mcp add ${SERVER_NAME} -- ${[nodePath, ...serverEntry.args].map(shellQuote).join(' ')}\n`);
  console.log(`Cursor (~/.cursor/mcp.json) or Claude Desktop (${claudeDesktopConfigPath()}):`);
  console.log(block.replace(/^/gm, '  '));
  console.log('\n  Or let this script merge it: npm run mcp:install -- --write cursor | claude-desktop');
  console.log('  Restart the client afterwards.\n');
  console.log('Grok Bot and the xAI API need the hosted URL instead: https://<deployment>/api/mcp (see docs/MCP_SETUP.md).');

  if (target) {
    const file = writeConfig(target);
    console.log(`\nWrote "${SERVER_NAME}" into ${file} (previous version saved as .bak if it existed).`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
