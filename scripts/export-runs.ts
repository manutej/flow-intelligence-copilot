/**
 * Exports run-memory verdict rows as JSONL for the query graph
 * (/home/box/tau/drafts/query-graph/SCHEMA.md), plus MANIFEST.md and
 * manifest.json mapping run_id -> {source, eval_split}.
 *
 *   node --no-warnings scripts/export-runs.ts [--out-dir DIR] [--manifest manifest.json]
 *
 * Only eval_split dev|train is exported; Eval's hidden set H (or any
 * hidden/held/unknown split) is never written. No Flow data rows are
 * exported: typed queries, tokens, ids and hashes only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { RunStore } from '../src/agent/run-store.ts';

const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const runs = await RunStore.open(flag('--runs-dir') ?? undefined);
const outDir = path.resolve(flag('--out-dir') ?? path.join(runs.dir, 'export'));
const manifestFile = flag('--manifest') ?? path.join(runs.dir, 'manifest.json');
const manifest = (fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {}) as Record<string, { source?: string; eval_split?: string }>;

const hidden = (s: string) => s === 'H' || /^(hidden|eval-h)$/i.test(s) || /hidden|held/i.test(s);
const admit = (m: { source?: string; eval_split?: string } | undefined): string | null =>
  !m?.source ? 'source missing' : hidden(m.source) ? 'hidden source' : !['dev', 'train'].includes(m.eval_split ?? '') ? `split ${m.eval_split ?? 'missing'}` : null;

const all = runs.all();
const picks = new Map(all.filter((r) => r.type === 'pick').map((r) => [r.key, r]));
const rows: unknown[] = [];
const kept = new Map<string, { source: string; eval_split: string }>();
const rejected = new Map<string, string>();
for (const r of all) {
  if (r.type !== 'verdict' || !r.run_id) continue;
  const m = manifest[r.run_id];
  const why = admit(m);
  if (why) { rejected.set(r.run_id, why); continue; }
  kept.set(r.run_id, { source: m!.source!, eval_split: m!.eval_split! });
  const pick = picks.get(r.key);
  rows.push({
    run_id: r.run_id, model: r.model ?? null, qid: r.qid ?? null, origin: 'export', source: m!.source, eval_split: m!.eval_split,
    question_norm: r.question_norm ?? null, typed_query: r.typed_query ?? null,
    fields_bound: r.coverage?.fields_bound ?? [], unbound_tokens: r.coverage?.unbound ?? [], outcome: r.outcome ?? 'dead_end',
    correction: pick ? { kind: 'clarify_pick', pick: pick.pick ?? null, typed_query: pick.typed_query ?? null } : (r.correction ? { kind: 'correction', ...(r.correction as object) } : null),
  });
}
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'runs.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(Object.fromEntries(kept), null, 2)}\n`);
fs.writeFileSync(path.join(outDir, 'MANIFEST.md'), ['| run_id | source | eval_split |', '|---|---|---|', ...[...kept].map(([id, m]) => `| ${id} | ${m.source} | ${m.eval_split} |`)].join('\n') + '\n');
console.log(JSON.stringify({ outDir, rows: rows.length, runs: kept.size, rejectedRuns: Object.fromEntries(rejected) }));
