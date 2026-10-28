import fs from 'node:fs';
import path from 'node:path';
import { loadPortfolioStore, roundTo } from '../src/data/loader.ts';
import {
  evaluateBudgetDecisionsAndLearn,
  formatDecisionsAsCsv,
} from '../src/domain/learner.ts';
import {
  queryDataQualityAudit,
  queryMarketingSpendAndFunnel,
} from '../src/domain/metrics.ts';

function formatMoney(usd: number): string {
  return `$${usd.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function generateDeadSpendMarkdown(): string {
  const store = loadPortfolioStore();
  const mkt = queryMarketingSpendAndFunnel(store, {
    period: 'Apr-Sep 2026',
    paidOnly: true,
  });
  const dq = queryDataQualityAudit(store);
  const learner = evaluateBudgetDecisionsAndLearn(store);

  const realloc = mkt.deadSpendReallocation;
  const totalPortfolioPaidSpend = roundTo(
    mkt.bySource.reduce((acc, s) => acc + s.spendUsd, 0),
    2,
  );
  const deadSharePercent =
    totalPortfolioPaidSpend > 0
      ? roundTo((realloc.totalDeadSpendUsd / totalPortfolioPaidSpend) * 100, 1)
      : 0;

  // Pair-level recommendations mapped to best local building converter + portfolio converter
  const bestPaidByProperty = new Map<
    string,
    { source: string; cpsl: number; leases: number }
  >();
  for (const prop of store.operatingProperties) {
    const activeConverters = mkt.byPropertySource
      .filter(
        (r) =>
          r.propertyId === prop.propertyId &&
          r.isPaidSource &&
          r.signedLeasesInPeriod > 0 &&
          r.costPerSignedLeaseUsd !== null,
      )
      .sort(
        (a, b) =>
          (a.costPerSignedLeaseUsd ?? Number.POSITIVE_INFINITY) -
          (b.costPerSignedLeaseUsd ?? Number.POSITIVE_INFINITY),
      );
    if (activeConverters[0]) {
      bestPaidByProperty.set(prop.propertyId, {
        source: activeConverters[0].source,
        cpsl: activeConverters[0].costPerSignedLeaseUsd!,
        leases: activeConverters[0].signedLeasesInPeriod,
      });
    }
  }

  const operatingIds = store.operatingProperties.map((p) => p.propertyId);
  const onboardingSummary =
    store.onboardingProperties.length > 0
      ? store.onboardingProperties
          .map(
            (p) =>
              `\`${p.propertyId} ${p.name}\` excluded: ${p.actualUnitCount} units in \`units.csv\``,
          )
          .join('; ')
      : 'no onboarding exclusions';

  const cadDeadPairs = realloc.deadPairDetails.filter(
    (d) => d.cadInvoiceCount > 0,
  );
  const cadCalloutText =
    cadDeadPairs.length > 0
      ? cadDeadPairs
          .map(
            (d) =>
              `\`${d.propertyId} ${d.propertyName} · ${d.source}\` (\`${d.rawCadSpend.toLocaleString('en-US')} CAD\` posted = **${formatMoney(d.spendUsd)}**)`,
          )
          .join(' and ')
      : 'None';

  const monthCount = Math.max(1, mkt.months.length);

  const lines: string[] = [];
  lines.push('# FLOW-102 · Portfolio Dead-Spend & Reallocation Report');
  lines.push('');
  lines.push(
    `> **Generated programmatically** by \`scripts/generate-reports.ts\` on reference date \`${store.policy.asOfDate}\` across operating buildings \`${operatingIds[0]}\`–\`${operatingIds[operatingIds.length - 1]}\` (${onboardingSummary}).`,
  );
  lines.push(
    `> **Data normalization applied:** \`1 CAD = ${store.policy.cadToUsdRate} USD\` (${dq.postedCadSpendRowCount} posted CAD invoices), \`${dq.voidSpendRowCount} void\` invoices excluded (\`$0.00\`), \`${dq.duplicateLeadCount}\` duplicate phone-reentry leads deduplicated to earliest lead, and signed leases bucketed by \`leases.${store.policy.leaseBucketBy === 'lead_created_date' ? 'lead_created_date' : 'start_date'}\`.`,
  );
  lines.push('');
  lines.push('## 1. Executive Summary');
  lines.push('');
  lines.push(
    `- **Total Dead Spend (${mkt.windowLabel}):** **${formatMoney(realloc.totalDeadSpendUsd)}** across **${realloc.deadPairs.length} paid (building, source) pairs** that generated **0 signed leases** (${deadSharePercent}% of the portfolio's ${formatMoney(totalPortfolioPaidSpend)} total paid ILS/ad spend).`,
  );
  lines.push(
    `- **Foreign-Currency Dead Spend Caught:** Agency-billed accounts in Canadian Dollars — ${cadCalloutText} — produced **0 signed leases**.`,
  );
  lines.push(
    `- **Portfolio Reallocation Impact (\`B03\`):** Moving all **${formatMoney(realloc.totalDeadSpendUsd)}** of dead spend to the portfolio's lowest-cost paid source (**\`${realloc.bestPortfolioPaidSource}\`** at **${formatMoney(realloc.bestSourcePortfolioCpslUsd)}/lease**, \`${formatMoney(realloc.bestSourceSpendUsd)} ÷ ${realloc.bestSourceSignedLeases} leases\`) buys **\`${realloc.projectedAdditionalWholeLeases}\` additional signed leases** (\`floor(${realloc.totalDeadSpendUsd.toFixed(2)} ÷ ${realloc.bestSourceExactCpslUsd.toFixed(4)}) = ${realloc.projectedAdditionalWholeLeases}\`, unrounded \`${realloc.unroundedAdditionalLeases.toFixed(2)}\`).`,
  );
  lines.push('');
  lines.push(
    `## 2. Every Zero-Lease Paid Pair (\`T04\` — ${mkt.windowLabel})`,
  );
  lines.push('');
  lines.push(
    '| Building ID | Building Name | Paid Source | Posted Invoices | Void Excluded | Currency Note | Leads / Tours / Apps | Signed Leases | Dead Spend (USD) | Actionable Recommendation | Row Citations |',
  );
  lines.push('|---|---|---|---:|---:|---|---|---:|---:|---|---|');

  for (const row of realloc.deadPairDetails) {
    const localBest = bestPaidByProperty.get(row.propertyId);
    const currencyNote =
      row.cadInvoiceCount > 0
        ? `CAD (${row.cadInvoiceCount} rows × ${store.policy.cadToUsdRate})`
        : 'USD';
    const funnelStr = `${row.leadsCreatedCount}L / ${row.touredCount}T / ${row.appliedCount}A`;
    const recText = localBest
      ? `Kill 100% (${formatMoney(roundTo(row.spendUsd / monthCount, 2))}/mo) → reallocate to ${row.propertyId} ${localBest.source} (${formatMoney(localBest.cpsl)}/lease, ${localBest.leases} leases)`
      : `Kill 100% → reallocate to portfolio ${realloc.bestPortfolioPaidSource}`;
    const cits = row.citations.slice(0, 4).join(', ');

    lines.push(
      `| \`${row.propertyId}\` | ${row.propertyName} | \`${row.source}\` | ${row.postedInvoiceCount} | ${row.voidInvoiceCount} | ${currencyNote} | ${funnelStr} | **0** | **${formatMoney(row.spendUsd)}** | ${recText} | \`${cits}\` |`,
    );
  }

  lines.push(
    `| **TOTAL** | **${realloc.affectedBuildingCount} Buildings Affected** | **${realloc.deadPairs.length} Dead Pairs** | **${realloc.totalPostedInvoicesOnDeadPairs}** | **${realloc.totalVoidInvoicesOnDeadPairs}** | **USD + CAD** | **${realloc.totalDeadLeads}L / ${realloc.totalDeadTours}T / ${realloc.totalDeadApplied}A** | **0** | **${formatMoney(realloc.totalDeadSpendUsd)}** | **Reallocate to \`${realloc.bestPortfolioPaidSource}\` → +${realloc.projectedAdditionalWholeLeases} whole leases** | \`${realloc.citations.slice(0, 4).join(', ')}\` |`,
  );
  lines.push('');

  lines.push('## 3. Portfolio Paid Source Efficiency Ranking (`T03` & `B03`)');
  lines.push('');
  lines.push(
    `| Portfolio Rank | Paid Source | Total Spend (USD) | Signed Leases (${mkt.windowLabel}) | Cost Per Signed Lease (USD) | Leads → Tours → Leases | Tour-to-Lease % | Status |`,
  );
  lines.push('|---:|---|---:|---:|---:|---|---:|---|');

  const sortedSources = [...mkt.bySource]
    .filter((s) => s.isPaidSource)
    .sort(
      (a, b) =>
        (a.exactCostPerSignedLeaseUsd ?? Number.POSITIVE_INFINITY) -
        (b.exactCostPerSignedLeaseUsd ?? Number.POSITIVE_INFINITY),
    );

  sortedSources.forEach((s, idx) => {
    const tag =
      idx === 0
        ? '**Lowest CPSL (`B03` Reallocation Target)**'
        : idx === sortedSources.length - 1
          ? `**Highest CPSL (\`T03\`: ${s.costPerSignedLeaseUsd !== null ? formatMoney(s.costPerSignedLeaseUsd) : 'N/A'}/lease)**`
          : 'Active Paid Channel';
    lines.push(
      `| ${idx + 1} | \`${s.source}\` | ${formatMoney(s.spendUsd)} | ${s.signedLeasesInPeriod} | **${s.costPerSignedLeaseUsd !== null ? formatMoney(s.costPerSignedLeaseUsd) : 'N/A'}** | ${s.leadsCreatedCount} → ${s.touredCount} → ${s.signedLeasesInPeriod} | ${s.tourToLeaseConversionPercent.toFixed(1)}% | ${tag} |`,
    );
  });

  lines.push('');
  lines.push(
    '## 4. Closed-Loop Decision Audit (`FLOW-105` Integration with `decisions.csv`)',
  );
  lines.push('');
  lines.push(
    'Every historical decision in `data/ops/decisions.csv` is evaluated dynamically by `src/domain/learner.ts` using our conjugate Gamma-Poisson model (`alpha0 = ' +
      `${learner.priorAlpha0}, beta0 = $${learner.priorBeta0Usd}` +
      '`):',
  );
  lines.push('');

  const deadSpendDecisions = learner.evaluatedDecisions.filter(
    (d) => d.postSignedLeases === 0,
  );
  for (const ev of deadSpendDecisions) {
    lines.push(
      `- **\`decisions:${ev.decisionId}\` (\`${ev.decisionMonth}\`, \`${ev.propertyId}\`, \`${ev.source}\`, \`${ev.recommendation} ${ev.deltaUsd >= 0 ? `+$${ev.deltaUsd}` : `-$${Math.abs(ev.deltaUsd)}`}/mo\`, \`accepted = ${ev.accepted ? 'yes' : 'no'}\`):** ${ev.explanation}`,
    );
  }

  lines.push('');
  lines.push(
    `### Next Logged Budget Decisions (\`${store.policy.asOfDate.slice(0, 7)}\` — \`decisions.csv\` Schema)`,
  );
  lines.push('');
  lines.push('```csv');
  lines.push(formatDecisionsAsCsv(learner.proposedNextDecisions, true));
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(new URL(import.meta.url).pathname);

if (isMain) {
  const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
  const outPath = path.join(repoRoot, 'reports', 'dead-spend.md');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const md = generateDeadSpendMarkdown();
  fs.writeFileSync(outPath, md, 'utf-8');
  console.log(`Generated ${outPath} (${md.split('\n').length} lines)`);
}
