// TENACITY VERDICT-GENUI-60e142a L3: genui-eval must carry an honest-acceptance control.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { execFileSync } = (await import('node:child_process')) as any; // not in the local node shims

test('L3: genui-eval reports and requires honest panels accepted for every row', () => {
  const out = JSON.parse(execFileSync(process.execPath, ['--no-warnings', 'scripts/genui-eval.ts', '--json'], { encoding: 'utf8', maxBuffer: 1 << 26 }));
  let total = 0;
  for (const r of Object.values(out) as any[]) { assert.equal(r.honest_accepted, r.questions); total += r.honest_accepted; }
  assert.equal(total, 94);
});
