import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Run memory (S2): an append-only store of model parses so a model run is
 * never wasted. SQLite at data-local/runs/runs.sqlite with a JSONL mirror;
 * both are gitignored and local. Records hold question text, model output,
 * typed queries, ids and hashes only: never a key, never a Flow data row.
 */
export interface RunKeyParts {
  readonly question: string;
  readonly model: string;
  readonly quant: string;
  readonly grammarSha: string;
  readonly promptSha: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface RunRecord {
  readonly type: 'parse' | 'turn' | 'pick' | 'verdict';
  readonly key: string;
  readonly ts: string;
  readonly question_norm?: string;
  readonly model?: string;
  readonly raw_output?: string | null;
  readonly typed_query?: unknown;
  readonly coverage?: { readonly ok: boolean; readonly unbound: readonly string[]; readonly fields_bound: readonly string[] };
  readonly path?: string;
  readonly clarify_options?: readonly string[];
  readonly pick?: number;
  readonly answer_hash?: string | null;
  readonly latency_ms?: number;
  readonly verdict?: 'correct' | 'wrong' | 'unknown';
  readonly correction?: unknown;
  /** Run-level fields, written by scripts/s2-live.ts for export-runs. */
  readonly run_id?: string;
  readonly qid?: string;
  readonly outcome?: 'answered' | 'clarified' | 'dead_end' | 'wrong';
}

export const normalizeQuestion = (q: string): string => q.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

export function runKey(p: RunKeyParts): string {
  return sha256(JSON.stringify([normalizeQuestion(p.question), p.model, p.quant, p.grammarSha, p.promptSha, p.params]));
}

interface Db { exec(sql: string): void; prepare(sql: string): { run(...a: unknown[]): unknown; get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] } }

export class RunStore {
  readonly dir: string;
  private db: Db | null = null;
  private constructor(dir: string, db: Db | null) {
    this.dir = dir;
    this.db = db;
  }

  static async open(dir = path.resolve('data-local/runs')): Promise<RunStore> {
    fs.mkdirSync(dir, { recursive: true });
    let db: Db | null = null;
    try {
      const { DatabaseSync } = (await import('node:' + 'sqlite')) as unknown as { DatabaseSync: new (f: string) => Db };
      db = new DatabaseSync(path.join(dir, 'runs.sqlite'));
      db.exec('CREATE TABLE IF NOT EXISTS runs (seq INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, type TEXT NOT NULL, ts TEXT NOT NULL, record TEXT NOT NULL); CREATE INDEX IF NOT EXISTS runs_key ON runs(key, type)');
    } catch {
      db = null; // JSONL mirror alone when node:sqlite is unavailable.
    }
    return new RunStore(dir, db);
  }

  append(r: RunRecord): void {
    const line = JSON.stringify(r);
    this.db?.prepare('INSERT INTO runs (key, type, ts, record) VALUES (?, ?, ?, ?)').run(r.key, r.type, r.ts, line);
    fs.appendFileSync(path.join(this.dir, 'runs.jsonl'), `${line}\n`);
  }

  /** The latest stored parse for a key, if any. */
  lookup(key: string): RunRecord | null {
    if (this.db) {
      const row = this.db.prepare("SELECT record FROM runs WHERE key = ? AND type = 'parse' ORDER BY seq DESC LIMIT 1").get(key) as { record: string } | undefined;
      return row ? (JSON.parse(row.record) as RunRecord) : null;
    }
    return this.all().filter((r) => r.key === key && r.type === 'parse').at(-1) ?? null;
  }

  all(): RunRecord[] {
    if (this.db) return (this.db.prepare('SELECT record FROM runs ORDER BY seq').all() as Array<{ record: string }>).map((r) => JSON.parse(r.record) as RunRecord);
    const f = path.join(this.dir, 'runs.jsonl');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as RunRecord) : [];
  }
}
