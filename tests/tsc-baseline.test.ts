import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// main 6790d75 has 9 known tsc errors in scripts/ and dashboard-server; new code must not add any
const BASELINE = 9;
test('tsc: error count does not exceed the main baseline', () => {
  const r = spawnSync('npx', ['tsc', '--noEmit', '-p', '.'], { encoding: 'utf8' } as never) as unknown as { stdout: string };
  const errs = String(r.stdout ?? '').split('\n').filter((l) => /error TS\d+/.test(l));
  assert.ok(errs.length <= BASELINE, `tsc errors ${errs.length} > baseline ${BASELINE}:\n${errs.join('\n')}`);
});
