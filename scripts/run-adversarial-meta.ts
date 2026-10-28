import path from "node:path";
import {
  runAdversarialMetaSuite,
  writeAdversarialMetaArtifacts,
} from "../src/eval/adversarial-meta.ts";

async function main(): Promise<void> {
  const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
  const report = await runAdversarialMetaSuite(repoRoot);
  const { reportPath, ledgerPath } = writeAdversarialMetaArtifacts(repoRoot, report);

  console.log(
    `=== BLINDED RED-TEAM / BLUE-TEAM ADVERSARIAL META-LEARNING ===`,
  );
  console.log(
    `Red-Team Probes   : ${report.adversarialPassCount}/${report.adversarialTotalCount} (${report.adversarialPassRate.toFixed(1)}%) PASSED`,
  );
  console.log(
    `Blue-Team Gate    : ${report.blueCompression.bloatGatePassed ? "PASS" : "FAIL"} (coreDomainLoc=${report.blueCompression.coreDomainLoc}, primitiveCompressionRatio=${report.blueCompression.primitiveCompressionRatio}, bloatPenalty=${report.blueCompression.bloatPenalty})`,
  );
  console.log(`Meta-Learning Progression:`);
  for (const r of report.rounds) {
    console.log(
      `  [Round ${r.round}: ${r.roundId.padEnd(28)}] Survival: ${String(r.probesPassed).padStart(2)}/${r.probesTotal} (${r.survivalRatePct.toFixed(1)}%) | Primitives: ${r.conceptualPrimitivesCount} | Ad-Hoc Patches: ${r.adHocPatchCount} | Compression: ${r.compressionScore}`,
    );
  }
  console.log(`Surface Breakdown:`);
  for (const [surface, stat] of Object.entries(report.bySurface)) {
    console.log(`  - ${surface.padEnd(36)}: ${stat.passed}/${stat.total}`);
  }
  console.log(`Artifacts written : ${path.relative(repoRoot, reportPath)} & ${path.relative(repoRoot, ledgerPath)}`);

  if (
    report.adversarialPassCount !== report.adversarialTotalCount ||
    !report.blueCompression.bloatGatePassed
  ) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
