/** S0b F-046: values outside the data dictionary's domains never load. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import { DataLoadError, loadPortfolioStore } from '../src/data/loader.ts';

function corrupt(file: string, id: string, col: string, value: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fx46-'));
  fs.cpSync('data', path.join(root, 'data'), { recursive: true });
  const p = path.join(root, 'data', file);
  const [head, ...rows] = fs.readFileSync(p, 'utf8').trimEnd().split('\n');
  const i = head.split(',').indexOf(col);
  fs.writeFileSync(p, [head, ...rows.map((r) => { const f = r.split(','); if (f[0] === id) f[i] = value; return f.join(','); })].join('\n') + '\n');
  return root;
}

for (const [file, id, col, v] of [
  ['pms/units.csv', 'U0691', 'sqft', '700.5'], ['pms/units.csv', 'U0691', 'bedrooms', '-1'],
  ['pms/units.csv', 'U0691', 'bathrooms', 'x'], ['pms/units.csv', 'U0691', 'floor', '-3'],
  ['pms/units.csv', 'U0691', 'market_rent', '999999'], ['pms/leases.csv', 'L00001', 'start_date', '2026-02-30'],
  ['pms/leases.csv', 'L00001', 'end_date', '2076-04-30'], ['pms/leases.csv', 'L00001', 'concession_usd', '-5000'],
  ['ils/spend.csv', 'S0101', 'month', '2026-13'],
]) {
  it(`${file} ${col} ${v} fails the load`, () => assert.throws(() => loadPortfolioStore(corrupt(file, id, col, v)), DataLoadError));
}
