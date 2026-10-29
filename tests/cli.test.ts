/**
 * The CLI contract an agent relies on: typed exit codes, errors that name
 * the fix, JSON that parses, no colour in a pipe, nothing over 80 columns.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { parseArgs, UsageError } from '../src/cli/args.ts';
import { colorEnabled, createStyle, terminalWidth } from '../src/cli/style.ts';
import { WORDMARK } from '../src/cli/wordmark.ts';
import { closest } from '../src/util/suggest.ts';

function flowiq(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync('node', ['--no-warnings', 'src/cli.ts', ...args], {
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '', FORCE_COLOR: '', TERM: 'xterm-256color', ...env },
  });
  return { code: r.status, stdout: r.stdout as string, stderr: r.stderr as string };
}

const ESC = String.fromCharCode(27);

describe('flowiq CLI contract', () => {
  it('exits 0 with help, and help has no colour or banner in a pipe', () => {
    const r = flowiq(['--help']);
    assert.equal(r.code, 0);
    assert.ok(r.stdout.includes('/ USAGE'));
    assert.ok(!r.stdout.includes(ESC));
    assert.ok(!r.stdout.includes(WORDMARK[0]));
  });

  it('gives every command its own help', () => {
    const r = flowiq(['ask', '--help']);
    assert.equal(r.code, 0);
    assert.ok(r.stdout.includes('--cad-rate N'));
    assert.ok(r.stdout.includes('/ EXAMPLES'));
  });

  it('exits 2 with a suggestion for a mistyped command or flag', () => {
    const cmd = flowiq(['valdate']);
    assert.equal(cmd.code, 2);
    assert.match(cmd.stderr, /did you mean "validate"/);
    const flag = flowiq(['ask', '--cad-rat', '0.8', 'occupancy']);
    assert.equal(flag.code, 2);
    assert.match(flag.stderr, /did you mean "--cad-rate"/);
    const value = flowiq(['ask', '--bucket-by', 'lease_start', 'occupancy']);
    assert.equal(value.code, 2);
    assert.match(value.stderr, /lease_start_date, lead_created_date/);
  });

  it('exits 3 for an unknown kit item', () => {
    const r = flowiq(['ask', 'T99']);
    assert.equal(r.code, 3);
    assert.match(r.stderr, /no kit item T99/);
  });

  it('prints the answer envelope as one JSON line with --json', () => {
    const r = flowiq(['ask', '--json', 'T13']);
    assert.equal(r.code, 0);
    const lines = r.stdout.trim().split('\n');
    assert.equal(lines.length, 1);
    const env = JSON.parse(lines[0]) as { id: string; result: unknown; citations: string[] };
    assert.equal(env.id, 'T13');
    assert.deepEqual(env.result, { source: 'Google Ads', usd: 2005 });
  });

  it('keeps human output within 80 columns and the data unchanged', () => {
    const r = flowiq(['ask', 'How much did we spend on paid sources that signed no leases from April to September 2026?']);
    assert.equal(r.code, 0);
    for (const line of r.stdout.split('\n')) assert.ok(line.length <= 80, line);
    assert.ok(r.stdout.includes('$46,599.90'));
  });

  it('describes itself to agents as versioned JSON', () => {
    const r = flowiq(['agent-context']);
    assert.equal(r.code, 0);
    const ctx = JSON.parse(r.stdout) as {
      schema_version: number;
      commands: Array<{ name: string }>;
      exit_codes: Array<{ code: number }>;
      mcp: { tools: string[] };
    };
    assert.equal(ctx.schema_version, 1);
    assert.ok(ctx.commands.some((c) => c.name === 'ask'));
    assert.deepEqual(ctx.exit_codes.map((e) => e.code), [0, 1, 2, 3, 10, 130]);
    assert.ok(ctx.mcp.tools.includes('ask_flowiq'));
  });

  it('answers each piped REPL line and stops at exit', () => {
    const r = spawnSync('node', ['--no-warnings', 'src/cli.ts'], {
      input: '/frobnicate\nT99\nexit\nWhat is the vacancy rate at Kedzie Works?\n',
      encoding: 'utf-8',
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout as string, /Unknown command \/frobnicate/);
    assert.match(r.stdout as string, /no kit item T99/);
    assert.ok(!(r.stdout as string).includes('vacancy rate is'));
  });
});

describe('style and parsing', () => {
  it('turns colour off for NO_COLOR, TERM=dumb, --no-color and pipes', () => {
    const tty = { isTTY: true, columns: 120 };
    assert.equal(colorEnabled(tty, {}), true);
    assert.equal(colorEnabled(tty, { NO_COLOR: '1' }), false);
    assert.equal(colorEnabled(tty, { TERM: 'dumb' }), false);
    assert.equal(colorEnabled(tty, {}, true), false);
    assert.equal(colorEnabled({ isTTY: false }, {}), false);
    assert.equal(colorEnabled({ isTTY: false }, { FORCE_COLOR: '1' }), true);
    assert.equal(terminalWidth(tty), 80);
    assert.equal(terminalWidth({ isTTY: true, columns: 60 }), 60);
  });

  it('wraps fields without changing a character of the data', () => {
    const s = createStyle({ stream: { isTTY: false }, env: {} });
    const body = 'properties:P06, spend:S0125, spend:S0130, leases:L00105, leads:D00931, $46,599.90 across 9 pairs';
    const lines = s.field('Sources', body);
    assert.ok(lines.every((l) => l.length <= 80));
    assert.equal(lines.map((l) => l.slice(12)).join(' '), body);
  });

  it('suggests only close matches', () => {
    assert.equal(closest('valdate', ['validate', 'ask']), 'validate');
    assert.equal(closest('zzzz', ['validate', 'ask']), undefined);
  });

  it('treats a sentence as an implicit ask and a lone typo as an error', () => {
    assert.equal(parseArgs(['What', 'is', 'vacancy?']).command?.name, 'ask');
    assert.throws(() => parseArgs(['frobnicate']), UsageError);
    assert.equal(parseArgs(['T13']).command?.name, 'ask');
  });
});
