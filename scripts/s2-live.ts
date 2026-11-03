/**
 * S2 live run: a JSONL question file against a live parse endpoint.
 *
 *   FLOWIQ_PARSE_URL=http://127.0.0.1:8081/v1 FLOWIQ_PARSE_MODEL=<model> \
 *   node --no-warnings scripts/s2-live.ts questions.jsonl [--out out.jsonl] \
 *     [--no-cache] [--run-id ID] [--source NAME] [--split dev|train]
 *
 * Input lines: {"qid"?: string, "question": string, "expected"?: number}.
 * Output lines: qid, path, fallback, raw model output, parsed query, coverage,
 * answer, latency. Records go to data-local/runs (ids and hashes only); the
 * run's source/split go to data-local/runs/manifest.json for export-runs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { parseConfigFromEnv } from '../src/agent/model-parse.ts';
import { RunStore, normalizeQuestion } from '../src/agent/run-store.ts';
import { hashOf } from '../src/agent/envelope.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const file = argv[0];
if (!file || file.startsWith('--')) { console.error('usage: s2-live.ts questions.jsonl [--out f] [--no-cache] [--run-id id] [--source s] [--split dev|train]'); process.exit(2); }
const noCache = argv.includes('--no-cache');
const env = noCache ? { ...process.env, FLOWIQ_PARSE_NO_CACHE: '1' } : process.env;
const cfg = parseConfigFromEnv(env);
if (!cfg) { console.error('FLOWIQ_PARSE_URL is unset; refusing a live run on the deterministic path.'); process.exit(2); }
const runId = flag('--run-id') ?? `s2-live-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const out = flag('--out') ?? path.resolve('data-local/runs', `${runId}.jsonl`);
const store = loadPortfolioStore();
const runs = await RunStore.open();
const manifestFile = path.join(runs.dir, 'manifest.json');
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as Record<string, unknown> : {};
manifest[runId] = { source: flag('--source') ?? path.basename(file, '.jsonl'), eval_split: flag('--split') ?? 'dev' };
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, '');

// Questions run one at a time (concurrency 1). FLOWIQ_PARSE_BUDGET_MS caps
// the run's total model time; once spent, the rest run model-off and say so.
const budgetMs = Number(env.FLOWIQ_PARSE_BUDGET_MS ?? 0);
let modelMs = 0;
const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
const tally: Record<string, number> = {};
for (const [k, line] of lines.entries()) {
  const q = JSON.parse(line) as { qid?: string; id?: string; question: string; expected?: number };
  const qid = q.qid ?? q.id ?? `q${k + 1}`;
  const t0 = performance.now();
  const overBudget = budgetMs > 0 && modelMs >= budgetMs;
  const turn = await askFlowIqCopilot({ id: qid, type: 'adhoc', question: q.question }, { store, parse: overBudget ? null : cfg, parseDeps: { runStore: runs } });
  modelMs += turn.parse?.latencyMs ?? 0;
  const r = turn.envelope.result as Record<string, unknown>;
  const answered = r.unknown !== true && r.refused !== true && r.clarification_needed !== true;
  const fig = typeof r.value === 'number' ? r.value : typeof r.count === 'number' ? r.count : null;
  const wrong = answered && typeof q.expected === 'number' && fig !== null && Math.abs(fig - q.expected) > 1e-6;
  const outcome = wrong ? 'wrong' : answered ? 'answered' : turn.clarificationNeeded ? 'clarified' : 'dead_end';
  tally[outcome] = (tally[outcome] ?? 0) + 1;
  const mp = turn.parse;
  const row = {
    qid, question: q.question, path: turn.parsePath ?? 'deterministic', fallback: overBudget ? `model budget ${budgetMs} ms spent; model off` : turn.parse ? (turn.parseFallbackReason ?? null) : `pre_model:${r.refused === true ? 'fair_housing' : r.unknown === true ? 'out_of_scope' : 'guard'}`, cache_hit: mp?.cacheHit ?? false,
    raw_output: mp?.raw ?? null, parsed_query: mp?.intent ?? null, coverage: mp?.coverage ?? null, outcome, answer: turn.envelope.answer,
    clarify_options: (turn.clarifyOptions ?? []).map((o) => o.question), restatement: turn.restatement ?? null,
    model_latency_ms: mp?.latencyMs ?? null, total_latency_ms: Math.round(performance.now() - t0), verified: answered && turn.verification.valid, call: mp?.call ?? null,
  };
  fs.appendFileSync(out, `${JSON.stringify(row)}\n`);
  runs.append({
    type: 'verdict', key: mp?.runKey ?? hashOf(normalizeQuestion(q.question)), ts: new Date().toISOString(), run_id: runId, qid, model: cfg.model,
    question_norm: normalizeQuestion(q.question), typed_query: turn.envelope.query ?? mp?.intent ?? null, coverage: mp?.coverage, path: row.path,
    clarify_options: row.clarify_options, answer_hash: hashOf({ answer: turn.envelope.answer, result: turn.envelope.result }), latency_ms: row.total_latency_ms,
    outcome, verdict: typeof q.expected === 'number' && answered ? (wrong ? 'wrong' : 'correct') : 'unknown',
  });
}
console.log(JSON.stringify({ run_id: runId, out, endpoint: cfg.baseUrl, model: cfg.model, cache: noCache ? 'off (--no-cache)' : 'on', questions: lines.length, ...tally }));
