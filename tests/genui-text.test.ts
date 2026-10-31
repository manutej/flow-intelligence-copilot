// TENACITY VERDICT-GENUI-f0f6bdf N2/N3 (repros/genui-text-f0f6bdf.ts) as tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { askPanel } from '../src/genui/picker.ts';
import { specErrors } from '../src/genui/spec.ts';

process.env.GENUI_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'genui-text-'));
const store = loadPortfolioStore();
const p = await askPanel('At Fulton Yards, which listing source had the lowest cost per signed lease in Q3 2026, and what was it?', store);
const errs = (t: string) => { const s = structuredClone(p.spec) as any; s.insight = t; return specErrors(s, p.evidence, store); };

const REJECT = ['three units', 'There are 2025 leads', '1.2k leads', 'a dozen leads', 'twelve-hundred dollars', '2,025 leads', 'the 3rd source', '1st',
  'several hundred', 'zero', 'half', 'ten-fold', '10x', 'one-bedroom units', 'No. 1 source', '#1 source',
  // N2: unicode digits, roman numerals, fractions and quantity words
  'MMXXV leases', '１２ leases', 'Ⅻ leases', '٣ leases', 'x̄ ≈ ½ lease', 'first place', 'a couple of leads', 'a score of leases', 'nil leases', 'XII sources'];
const ACCEPT = ['Q3 2026 results', 'FY 2026', '2026-09-30', 'Sept 2026',
  // N3: bare years in a temporal context
  'In 2026 leases rose', 'since 2025', '2026 YTD', 'during 2026', 'through 2026'];

test('N2: unicode digits, roman numerals, fractions and quantity words are figures', () => {
  for (const t of REJECT) assert.ok(errs(t).length > 0, `accepted: ${t}`);
});
test('N3: a bare year in a temporal context is a label, not a figure', () => {
  for (const t of ACCEPT) assert.deepEqual(errs(t), [], t);
});
