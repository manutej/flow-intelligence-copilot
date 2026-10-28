import path from "node:path";
import { sealEvaluatorVaultFiles } from "../src/config/key-vault.ts";
import {
  runParallelTemporalLlmSwarm,
  writeTemporalLlmSwarmArtifacts,
} from "../src/workflows/temporal-llm-swarm.ts";

async function main() {
  const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

  // Ensure the AES-256-GCM evaluator vault is sealed and up to date
  const vault = sealEvaluatorVaultFiles(repoRoot);

  const result = await runParallelTemporalLlmSwarm({
    repoRoot,
    sampleSize: 40,
    concurrency: 8,
    simulateCrash: true,
    crashAtCompletedCount: 18,
    enableLiveNetworkCalls: true,
    includeGrokCliProbe: true,
  });

  const { tracePath, reportPath } = writeTemporalLlmSwarmArtifacts(
    repoRoot,
    result,
  );

  console.log(
    "====================================================================================================",
  );
  console.log(
    "  FLOWIQ PARALLEL TEMPORAL LLM ACTIVITY SWARM · 40-of-600 Batch + Crash Recovery + 600-Bank Sweep",
  );
  console.log(
    "====================================================================================================",
  );
  console.log(
    `  Workflow / Run ID       : ${result.workflowId} / ${result.runId}`,
  );
  console.log(
    `  Protected Key Vault     : ${vault.vaultPath} (unlocked=${result.vaultStatus.vaultUnlocked}, tier=${result.vaultStatus.priorityTier})`,
  );
  console.log(
    `  Active LLM Provider     : ${result.vaultStatus.activeProvider} (${result.vaultStatus.activeModel}) | key=${result.vaultStatus.maskedKeyPreview}`,
  );
  if (result.vaultStatus.grokCliLiveProbe) {
    console.log(
      `  Grok CLI Live Probe     : ok=${result.vaultStatus.grokCliLiveProbe.ok} | latency=${result.vaultStatus.grokCliLiveProbe.latencyMs}ms | output=${result.vaultStatus.grokCliLiveProbe.outputPreview}`,
    );
  }
  console.log(
    `  Parallel Pool & Batch   : ${result.sampleSize} activities across ${result.concurrency} concurrent worker slots`,
  );
  console.log(
    `  Crash & Replay Recovery : Crash injected at Activity #${result.crashInjectedAtActivity} (${result.inFlightWhenCrashedCount} in-flight). Replayed in ${result.replayHistoryDurationMs}ms.`,
  );
  console.log(
    `  Idempotency Guarantees  : skippedByKey=${result.skippedByIdempotencyKeyCount}, duplicateLlmCalls=${result.duplicateLlmInvocationsCount}, doubleBilledTokens=${result.doubleBilledTokensCount}, leakedExceptions=${result.leakedExceptionsCount}`,
  );
  console.log(
    `  40-Query Swarm Score    : ${result.passedActivitiesCount}/${result.sampleSize} (${result.accuracyPercent}%) | Citations: ${result.citationValidActivitiesCount}/${result.sampleSize} (${result.citationValidityPercent}%)`,
  );
  console.log(
    `  Live Network Calls      : ${result.liveNetworkCallsCompleted} completed | Total tokens: ${result.totalTokensUsed} | Wall-clock: ${result.totalWallClockMs}ms (avg=${result.avgActivityLatencyMs}ms, p95=${result.p95ActivityLatencyMs}ms)`,
  );
  console.log(
    `  Full 600-Question Sweep : ${result.fullBank600Summary.passedQuestions}/${result.fullBank600Summary.totalQuestions} (${result.fullBank600Summary.passRatePercent}%) in ${result.fullBank600Summary.elapsedMs}ms (${result.fullBank600Summary.throughputQueriesPerSec.toLocaleString()} queries/sec)`,
  );
  console.log(`  State Digest (SHA-256)  : ${result.stateDigestSha256}`);
  console.log(`  Trace JSON              : ${tracePath}`);
  console.log(`  Report Markdown         : ${reportPath}`);
  console.log(
    "====================================================================================================",
  );

  if (
    result.passedActivitiesCount !== result.sampleSize ||
    result.citationValidActivitiesCount !== result.sampleSize ||
    result.duplicateLlmInvocationsCount !== 0 ||
    result.fullBank600Summary.passedQuestions !== 600
  ) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
