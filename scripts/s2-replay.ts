/**
 * Replay a recorded s2-live run offline: each question gets the model reply
 * the live run logged (or garbage, or no model), so a parse change can be
 * measured without the endpoint.
 *
 *   node --no-warnings scripts/s2-replay.ts live.jsonl [--mode replay|garbage|off] [--out f]
 */
import fs from 'node:fs';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { DEFAULT_GRAMMAR, type ParseConfig } from '../src/agent/model-parse.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const mode = flag('--mode') ?? 'replay';
const rows = fs.readFileSync(argv[0], 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { qid: string; question: string; raw_output: string | null; fallback: string | null });
const store = await loadPortfolioStore();
const cfg: ParseConfig = { baseUrl: 'http://replay/v1', model: 'replay', timeoutMs: 1000, backend: 'llama', quant: 'replay', grammarPath: DEFAULT_GRAMMAR, cache: false };
const tally: Record<string, number> = {};
const out: string[] = [];
for (const row of rows) {
  const raw = mode === 'garbage' ? '{"kind":"query","intent":{"domain":"nope"}}' : row.raw_output;
  const fetch = async () => (raw === null ? Promise.reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })) : { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: raw } }] }) });
  const turn = await askFlowIqCopilot({ id: row.qid, type: 'adhoc', question: row.question }, { store, parse: mode === 'off' ? null : cfg, parseDeps: { fetch, runStore: null } });
  const r = turn.envelope.result as Record<string, unknown>;
  const outcome = r.unknown !== true && r.refused !== true && r.clarification_needed !== true ? 'answered' : turn.clarificationNeeded ? 'clarified' : 'dead_end';
  tally[outcome] = (tally[outcome] ?? 0) + 1;
  out.push(JSON.stringify({ qid: row.qid, outcome, path: turn.parsePath ?? 'off', fallback: turn.parseFallbackReason ?? null, answer: turn.envelope.answer }));
}
if (flag('--out')) fs.writeFileSync(flag('--out')!, `${out.join('\n')}\n`);
console.log(JSON.stringify({ mode, n: rows.length, ...tally }));
