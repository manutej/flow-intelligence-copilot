/**
 * Regression tests for the Oct 30, 2026 core audit (Ormus F1-F11,
 * TENACITY F1-F12). Each case replays one repro against the real code.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';

function mcpStdio(lines: string[]) {
  const r = spawnSync('node', ['--no-warnings', 'src/mcp/server.ts'], {
    input: `${lines.join('\n')}\n`,
    encoding: 'utf-8',
    timeout: 20000,
  });
  const replies = (r.stdout as string)
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { id: unknown; error?: { code: number }; result?: unknown });
  return { code: r.status, replies, stderr: r.stderr as string };
}

describe('audit: MCP stdio survives malformed lines', () => {
  for (const bad of ['null', '[1,2]', '[]', '42', '"x"', '{"jsonrpc":"2.0","id":1}']) {
    it(`answers ${bad} with -32600 and keeps serving`, () => {
      const r = mcpStdio([bad, '{"jsonrpc":"2.0","id":2,"method":"tools/list"}']);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.replies.length, 2);
      assert.equal(r.replies[0].error?.code, -32600);
      assert.equal(r.replies[1].id, 2);
      assert.ok(r.replies[1].result);
    });
  }
});

/** Copies src/ and data/ into a temp dir so a CSV can be broken without touching the repo. */
function scratchRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowiq-audit-'));
  for (const d of ['src', 'data']) fs.cpSync(d, path.join(dir, d), { recursive: true });
  fs.copyFileSync('package.json', path.join(dir, 'package.json'));
  return dir;
}

function askIn(dir: string) {
  const r = spawnSync('node', ['--no-warnings', 'src/cli.ts', 'ask', 'How many units are vacant at Kedzie Works?', '--json'], {
    cwd: dir,
    encoding: 'utf-8',
    env: { ...process.env, FLOW_DATA_DIR: '' },
  });
  return { code: r.status, stdout: r.stdout as string, stderr: r.stderr as string };
}

describe('audit: broken CSV exports exit 10 with a clear message', () => {
  const cases: Array<[string, string, string | null, RegExp]> = [
    ['malformed units.csv (TENACITY f5d)', 'pms/units.csv', 'unit_id,property_id\n"U1,P01\n', /units\.csv is missing columns: unit_number/],
    ['empty leases.csv', 'pms/leases.csv', '', /leases\.csv is empty/],
    ['header-only spend.csv', 'ils/spend.csv', 'spend_id,month,property_id,source,amount,currency,status\n', /spend\.csv has a header but no data rows/],
    ['missing units.csv', 'pms/units.csv', null, /units\.csv does not exist/],
  ];
  for (const [name, rel, content, message] of cases) {
    it(name, () => {
      const dir = scratchRepo();
      try {
        const file = path.join(dir, 'data', rel);
        if (content === null) fs.rmSync(file);
        else fs.writeFileSync(file, content);
        const r = askIn(dir);
        assert.equal(r.code, 10, r.stderr);
        assert.match(r.stderr, message);
        assert.doesNotMatch(r.stderr, /TypeError|\n\s+at /);
        assert.equal(r.stdout, '');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

async function ask(question: string) {
  const turn = await askFlowIqCopilot({ id: 'AUDIT', type: 'adhoc', question });
  return { result: turn.envelope.result, valid: turn.verification.valid };
}

describe('audit: an unrecognised measure is not reported as a unit count', () => {
  // Expected values computed with python over data/pms/units.csv (TENACITY f1b).
  const answered: Array<[string, Record<string, number>]> = [
    ['vacancies at Kedzie Works', { count: 14 }],
    ['Kedzie Works vacancy', { count: 14 }],
    ['How many 3-bedroom vacancies at Kedzie Works?', { count: 1 }],
    ['What is the average square footage of one-bedroom units at Armitage Commons?', { count: 49, sqft: 705.6 }],
  ];
  for (const [question, expected] of answered) {
    it(question, async () => {
      const r = await ask(question);
      assert.deepEqual(r.result, expected);
      assert.equal(r.valid, true);
    });
  }
  for (const question of [
    'How many bedrooms are there in total at Kedzie Works?',
    'What is the total square footage at Kedzie Works?',
    'What is the median market rent at Kedzie Works?',
  ]) {
    it(`says it does not know: ${question}`, async () => {
      const r = await ask(question);
      assert.equal(r.result.unknown, true);
      assert.equal('count' in r.result, false);
    });
  }
});
