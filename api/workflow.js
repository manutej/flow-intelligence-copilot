import path from 'node:path';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { runDurableWorkflowSimulation } from '../src/workflows/temporal-worker.ts';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const params = Object.fromEntries(urlObj.searchParams.entries());

    const totalRows = params.rows
      ? Math.min(1_000_000, Math.max(10_000, Number.parseInt(params.rows, 10)))
      : 250_000;
    const shardCount = params.shards
      ? Math.min(50, Math.max(2, Number.parseInt(params.shards, 10)))
      : 10;
    const injectFaultAtShard = params.faultShard
      ? Number.parseInt(params.faultShard, 10)
      : 6;

    const store = loadPortfolioStore(repoRoot);
    const result = runDurableWorkflowSimulation({
      totalRows,
      shardCount,
      injectFaultAtShard,
      store,
    });

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        ok: true,
        ...result,
      }),
    );
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
