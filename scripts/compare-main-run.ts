/**
 * Runs the interview problems against one tree's copilot (deterministic,
 * model parse off) and prints one JSONL row per question. Used by
 * scripts/compare-main.sh for main (6790d75) and HEAD.
 *   node --no-warnings scripts/compare-main-run.ts <tree-root>
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

delete process.env.FLOWIQ_PARSE_URL;
const root = path.resolve(process.argv[2] ?? '.');
const { askFlowIqCopilot } = await import(pathToFileURL(path.join(root, 'src/agent/copilot.ts')).href);
const { loadPortfolioStore } = await import(pathToFileURL(path.join(root, 'src/data/loader.ts')).href);
const store = loadPortfolioStore(root);

const nums = (s: string) => (s.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ''));
const matches = (exp: unknown, got: unknown): boolean => {
  if (exp === null || exp === undefined) return true;
  if (typeof exp === 'number') return typeof got === 'number' && Math.abs(exp - got) < 1e-6;
  if (Array.isArray(exp)) return Array.isArray(got) && exp.length === got.length && exp.every((e, i) => matches(e, got[i]));
  if (typeof exp === 'object') return got !== null && typeof got === 'object' && Object.entries(exp as object).every(([k, v]) => matches(v, (got as Record<string, unknown>)[k]));
  return exp === got;
};
for (const set of ['dev', 'test', 'heldout', 'operadic-interview-bank']) {
  const lines = fs.readFileSync(path.join(root, 'questions', `${set}.jsonl`), 'utf8').split('\n').filter((l) => l.trim());
  for (const line of lines) {
    const q = JSON.parse(line) as Record<string, unknown>;
    const question = String(q.question ?? q.direct_question);
    const id = String(q.id);
    const t = await askFlowIqCopilot({ id, type: String(q.type ?? 'adhoc'), question }, { store, mode: 'deterministic' });
    const correct = q.expected === undefined ? null : matches(q.expected, t.envelope.result);
    console.log(JSON.stringify({ set, id, correct, numbers: nums(t.envelope.answer), answer: t.envelope.answer }));
  }
}
