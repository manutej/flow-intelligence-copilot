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
// TENACITY F1: FLOWIQ_PARSE_URL is kept. Only the unit tests and evals run
// model-off; the fuzz runs model-off, against an adversarial replay model,
// and against the live model when the URL is set.
const LIVE = env.FLOWIQ_PARSE_URL ?? '';
env.FLOWIQ_PARSE_NO_CACHE = '1';
const OFF = { FLOWIQ_PARSE_URL: '' };

const run = (cmd: string, args: string[], extra: Record<string, string> = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', env: { ...env, ...extra }, maxBuffer: 1 << 28 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};
const rows: Array<[string, string, string, boolean]> = [];
const gate = (id: string, what: string, value: string, pass: boolean) => rows.push([id, what, value, pass]);

const t = run('npm', ['test'], OFF);
fs.writeFileSync(path.join(tmp, 'npm-test.log'), t.out);
const failedTests = [...t.out.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]).join('; ');
const pass = t.out.match(/ℹ pass (\d+)/)?.[1], fail = t.out.match(/ℹ fail (\d+)/)?.[1];
gate('G-S2-9', 'npm test', `${pass}/${Number(pass) + Number(fail)}${failedTests ? ` (failed: ${failedTests})` : ''}`, t.code === 0 && fail === '0');
const e = run('npm', ['run', 'eval'], OFF);
const fh = e.out.match(/Fair Housing: (\d+)\/(\d+)/);
gate('G-S2-9', 'npm run eval', `exit ${e.code}`, e.code === 0);
gate('G-S2-9', 'fair housing', fh ? `${fh[1]}/${fh[2]}` : 'missing', !!fh && fh[1] === fh[2] && fh[2] === '54');
const p = run('npm', ['run', 'eval:paraphrase'], OFF);
gate('G-S2-9', 'paraphrase parity', `exit ${p.code}`, p.code === 0);
const tsc = run('npx', ['tsc', '--noEmit', '-p', '.']);
const tscErrs = (tsc.out.match(/error TS/g) ?? []).length;
gate('G-S2-9', 'tsc errors', `${tscErrs} (baseline ${TSC_BASELINE})`, tscErrs <= TSC_BASELINE);

type Fuzz = Record<string, any>;
const fuzz = (seed: string, n: string, extra: string[] = []): Fuzz | null => {
  const r = run('node', ['--no-warnings', 'scripts/s2-fuzz.ts', n, ...extra], { SEED: seed, ...(extra.length ? {} : OFF) });
  fs.writeFileSync(path.join(tmp, `fuzz-${seed}-${n}${extra.join('').replace(/\W+/g, '_')}.log`), r.out);
  try { return JSON.parse(r.out.trim().split('\n').at(-1)!); } catch { return null; }
};
const classesOk = (f: Fuzz) => Object.values(f.forgeryByClass as Record<string, { tried: number; accepted: number }>)
  .every((c) => (c.tried >= 50 ? c.accepted / c.tried <= 0.02 : c.accepted === 0));
const modes: Array<[string, string[]]> = [['off', []], ['adversarial', ['--adversarial']]];
if (LIVE) modes.push(['live', ['--model', LIVE]]);
for (const [mode, extra] of modes) for (const seed of ['7311', SEED2]) {
  const f = fuzz(seed, N, extra);
  if (!f) { gate('G-S2-*', `${mode} fuzz seed ${seed}`, 'no output', false); continue; }
  const s = `${mode} seed ${seed}`;
  if (mode !== 'off') gate('G-S2-2', `${s} model-path answers that diverge from the lexicon = 0`, `${f.modelDivergedAnswers} (paths ${JSON.stringify(f.paths)})`, f.modelDivergedAnswers === 0);
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
// Same seed and size with the model off: a down model must change nothing.
const d = fuzz('7311', '200', ['--model', 'http://127.0.0.1:9/v1']);
const o = fuzz('7311', '200');
const same = (k: string) => JSON.stringify(d?.[k]) === JSON.stringify(o?.[k]);
gate('G-S2-8', 'model down = model off (paths, answers, wrong, coverage, forgery)', d && o ? `paths ${JSON.stringify(d.paths)}, answered ${d.answered}/${o.answered}, coverage ${d.coveragePct}/${o.coveragePct}%` : 'no output',
  !!d && !!o && (d.paths.deterministic ?? 0) === 200 && ['answered', 'wrong', 'coveragePct', 'forgeryAcceptancePct', 'falseRejections', 'deadEndPct'].every(same));
// F4: question sets the S2 generator did not write.
// Each source and tier blocks on its own pinned sha256 and answer floor
// (scripts/external-sets.json); the generalization tier is a non-answer
// stress set, so only its verifier counts gate it.
const SCN = '/home/box/flowiq-scenarios/v1/set/questions.jsonl';
for (const [src, tier] of [[SCN, 'grounded'], [SCN, 'generalization'], ['questions/operadic-600-bank.jsonl', null]] as const) {
  const x = run('node', ['--no-warnings', 'scripts/s3-external-fuzz.ts', src, ...(tier ? ['--tier', tier] : [])], OFF);
  let j: (Fuzz & Record<string, any>) | null = null; try { j = JSON.parse(x.out.trim().split('\n').at(-1)!); } catch { /* no output */ }
  gate('G-S2-5', `external ${path.basename(src)}${tier ? ` [${tier}]` : ''}: pin, floor, false rejections 0, forgeries 0`, j ? `${j.pinError ?? 'pin ok'}, answered ${j.answeredPct}% (floor ${j.answerFloorPct}%), false rej ${j.falseRejections}+${j.nonAnswerFalseRejections}, forged ${j.coherentForgeriesAccepted + j.nonAnswerAndShapeForgeriesAccepted}/${j.coherentForgeries + j.nonAnswerAndShapeForgeries}` : 'no output', x.code === 0 && !!j);
}
if (!argv.includes('--skip-compare')) {
  const c = run('bash', ['scripts/compare-main.sh']);
  fs.writeFileSync(path.join(tmp, 'compare-main.md'), c.out);
  gate('G-S2-11', 'zero regressions vs main 6790d75', c.out.match(/regressions: \d+/)?.[0] ?? 'missing', c.code === 0);
}
const upstream = run('git', ['rev-parse', '--abbrev-ref', '@{u}']);
gate('G-S2-10', 'seed 7311 run, private temp dir, branch has no upstream', `${tmp}${upstream.code === 0 ? ` upstream ${upstream.out.trim()}` : ''}`,
  modes.length >= 2 && tmp.startsWith(os.tmpdir()) && fs.existsSync(path.join(tmp, 'fuzz-7311-' + N + '.log')) && upstream.code !== 0);

console.log('| gate | check | value | result |\n|---|---|---|---|');
for (const [id, what, value, ok] of rows) console.log(`| ${id} | ${what} | ${value} | ${ok ? 'PASS' : '**FAIL**'} |`);
const failed = rows.filter((r) => !r[3]).length;
console.log(`\n${failed ? `${failed} gate check(s) failed` : 'all gate checks passed'}; S2 cannot pass until Eval runs G-S2-1 (hidden set H). Logs: ${tmp}`);
process.exit(failed ? 1 : 0);
