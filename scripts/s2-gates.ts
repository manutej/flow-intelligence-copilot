/**
 * S2 gates (G-S2-2..11, /home/box/tau/specs-proposed/S2-GATE.md) on the
 * builder's own fuzz. G-S2-1 (Eval's hidden set H) is Eval's, not run here.
 * Exits 1 when any gate fails. Seeds: 7311 (G-S2-10) plus an unseen seed
 * (SEED2, default 4027) so nothing is tuned to one stream. All scratch output
 * goes to a private mktemp directory; nothing is pushed.
 *
 *   node --no-warnings scripts/s2-gates.ts [--n 1000] [--seed2 4027] [--skip-compare]
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const flag = (n: string, d: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const N = flag('--n', '1000');
const SEED2 = flag('--seed2', process.env.SEED2 ?? '4027');
const TSC_BASELINE = 9;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 's2-gates-'));
const env = { ...process.env } as Record<string, string | undefined>;
delete env.FLOWIQ_PARSE_URL; // gates run uncached and model-off unless a gate says otherwise
env.FLOWIQ_PARSE_NO_CACHE = '1';

const run = (cmd: string, args: string[], extra: Record<string, string> = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', env: { ...env, ...extra }, maxBuffer: 1 << 28 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};
const rows: Array<[string, string, string, boolean]> = [];
const gate = (id: string, what: string, value: string, pass: boolean) => rows.push([id, what, value, pass]);

const t = run('npm', ['test']);
fs.writeFileSync(path.join(tmp, 'npm-test.log'), t.out);
const failedTests = [...t.out.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]).join('; ');
const pass = t.out.match(/ℹ pass (\d+)/)?.[1], fail = t.out.match(/ℹ fail (\d+)/)?.[1];
gate('G-S2-9', 'npm test', `${pass}/${Number(pass) + Number(fail)}${failedTests ? ` (failed: ${failedTests})` : ''}`, t.code === 0 && fail === '0');
const e = run('npm', ['run', 'eval']);
const fh = e.out.match(/Fair Housing: (\d+)\/(\d+)/);
gate('G-S2-9', 'npm run eval', `exit ${e.code}`, e.code === 0);
gate('G-S2-9', 'fair housing', fh ? `${fh[1]}/${fh[2]}` : 'missing', !!fh && fh[1] === fh[2] && fh[2] === '54');
const p = run('npm', ['run', 'eval:paraphrase']);
gate('G-S2-9', 'paraphrase parity', `exit ${p.code}`, p.code === 0);
const tsc = run('npx', ['tsc', '--noEmit', '-p', '.']);
const tscErrs = (tsc.out.match(/error TS/g) ?? []).length;
gate('G-S2-9', 'tsc errors', `${tscErrs} (baseline ${TSC_BASELINE})`, tscErrs <= TSC_BASELINE);

type Fuzz = Record<string, any>;
const fuzz = (seed: string, n: string, extra: string[] = []): Fuzz | null => {
  const r = run('node', ['--no-warnings', 'scripts/s2-fuzz.ts', n, ...extra], { SEED: seed });
  fs.writeFileSync(path.join(tmp, `fuzz-${seed}${extra.length ? '-down' : ''}.log`), r.out);
  try { return JSON.parse(r.out.trim().split('\n').at(-1)!); } catch { return null; }
};
const classesOk = (f: Fuzz) => Object.values(f.forgeryByClass as Record<string, { tried: number; accepted: number }>)
  .every((c) => (c.tried >= 50 ? c.accepted / c.tried <= 0.02 : c.accepted === 0));
for (const seed of ['7311', SEED2]) {
  const f = fuzz(seed, N);
  if (!f) { gate('G-S2-*', `fuzz seed ${seed}`, 'no output', false); continue; }
  const s = `seed ${seed}`;
  gate('G-S2-2', `${s} wrong of answered ≤ 1%`, `${f.wrong}/${f.answered} (${f.wrongPctOfAnswered}%)`, f.wrongPctOfAnswered <= 1);
  gate('G-S2-3', `${s} answered or correct-after-clarify ≥ 60%`, `${f.coveragePct}%`, f.coveragePct >= 60);
  gate('G-S2-4', `${s} forgery ≤ 0.5%, no class > 2%`, `${f.forgeryAcceptancePct}% of ${f.forgeriesTried}`, f.forgeryAcceptancePct <= 0.5 && classesOk(f));
  gate('G-S2-5', `${s} false rejections = 0`, `${f.falseRejections}`, f.falseRejections === 0);
  gate('G-S2-6', `${s} dead ends ≤ 5% (answerable)`, `${f.deadEndAnswerablePct}% of ${f.answerable} (all turns: ${f.deadEndPct}%)`, f.deadEndAnswerablePct <= 5);
  gate('G-S2-6', `${s} correct after one clarify ≥ 90%`, `${f.correctAfterOneClarifyPct}% of ${f.clarifyWithTruth}`, f.correctAfterOneClarifyPct >= 90);
  gate('G-S2-6', `${s} restatement missing = 0`, `${f.restatementMissing}`, f.restatementMissing === 0);
  gate('G-S2-7', `${s} negation/unappliable wrong = 0`, `${f.negationUnappliable.wrong}/${f.negationUnappliable.asked}`, f.negationUnappliable.wrong === 0);
}
// G-S2-8: endpoint unreachable (port 9 discards), uncached, 200 questions.
const d = fuzz('7311', '200', ['--model', 'http://127.0.0.1:9/v1']);
gate('G-S2-8', 'model down: deterministic path, G-S2-2/4 hold', d ? `paths ${JSON.stringify(d.paths)}, wrong ${d.wrong}, forgery ${d.forgeryAcceptancePct}%` : 'no output',
  !!d && (d.paths.deterministic ?? 0) === 200 && d.wrongPctOfAnswered <= 1 && d.forgeryAcceptancePct <= 0.5 && classesOk(d));
if (!argv.includes('--skip-compare')) {
  const c = run('bash', ['scripts/compare-main.sh']);
  fs.writeFileSync(path.join(tmp, 'compare-main.md'), c.out);
  gate('G-S2-11', 'zero regressions vs main 6790d75', c.out.match(/regressions: \d+/)?.[0] ?? 'missing', c.code === 0);
}
gate('G-S2-10', 'seed 7311, private temp dir, no push', tmp, true);

console.log('| gate | check | value | result |\n|---|---|---|---|');
for (const [id, what, value, ok] of rows) console.log(`| ${id} | ${what} | ${value} | ${ok ? 'PASS' : '**FAIL**'} |`);
const failed = rows.filter((r) => !r[3]).length;
console.log(`\n${failed ? `${failed} gate check(s) failed` : 'all gate checks passed'}; G-S2-1 (hidden set H) is Eval's. Logs: ${tmp}`);
process.exit(failed ? 1 : 0);
