import path from 'node:path';
import {
  runDurableWorkflowSimulation,
  writeDurableWorkflowArtifacts,
} from '../src/workflows/temporal-worker.ts';

async function main(): Promise<void> {
  const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
  const result = runDurableWorkflowSimulation({
    totalRows: 250_000,
    shardCount: 10,
    injectFaultAtShard: 6,
    faultCrashAtFraction: 0.5,
  });

  const { reportPath, tracePath } = writeDurableWorkflowArtifacts(
    repoRoot,
    result,
  );

  console.log(
    `=== DURABLE TEMPORAL WORKFLOW SIMULATION (250,000 ROWS · 10 SHARDS) ===`,
  );
  console.log(
    `  Workflow ID / Run ID : ${result.workflowId} / ${result.runId}`,
  );
  console.log(
    `  Total Rows Processed : ${result.totalRowsProcessed.toLocaleString()} rows (${result.shardCount} shards x ${result.rowsPerShard.toLocaleString()} rows)`,
  );
  console.log(
    `  Elapsed / Throughput : ${result.totalElapsedMs.toFixed(2)} ms (${result.throughputRowsPerSec.toLocaleString()} rows/sec)`,
  );
  console.log(
    `  Fault & Replay Proof : Shard #${result.faultInjectedShard} crashed @ row ${result.faultCrashRow.toLocaleString()} -> Replayed Shards 1-${result.replayedShardsCount} (0ms) -> Resumed Shard #${result.faultInjectedShard} @ row ${result.heartbeatResumeRow.toLocaleString()}`,
  );
  console.log(
    `  SHA-256 State Digest : ${result.stateDigestSha256} (Replay Match: ${result.replayDigestMatch})`,
  );
  console.log(
    `  Canonical Kit Anchor : ${result.canonicalKitAnchor.kitRows} rows | Dead Spend=$${result.canonicalKitAnchor.kitDeadSpendUsd.toFixed(2)} | +${result.canonicalKitAnchor.kitReallocatedLeases} leases on ${result.canonicalKitAnchor.kitLowestCpslSource}`,
  );
  console.log(
    `  Artifacts Written    : ${path.relative(repoRoot, reportPath)} & ${path.relative(repoRoot, tracePath)}`,
  );

  if (!result.replayDigestMatch || result.totalElapsedMs > 350) {
    console.error('Durable workflow verification failed!');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
