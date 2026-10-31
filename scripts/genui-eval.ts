/**
 * GenUI eval: chart-choice accuracy against the labelled templates and number
 * fidelity (every number in every spec traces exactly to a verified result).
 * Also forges one number per numeric spec and requires the validator to reject it.
 * Usage: node --no-warnings scripts/genui-eval.ts [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { askPanel } from '../src/genui/picker.ts';
import { countNums, specErrors } from '../src/genui/spec.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const store = loadPortfolioStore();
const sets = ['genui-templates-82.jsonl', 'genui-templates-extra.jsonl'];
const out: Record<string, unknown> = {};
let fail = false;
for (const f of sets) {
  const rows = fs.readFileSync(path.join(ROOT, 'tests/fixtures', f), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  let right = 0, nums = 0, bad = 0, forged = 0, caught = 0; const miss: string[] = [];
  const byT: Record<string, [number, number]> = {};
  for (const r of rows) {
    const p = await askPanel(r.text, store);
    const ok = p.spec.template === r.expected_template;
    byT[r.expected_template] ??= [0, 0]; byT[r.expected_template][1]++;
    if (ok) { right++; byT[r.expected_template][0]++; } else miss.push(`${r.id}: expected ${r.expected_template}, got ${p.spec.template} (${p.spec.intent})`);
    nums += countNums(p.spec); bad += p.errors.length;
    const s = JSON.stringify(p.spec);
    if (countNums(p.spec) > 0) {
      forged++;
      const f2 = JSON.parse(s.replace(/"v":(-?[\d.]+)/, (_, n) => `"v":${Number(n) + 1}`));
      if (specErrors(f2, p.evidence).length) caught++;
    }
  }
  out[f] = { questions: rows.length, chart_choice_correct: right, accuracy: +(right / rows.length).toFixed(4), traced_numbers: nums, fidelity_errors: bad, forged_specs: forged, forged_rejected: caught, by_template: byT, misses: miss };
  if (bad || caught !== forged) fail = true;
}
if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 2));
else for (const [f, r] of Object.entries(out) as [string, any][]) {
  console.log(`${f}: chart choice ${r.chart_choice_correct}/${r.questions} (${(r.accuracy * 100).toFixed(1)}%), numbers traced ${r.traced_numbers} with ${r.fidelity_errors} fidelity errors, forged ${r.forged_rejected}/${r.forged_specs} rejected`);
  for (const m of r.misses) console.log(`  miss ${m}`);
}
process.exit(fail ? 1 : 0);
