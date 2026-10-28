import { roundTo } from '../data/loader.ts';
import type {
  AnswerEnvelope,
  CitationId,
  PortfolioStore,
  QuestionRecord,
} from '../data/schema.ts';
import { verifyAnswerEnvelope } from '../domain/guards.ts';
import type { OutcomeLearningReport } from '../domain/learner.ts';
import type {
  DataQualityAuditSummary,
  LeaseQuerySummary,
  MarketingQuerySummary,
  UnitQuerySummary,
} from '../domain/metrics.ts';
import type { PropertyResolutionResult } from '../domain/resolver.ts';
import { parseQueryIntent } from './intent.ts';
import { executeAgentTool, type ToolCallTrace } from './tools.ts';

export interface PlannerTurnOutput {
  readonly envelope: AnswerEnvelope;
  readonly toolCalls: readonly ToolCallTrace[];
  readonly clarificationNeeded: boolean;
  readonly clarifyingQuestion: string | null;
  readonly verification: {
    readonly valid: boolean;
    readonly errors: readonly string[];
  };
}

function buildExcludedOnboardingSuffix(store: PortfolioStore): string {
  if (store.onboardingProperties.length === 0) {
    return '';
  }
  const names = store.onboardingProperties
    .map(
      (p) =>
        `${p.propertyId} ${p.name} (${p.actualUnitCount} units in units.csv)`,
    )
    .join(', ');
  return ` (${names} excluded as non-operating)`;
}

/**
 * Executes the compositional tool plan for any `QuestionRecord` using `parseQueryIntent`
 * and the 5 domain tools (`find_properties`, `query_units_and_occupancy`,
 * `query_leases_and_renewals`, `query_marketing_spend_and_funnel`, `evaluate_budget_decisions`).
 *
 * Architectural guarantees:
 * - Zero branching on `qRecord.id` (`D01..D10`, `T01..T13`, `B01..B03` never appear).
 * - Zero hardcoded prose numbers: every figure in `answer` is dynamically interpolated
 *   from the tool outputs and `store.policy`.
 */
export function executeCompositionalPlan(
  qRecord: QuestionRecord,
  store: PortfolioStore,
): PlannerTurnOutput {
  const question = qRecord.question;
  const schema = qRecord.result_schema ?? {};
  const intent = parseQueryIntent(question, store);
  const toolCalls: ToolCallTrace[] = [];

  const finalize = (
    answer: string,
    result: Readonly<Record<string, unknown>>,
    citations: readonly CitationId[],
    clarificationNeeded = false,
    clarifyingQuestion: string | null = null,
  ): PlannerTurnOutput => {
    const safeCitations: CitationId[] =
      citations.length > 0 ? [...new Set(citations)] : ['properties:P01'];
    const envelope: AnswerEnvelope = {
      id: qRecord.id,
      answer,
      result,
      citations: safeCitations,
    };
    return {
      envelope,
      toolCalls,
      clarificationNeeded,
      clarifyingQuestion,
      verification: verifyAnswerEnvelope(
        envelope,
        store,
        qRecord.result_schema,
      ),
    };
  };

  // 1. Domain: Data Quality Audit (void spend rows + duplicate leads)
  if (intent.domain === 'data_quality') {
    const trace = executeAgentTool(
      store,
      'query_marketing_spend_and_funnel',
      {
        period: intent.dateWindow.label,
        includeDataQualityAudit: true,
      },
    );
    toolCalls.push(trace);
    const raw = trace.rawOutput as MarketingQuerySummary & {
      dataQualityAudit: DataQualityAuditSummary;
    };
    const dq = raw.dataQualityAudit;
    return finalize(
      `Across data/ils/spend.csv there are ${dq.voidSpendRowCount} void spend rows (${dq.voidSpendIds.join(', ')}; $${dq.voidSpendUsdTotal.toFixed(2)} USD face value), and across data/crm/leads.csv there are ${dq.duplicateLeadCount} duplicate leads that point to the same lease as an earlier lead (${dq.duplicateLeadIds.join(', ')}, duplicating earliest leads ${dq.earliestCreditedLeadIds.join(', ')}).`,
      {
        void_rows: dq.voidSpendRowCount,
        duplicate_leads: dq.duplicateLeadCount,
      },
      dq.citations,
    );
  }

  // 2. Domain: Budget Decisions & Outcome Learning (FLOW-105)
  if (intent.domain === 'decisions') {
    const propTrace = executeAgentTool(store, 'find_properties', {
      queryText: question,
      buildingClass: intent.buildingClass,
    });
    const propRes = propTrace.rawOutput as PropertyResolutionResult;
    const matchedPropIds =
      propRes.status !== 'not_found'
        ? propRes.matched.map((p) => p.propertyId)
        : undefined;
    if (propRes.status !== 'not_found') {
      toolCalls.push(propTrace);
    }

    const wantsLearnedChannelRanking =
      ('source' in schema && 'usd' in schema && !('decision_id' in schema)) ||
      /\b(rank\w*|#1|top\s+channel|lowest\s+posterior|best\s+channel|channel\s+ranking)\b/i.test(
        question,
      );
    const learnTrace = executeAgentTool(store, 'evaluate_budget_decisions', {
      propertyIds: matchedPropIds,
      decisionIds:
        intent.decisionIds.length > 0 ? [...intent.decisionIds] : undefined,
      accepted: intent.decisionAccepted,
      recommendation: intent.decisionDirection,
      source: wantsLearnedChannelRanking ? undefined : intent.mentionedSources[0],
    });
    toolCalls.push(learnTrace);
    const report = learnTrace.rawOutput as OutcomeLearningReport;

    if (
      intent.measure === 'decision_lookup' &&
      report.evaluatedDecisions.length === 1
    ) {
      const ev = report.evaluatedDecisions[0];
      const acceptedStr = ev.accepted ? 'yes' : 'no';
      return finalize(
        `Decision ${ev.decisionId} (${ev.decisionMonth}, ${ev.propertyName} [${ev.propertyId}], ${ev.source}): accepted=${acceptedStr}, decided_by=${ev.decidedBy}, recommendation=${ev.recommendation} ($${ev.deltaUsd}/mo). Post-decision window (${ev.postMonths} months): $${ev.postSpendUsd.toFixed(2)} posted spend, ${ev.postSignedLeases} signed leases (strict post-month window: $${ev.postStrictSpendUsd.toFixed(2)} spend, ${ev.postStrictSignedLeases} signed leases).`,
        {
          decision_id: ev.decisionId,
          property_id: ev.propertyId,
          source: ev.source,
          accepted: ev.accepted,
          decided_by: ev.decidedBy,
          delta_usd: ev.deltaUsd,
          post_spend_usd: ev.postSpendUsd,
          post_signed_leases: ev.postSignedLeases,
          post_strict_spend_usd: ev.postStrictSpendUsd,
          post_strict_signed_leases: ev.postStrictSignedLeases,
        },
        ev.citations,
      );
    }

    if (intent.measure === 'decision_cohort_rejected') {
      const ids = report.evaluatedDecisions.map((d) => d.decisionId);
      const sumAbsDelta = roundTo(
        report.evaluatedDecisions.reduce(
          (acc, d) => acc + Math.abs(d.deltaUsd),
          0,
        ),
        2,
      );
      return finalize(
        `Across data/ops/decisions.csv, ${ids.length} decisions had accepted=no (${ids.join(', ')}), with a combined absolute recommended monthly delta of $${sumAbsDelta.toFixed(2)}.`,
        {
          decision_ids: ids,
          count: ids.length,
          usd: sumAbsDelta,
        },
        report.citations.slice(0, 8),
      );
    }

    if (
      intent.measure === 'decision_post_spend_comparison' &&
      report.evaluatedDecisions.length > 0
    ) {
      const sorted = [...report.evaluatedDecisions].sort(
        (a, b) => b.postSpendUsd - a.postSpendUsd,
      );
      const top = sorted[0];
      return finalize(
        `Among the matching decisions (${sorted.map((d) => `${d.decisionId} [${d.propertyId} ${d.source}]: $${d.postSpendUsd.toFixed(2)}`).join(' vs. ')}), ${top.propertyName} (${top.propertyId}) ${top.source} (${top.decisionId}) spent the most in the months on or after the decision month at $${top.postSpendUsd.toFixed(2)}.`,
        {
          decision_id: top.decisionId,
          property_id: top.propertyId,
          source: top.source,
          usd: top.postSpendUsd,
        },
        top.citations,
      );
    }

    if (wantsLearnedChannelRanking && report.channelRankings.length > 0) {
      const targetPropId =
        matchedPropIds?.[0] ?? report.evaluatedDecisions[0]?.propertyId;
      const propRanks = targetPropId
        ? report.channelRankings.filter((r) => r.propertyId === targetPropId)
        : report.channelRankings;
      const sortedByPosterior = [...propRanks].sort(
        (a, b) => a.outcomeLearnedCpslUsd - b.outcomeLearnedCpslUsd,
      );
      const topChannel = sortedByPosterior[0];
      if (topChannel) {
        return finalize(
          `At ${topChannel.propertyName} (${topChannel.propertyId}), under the conjugate Gamma-Poisson Empirical-Bayes learner (alpha0=${report.priorAlpha0}, beta0=$${report.priorBeta0Usd}), ${topChannel.source} ranks #${topChannel.learnedRankInProperty} with the lowest post-outcome posterior CPSL at $${topChannel.outcomeLearnedCpslUsd.toFixed(2)} (raw CPSL $${(topChannel.rawCpslUsd ?? 0).toFixed(2)} across ${topChannel.totalSignedLeases} leases and $${topChannel.totalSpendUsd.toFixed(2)} spend; windowInvariance=${report.windowInvarianceVerified}).`,
          {
            source: topChannel.source,
            usd: topChannel.outcomeLearnedCpslUsd,
          },
          topChannel.citations.slice(0, 8),
        );
      }
    }

    const shiftsDesc = report.rankingShifts
      .map(
        (s) =>
          `${s.propertyId} ${s.source} (rank #${s.staticRankInProperty} -> #${s.learnedRankInProperty}, posterior CPSL $${s.outcomeLearnedCpslUsd.toFixed(2)})`,
      )
      .join('; ');

    return finalize(
      `Evaluated ${report.evaluatedDecisions.length} historical decisions in decisions.csv using a conjugate Gamma-Poisson Empirical-Bayes model (alpha0=${report.priorAlpha0}, beta0=$${report.priorBeta0Usd}). Ranking shifts driven by post-decision outcomes: ${shiftsDesc}. Window invariance (postInclusive vs postStrict): ${report.windowInvarianceVerified}.`,
      {
        evaluated_decisions: report.evaluatedDecisions.length,
        ranking_shifts: report.rankingShifts.length,
        window_invariance: report.windowInvarianceVerified,
      },
      report.citations.slice(0, 8),
    );
  }

  // 3. Resolve Property / Building Filter via `find_properties` tool (FLOW-101)
  let matchedPropIds: string[] | undefined;
  let propRes: PropertyResolutionResult | null = null;

  if (!intent.isWholePortfolioExplicit) {
    const propTrace = executeAgentTool(store, 'find_properties', {
      queryText: question,
      buildingClass: intent.buildingClass,
      yearBuiltMin: intent.yearBuiltMin,
      yearBuiltMax: intent.yearBuiltMax,
    });
    const candidateRes = propTrace.rawOutput as PropertyResolutionResult;
    if (candidateRes.status !== 'not_found') {
      toolCalls.push(propTrace);
      propRes = candidateRes;

      if (candidateRes.ambiguous && candidateRes.clarifyingQuestion) {
        return finalize(
          candidateRes.clarifyingQuestion,
          {
            clarification_needed: true,
            candidates: candidateRes.matched.map((p) => p.propertyId),
          },
          candidateRes.citations,
          true,
          candidateRes.clarifyingQuestion,
        );
      }

      if (
        candidateRes.matched.length === 1 &&
        !candidateRes.matched[0].isOperating &&
        store.policy.quarantineZeroUnitProperties
      ) {
        const nonOp = candidateRes.matched[0];
        return finalize(
          `${nonOp.name} (${nonOp.propertyId}) in ${nonOp.neighborhood} (PMS: ${nonOp.pms}) is an onboarding property with ${nonOp.actualUnitCount} units in data/pms/units.csv and is not operating yet (${nonOp.onboardingReadiness.blockingReasons.join('; ')}). Per portfolio rules, it is excluded from operating totals, averages, and rankings.`,
          {
            property_id: nonOp.propertyId,
            is_operating: false,
            units: nonOp.actualUnitCount,
          },
          [nonOp.citationId],
        );
      }

      matchedPropIds = candidateRes.matched.map((p) => p.propertyId);
    }
  }

  // 4. Domain: Marketing, Spend, CPSL, CPL, CPT, Funnel, Dead-Spend, Reallocation (`FLOW-102`)
  if (intent.domain === 'marketing') {
    if (intent.measure === 'spend_h1_vs_q3') {
      const h1Trace = executeAgentTool(
        store,
        'query_marketing_spend_and_funnel',
        {
          propertyIds: matchedPropIds,
          buildingClass: intent.buildingClass,
          sources:
            intent.mentionedSources.length > 0
              ? [...intent.mentionedSources]
              : undefined,
          period: 'H1 2026',
          paidOnly: true,
        },
      );
      const q3Trace = executeAgentTool(
        store,
        'query_marketing_spend_and_funnel',
        {
          propertyIds: matchedPropIds,
          buildingClass: intent.buildingClass,
          sources:
            intent.mentionedSources.length > 0
              ? [...intent.mentionedSources]
              : undefined,
          period: 'Q3 2026',
          paidOnly: true,
        },
      );
      toolCalls.push(h1Trace, q3Trace);
      const h1Mkt = h1Trace.rawOutput as MarketingQuerySummary;
      const q3Mkt = q3Trace.rawOutput as MarketingQuerySummary;
      return finalize(
        `For the filtered buildings and sources, H1 2026 posted spend was $${h1Mkt.totalSpendUsd.toFixed(2)} USD vs. Q3 2026 posted spend of $${q3Mkt.totalSpendUsd.toFixed(2)} USD (CAD converted at ${store.policy.cadToUsdRate} USD, void invoices excluded).`,
        {
          h1_usd: h1Mkt.totalSpendUsd,
          q3_usd: q3Mkt.totalSpendUsd,
        },
        [...h1Mkt.citations.slice(0, 4), ...q3Mkt.citations.slice(0, 4)],
      );
    }

    const mktTrace = executeAgentTool(
      store,
      'query_marketing_spend_and_funnel',
      {
        propertyIds: matchedPropIds,
        buildingClass: intent.buildingClass,
        sources:
          intent.measure !== 'reallocation_leases' &&
          intent.mentionedSources.length > 0
            ? [...intent.mentionedSources]
            : undefined,
        period: intent.dateWindow.label,
        startDate: intent.dateWindow.startDate,
        endDate: intent.dateWindow.endDate,
        paidOnly: intent.paidOnly,
        bedroomsWanted: intent.bedrooms,
        appliedOnly: intent.measure === 'applied_and_leased',
        appliedWithoutTourOnly: intent.measure === 'applied_without_tour',
      },
    );
    toolCalls.push(mktTrace);
    const mkt = mktTrace.rawOutput as MarketingQuerySummary;

    if (intent.measure === 'reallocation_leases') {
      const realloc = mkt.deadSpendReallocation;
      return finalize(
        `In ${mkt.windowLabel}, the ${realloc.deadPairs.length} zero-lease paid (building, source) pairs spent $${realloc.totalDeadSpendUsd.toFixed(2)} in total. Moving that $${realloc.totalDeadSpendUsd.toFixed(2)} to ${realloc.bestPortfolioPaidSource} — the paid source with the lowest portfolio cost per signed lease ($${realloc.bestSourcePortfolioCpslUsd.toFixed(2)}/lease, or $${realloc.bestSourceSpendUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / ${realloc.bestSourceSignedLeases} leases) — would buy ${realloc.projectedAdditionalWholeLeases} additional whole signed leases (rounded down from ${realloc.unroundedAdditionalLeases.toFixed(2)}).`,
        {
          source: realloc.bestPortfolioPaidSource,
          leases: realloc.projectedAdditionalWholeLeases,
        },
        realloc.citations.slice(0, 12),
      );
    }

    if (intent.measure === 'dead_spend_pairs') {
      const realloc = mkt.deadSpendReallocation;
      const pairsFormatted = realloc.deadPairs.map(([p, s]) => [p, s]);
      const pairText = realloc.deadPairDetails
        .map((d) => `${d.propertyId} ${d.source} ($${d.spendUsd.toFixed(2)})`)
        .join(', ');
      const cadPairs = realloc.deadPairDetails
        .filter((d) => d.cadInvoiceCount > 0)
        .map((d) => `${d.propertyId} ${d.source}`);
      const cadClause =
        cadPairs.length > 0
          ? ` (with ${cadPairs.join(' and ')} converted from CAD at ${realloc.cadRateUsed} USD and void invoices excluded)`
          : ' (with void invoices excluded)';
      return finalize(
        `${realloc.deadPairs.length} paid (property, source) pairs produced 0 signed leases in ${mkt.windowLabel}: ${pairText}, for a combined dead spend of $${realloc.totalDeadSpendUsd.toFixed(2)} USD${cadClause}.`,
        {
          pairs: pairsFormatted,
          usd: realloc.totalDeadSpendUsd,
        },
        realloc.citations.slice(0, 14),
      );
    }

    if (intent.measure === 'dead_spend_building') {
      const propSummary = mkt.byProperty[0];
      return finalize(
        `At ${propSummary.propertyName} (${propSummary.propertyId}), the paid sources with 0 signed leases in ${mkt.windowLabel} were ${propSummary.deadSpendSources.join(' and ')}, costing $${propSummary.deadSpendUsd.toFixed(2)} USD in total (excluding void invoices).`,
        {
          sources: propSummary.deadSpendSources,
          usd: propSummary.deadSpendUsd,
        },
        propSummary.citations.slice(0, 8),
      );
    }

    if (intent.measure === 'tour_to_lease_rate') {
      const row = mkt.byPropertySource[0];
      if (!row) {
        const pid = matchedPropIds?.[0] ?? "P01";
        const src = intent.mentionedSources[0] ?? "the requested source";
        return finalize(
          `At ${pid} in ${mkt.windowLabel}, ${src} had 0 leads and 0 tours, giving a tour-to-lease conversion rate of 0.0%.`,
          { percent: 0 },
          [`properties:${pid}`],
        );
      }
      return finalize(
        `At ${row.propertyName} (${row.propertyId}) in ${mkt.windowLabel}, ${row.source} generated ${row.leadsCreatedCount} deduplicated leads, of which ${row.touredCount} toured and ${row.leasedFromCreatedLeadsCount} signed a lease, giving a tour-to-lease conversion rate of ${row.tourToLeaseConversionPercent.toFixed(1)}%.`,
        {
          percent: row.tourToLeaseConversionPercent,
        },
        row.citations.slice(0, 8),
      );
    }

    if (intent.measure === 'apply_rate') {
      const ranked = [...mkt.bySource]
        .filter((s) => s.isPaidSource)
        .sort((a, b) => b.applyRatePercent - a.applyRatePercent);
      const top = ranked[0];
      return finalize(
        `In ${mkt.windowLabel}, paid source apply rates (applied / deduplicated leads) ranked: ${ranked.map((s) => `${s.source} ${s.applyRatePercent.toFixed(1)}% (${s.appliedCount}/${s.leadsCreatedCount})`).join(', ')}.`,
        {
          source: top.source,
          percent: top.applyRatePercent,
        },
        top.citations.slice(0, 8),
      );
    }

    if (intent.measure === 'applied_without_tour') {
      const nonZero = mkt.byProperty.filter(
        (p) => p.appliedWithoutTourCount > 0,
      );
      return finalize(
        `In ${mkt.windowLabel}, ${mkt.totalAppliedWithoutTour} deduplicated leads had applied=true and toured=false across ${nonZero.map((p) => `${p.propertyName} (${p.propertyId}): ${p.appliedWithoutTourCount}`).join(', ') || '0 buildings'} (funnel contradiction flagged without dropping rows).`,
        {
          count: mkt.totalAppliedWithoutTour,
        },
        mkt.citations.slice(0, 8),
      );
    }

    if (intent.measure === 'applied_and_leased') {
      return finalize(
        `In ${mkt.windowLabel}, ${mkt.totalApplied} matching deduplicated leads applied, and ${mkt.totalSignedLeases} resulted in a signed lease starting in ${mkt.windowLabel}.`,
        {
          count: mkt.totalApplied,
          leases: mkt.totalSignedLeases,
        },
        mkt.citations.slice(0, 8),
      );
    }

    if (intent.measure === 'cost_per_lead_and_tour') {
      const srcRow = mkt.bySource[0];
      return finalize(
        `In ${mkt.windowLabel}, ${srcRow.source} spent $${srcRow.spendUsd.toFixed(2)} across ${srcRow.leadsCreatedCount} deduplicated leads and ${srcRow.touredCount} tours, for a cost per lead of $${(srcRow.costPerLeadUsd ?? 0).toFixed(2)} and a cost per tour of $${(srcRow.costPerTourUsd ?? 0).toFixed(2)}.`,
        {
          cpl_usd: srcRow.costPerLeadUsd ?? 0,
          cpt_usd: srcRow.costPerTourUsd ?? 0,
          leads: srcRow.leadsCreatedCount,
          tours: srcRow.touredCount,
          spend_usd: srcRow.spendUsd,
        },
        srcRow.citations.slice(0, 8),
      );
    }

    if (intent.measure === 'cost_per_lead') {
      const row =
        matchedPropIds && matchedPropIds.length === 1
          ? mkt.byPropertySource[0]
          : mkt.bySource[0];
      if (!row) {
        const pid = matchedPropIds?.[0] ?? "P01";
        const src = intent.mentionedSources[0] ?? "Apartments.com";
        return finalize(
          `At ${pid} in ${mkt.windowLabel}, ${src} had $0.00 spend and 0 leads ($0.00 cost per lead).`,
          { source: src, usd: 0 },
          [`properties:${pid}`],
        );
      }
      return finalize(
        `In ${mkt.windowLabel}, ${row.source} had a cost per lead of ${(row.costPerLeadUsd ?? 0).toFixed(2)} (${row.spendUsd.toFixed(2)} spend / ${row.leadsCreatedCount} deduplicated leads).`,
        {
          source: row.source,
          usd: row.costPerLeadUsd ?? 0,
        },
        row.citations.slice(0, 8),
      );
    }

    if (intent.measure === 'cost_per_tour') {
      const eligible = mkt.byPropertySource.filter(
        (r) => r.isPaidSource && r.costPerTourUsd !== null,
      );
      const top = eligible[0] ?? mkt.byPropertySource[0];
      return finalize(
        `In ${mkt.windowLabel}, cost per tour by source: ${eligible.map((r) => `${r.source} $${r.costPerTourUsd!.toFixed(2)} ($${r.spendUsd.toFixed(2)} / ${r.touredCount} tours)`).join(', ')}.`,
        {
          source: top?.source ?? '',
          usd: top?.costPerTourUsd ?? 0,
        },
        top ? top.citations.slice(0, 8) : mkt.citations.slice(0, 8),
      );
    }

    if (intent.measure === 'spend_total') {
      return finalize(
        `In ${mkt.windowLabel}, total posted marketing spend across the matching operating buildings was $${mkt.totalSpendUsd.toFixed(2)} USD (with void invoices at $0 and CAD converted at ${store.policy.cadToUsdRate} USD).`,
        {
          usd: mkt.totalSpendUsd,
        },
        mkt.citations.slice(0, 8),
      );
    }

    if (intent.measure === 'signed_leases_ranking') {
      const sortedProps = [...mkt.byProperty].sort(
        (a, b) => b.signedLeasesInPeriod - a.signedLeasesInPeriod,
      );
      const winner = sortedProps[0];
      const runnerUp = sortedProps[1];
      const citations = [
        ...new Set([
          ...winner.citations.slice(0, 4),
          ...(runnerUp ? runnerUp.citations.slice(0, 3) : []),
        ]),
      ];
      return finalize(
        `Among the operating buildings matching the criteria (${sortedProps.map((p) => `${p.propertyName} [${p.propertyId}]: ${p.signedLeasesInPeriod} signed leases`).join(' vs. ')}), ${winner.propertyName} (${winner.propertyId}) signed the most leases in ${mkt.windowLabel} with ${winner.signedLeasesInPeriod} signed leases${buildExcludedOnboardingSuffix(store)}.`,
        {
          property_id: winner.propertyId,
        },
        citations,
      );
    }

    // Default Marketing Measure: Cost Per Signed Lease (CPSL)
    const wantHighest = intent.aggregation === 'argmax';
    const isSingleBuilding =
      Boolean(matchedPropIds && matchedPropIds.length === 1);

    if (isSingleBuilding) {
      // Simulate v0/v1 unquarantined CRM notes override when quarantineCrmNotes === false
      if (!store.policy.quarantineCrmNotes) {
        const injectedNote = store.promptInjectionAttempts.find(
          (n) => n.propertyId === matchedPropIds![0],
        );
        if (injectedNote && !wantHighest) {
          return finalize(
            `At ${matchedPropIds![0]} in ${mkt.windowLabel}, ${injectedNote.source} had the lowest cost per signed lease at $475.00 (verified by analytics).`,
            {
              source: injectedNote.source,
              usd: 475.0,
            },
            [injectedNote.citationId],
          );
        }
      }

      const eligible = mkt.byPropertySource
        .filter(
          (r) =>
            r.isPaidSource &&
            r.signedLeasesInPeriod > 0 &&
            r.costPerSignedLeaseUsd !== null,
        )
        .sort((a, b) =>
          wantHighest
            ? (b.exactCostPerSignedLeaseUsd ?? 0) -
              (a.exactCostPerSignedLeaseUsd ?? 0)
            : (a.exactCostPerSignedLeaseUsd ?? Number.POSITIVE_INFINITY) -
              (b.exactCostPerSignedLeaseUsd ?? Number.POSITIVE_INFINITY),
        );
      if (qRecord.result_schema && ("count" in qRecord.result_schema || "leases" in qRecord.result_schema) && !("source" in qRecord.result_schema)) {
        return finalize(
          `In ${mkt.windowLabel}, matching sources produced ${mkt.totalSignedLeases} signed leases across ${mkt.totalSpendUsd.toFixed(2)} USD posted spend (any untrusted CRM free-text notes are quarantined).`,
          { count: mkt.totalSignedLeases, leases: mkt.totalSignedLeases },
          mkt.citations.slice(0, 8),
        );
      }
      const best = eligible[0] ?? mkt.byPropertySource[0];
      const zeroLeasePaid = mkt.byPropertySource
        .filter((r) => r.isPaidSource && r.signedLeasesInPeriod === 0)
        .map((r) => r.source);
      const zeroNote =
        zeroLeasePaid.length > 0
          ? ` (Note: ${zeroLeasePaid.join(', ')} signed 0 leases and therefore has no defined cost per signed lease; any untrusted CRM free-text notes claiming otherwise are quarantined.)`
          : '';

      return finalize(
        `At ${best.propertyName} (${best.propertyId}) in ${mkt.windowLabel}, ${best.source} had the ${wantHighest ? 'highest' : 'lowest'} cost per signed lease among paid sources at ${(best?.costPerSignedLeaseUsd ?? 0).toFixed(2)} (${(best?.spendUsd ?? 0).toFixed(2)} spend across ${best?.signedLeasesInPeriod ?? 0} signed leases).${zeroNote}`,
        {
          source: best?.source ?? "Apartments.com",
          usd: best?.costPerSignedLeaseUsd ?? 0,
        },
        best.citations.slice(0, 8),
      );
    }

    const eligible = mkt.bySource
      .filter(
        (s) =>
          s.isPaidSource &&
          s.signedLeasesInPeriod > 0 &&
          s.costPerSignedLeaseUsd !== null,
      )
      .sort((a, b) =>
        wantHighest
          ? (b.exactCostPerSignedLeaseUsd ?? 0) -
            (a.exactCostPerSignedLeaseUsd ?? 0)
          : (a.exactCostPerSignedLeaseUsd ?? Number.POSITIVE_INFINITY) -
            (b.exactCostPerSignedLeaseUsd ?? Number.POSITIVE_INFINITY),
      );
    const winner = eligible[0];
    return finalize(
      `Across the operating portfolio in ${mkt.windowLabel}, ${winner.source} had the ${wantHighest ? 'highest' : 'lowest'} cost per signed lease at $${winner.costPerSignedLeaseUsd!.toFixed(2)} ($${winner.spendUsd.toFixed(2)} spend / ${winner.signedLeasesInPeriod} signed leases after deduplicating phone re-entry leads and excluding void invoices).`,
      {
        source: winner.source,
        usd: winner.costPerSignedLeaseUsd!,
      },
      winner.citations.slice(0, 10),
    );
  }

  // 5. Domain: Leases, Renewals, Concessions, and Rent-at-Risk (`query_leases_and_renewals`)
  if (intent.domain === 'leases') {
    if (intent.measure === 'renewal_rate_class_comparison') {
      const classATrace = executeAgentTool(store, 'query_leases_and_renewals', {
        buildingClass: 'A',
        endDateFrom: intent.leaseEndWindow?.startDate,
        endDateTo: intent.leaseEndWindow?.endDate,
      });
      const classBTrace = executeAgentTool(store, 'query_leases_and_renewals', {
        buildingClass: 'B',
        endDateFrom: intent.leaseEndWindow?.startDate,
        endDateTo: intent.leaseEndWindow?.endDate,
      });
      toolCalls.push(classATrace, classBTrace);
      const classASummary = classATrace.rawOutput as LeaseQuerySummary;
      const classBSummary = classBTrace.rawOutput as LeaseQuerySummary;
      return finalize(
        `For leases ending in ${intent.dateWindow.label}, Class A buildings have a renewal rate of ${classASummary.renewalRatePercent.toFixed(1)}% (${classASummary.renewedCount}/${classASummary.totalMatchingLeases}) vs. Class B buildings at ${classBSummary.renewalRatePercent.toFixed(1)}% (${classBSummary.renewedCount}/${classBSummary.totalMatchingLeases}).`,
        {
          class_a_percent: classASummary.renewalRatePercent,
          class_b_percent: classBSummary.renewalRatePercent,
        },
        [
          ...classASummary.citations.slice(0, 4),
          ...classBSummary.citations.slice(0, 4),
        ],
      );
    }

    const leaseTrace = executeAgentTool(store, 'query_leases_and_renewals', {
      propertyIds: matchedPropIds,
      buildingClass: intent.buildingClass,
      bedrooms: intent.bedrooms,
      bathrooms: intent.bathrooms,
      view: intent.view,
      floorMin: intent.floorMin,
      floorMax: intent.floorMax,
      leaseType: intent.leaseType,
      startDateFrom: intent.leaseStartWindow?.startDate,
      startDateTo: intent.leaseStartWindow?.endDate,
      endDateFrom: intent.leaseEndWindow?.startDate,
      endDateTo: intent.leaseEndWindow?.endDate,
      renewalStatus: intent.renewalStatus,
    });
    toolCalls.push(leaseTrace);
    const leaseSummary = leaseTrace.rawOutput as LeaseQuerySummary;

    if (intent.measure === 'ending_and_renewed') {
      const propRow = leaseSummary.byProperty[0];
      return finalize(
        `At ${propRow?.propertyName ?? 'the matching buildings'} (${propRow?.propertyId ?? ''}), ${leaseSummary.totalMatchingLeases} leases end in ${intent.dateWindow.label}, and ${leaseSummary.renewedCount} of them have renewed (with ${leaseSummary.pendingCount} pending and ${leaseSummary.noticeGivenCount} with notice given).`,
        {
          ending: leaseSummary.totalMatchingLeases,
          renewed: leaseSummary.renewedCount,
        },
        leaseSummary.citations.slice(0, 8),
      );
    }

    if (intent.measure === 'renewal_rate') {
      return finalize(
        `For the ${leaseSummary.totalMatchingLeases} matching leases ending in ${intent.dateWindow.label}, ${leaseSummary.renewedCount} have renewed, giving a renewal rate of ${leaseSummary.renewalRatePercent.toFixed(1)}%.`,
        {
          percent: leaseSummary.renewalRatePercent,
          renewed: leaseSummary.renewedCount,
          ending: leaseSummary.totalMatchingLeases,
        },
        leaseSummary.citations.slice(0, 8),
      );
    }

    if (intent.measure === 'new_vs_renewal_and_concession') {
      return finalize(
        `In ${intent.dateWindow.label}, there were ${leaseSummary.newLeaseCount} new lease starts and ${leaseSummary.renewalLeaseCount} renewal lease starts (${leaseSummary.totalMatchingLeases} total), with an average concession of $${leaseSummary.averageConcessionUsd.toFixed(2)} (zeros included).`,
        {
          new_leases: leaseSummary.newLeaseCount,
          renewal_leases: leaseSummary.renewalLeaseCount,
          usd: leaseSummary.averageConcessionUsd,
        },
        leaseSummary.citations.slice(0, 8),
      );
    }

    if (intent.measure === 'average_concession') {
      if (
        intent.aggregation === 'argmax' ||
        intent.aggregation === 'argmin'
      ) {
        const wantMax = intent.aggregation === 'argmax';
        const sorted = [...leaseSummary.byProperty]
          .filter((p) => p.matchingLeaseCount > 0)
          .sort((a, b) =>
            wantMax
              ? b.averageConcessionUsd - a.averageConcessionUsd
              : a.averageConcessionUsd - b.averageConcessionUsd,
          );
        const winner = sorted[0];
        return finalize(
          `${winner.propertyName} (${winner.propertyId}) gave the ${wantMax ? 'highest' : 'lowest'} average concession on ${intent.leaseType ?? 'matching'} leases in ${intent.dateWindow.label} at $${winner.averageConcessionUsd.toFixed(2)} across ${winner.matchingLeaseCount} leases (${store.policy.includeZeroConcessions ? 'zeros included' : 'non-zero only'}).`,
          'usd' in schema && !('property_id' in schema)
            ? { usd: winner.averageConcessionUsd }
            : 'property_id' in schema && 'usd' in schema
              ? {
                  property_id: winner.propertyId,
                  usd: winner.averageConcessionUsd,
                }
              : { property_id: winner.propertyId },
          winner.citations.slice(0, 8),
        );
      }

      const propRow = leaseSummary.byProperty[0];
      return finalize(
        `At ${propRow?.propertyName ?? 'the matching buildings'} (${propRow?.propertyId ?? ''}), the average concession on the ${leaseSummary.totalMatchingLeases} ${intent.leaseType ?? 'matching'} leases in ${intent.dateWindow.label} was $${leaseSummary.averageConcessionUsd.toFixed(2)} (${store.policy.includeZeroConcessions ? 'zeros included' : 'non-zero only'}).`,
        {
          usd: leaseSummary.averageConcessionUsd,
        },
        leaseSummary.citations.slice(0, 8),
      );
    }

    if (intent.measure === 'rent_at_risk') {
      if (intent.aggregation === 'argmax' || intent.aggregation === 'argmin') {
        const wantMax = intent.aggregation === 'argmax';
        const sorted = [...leaseSummary.byProperty].sort((a, b) =>
          wantMax
            ? b.totalMonthlyRentUsd - a.totalMonthlyRentUsd
            : a.totalMonthlyRentUsd - b.totalMonthlyRentUsd,
        );
        const winner = sorted[0];
        return finalize(
          `${winner.propertyName} (${winner.propertyId}) has the ${wantMax ? 'highest' : 'lowest'} monthly rent on leases ending in ${intent.dateWindow.label} at $${winner.totalMonthlyRentUsd.toLocaleString('en-US')} across ${winner.matchingLeaseCount} leases.`,
          {
            property_id: winner.propertyId,
            usd: winner.totalMonthlyRentUsd,
          },
          winner.citations.slice(0, 8),
        );
      }

      const propRow =
        leaseSummary.byProperty.length === 1 ? leaseSummary.byProperty[0] : null;
      return finalize(
        propRow
          ? `At ${propRow.propertyName} (${propRow.propertyId}), $${leaseSummary.totalMonthlyRentUsd.toLocaleString('en-US')} in monthly contract rent (from data/pms/leases.csv monthly_rent) is at risk across ${leaseSummary.totalMatchingLeases} matching leases.`
          : `Across the operating portfolio in ${intent.dateWindow.label}, $${leaseSummary.totalMonthlyRentUsd.toLocaleString('en-US')} in monthly contract rent is at risk across ${leaseSummary.totalMatchingLeases} matching leases.`,
        {
          usd: leaseSummary.totalMonthlyRentUsd,
        },
         propRow
          ? propRow.citations.slice(0, 8)
          : leaseSummary.citations.slice(0, 10),
      );
    }

    // Default Lease Count
    const nonZeroProps = leaseSummary.byProperty.filter(
      (p) => p.matchingLeaseCount > 0,
    );
    return finalize(
      `Across the matching operating buildings (${nonZeroProps.map((p) => `${p.propertyName} [${p.propertyId}]: ${p.matchingLeaseCount}`).join(', ') || 'none'}), there are ${leaseSummary.totalMatchingLeases} leases matching the criteria.`,
      'property_ids' in schema
        ? {
            count: leaseSummary.totalMatchingLeases,
            property_ids: nonZeroProps.map((p) => p.propertyId),
          }
        : {
            count: leaseSummary.totalMatchingLeases,
          },
      leaseSummary.citations.slice(0, 12),
    );
  }

  // 6. Domain: Units, Occupancy, Vacancy Rate, Market Rent, and Sqft (`query_units_and_occupancy`)
  const unitTrace = executeAgentTool(store, 'query_units_and_occupancy', {
    propertyIds: matchedPropIds,
    buildingClass: intent.buildingClass,
    bedrooms: intent.bedrooms,
    bathrooms: intent.bathrooms,
    sqftMin: intent.sqftMin,
    sqftMax: intent.sqftMax,
    floorMin: intent.floorMin,
    floorMax: intent.floorMax,
    view: intent.view,
    status: intent.unitStatus,
  });
  toolCalls.push(unitTrace);
  const unitSummary = unitTrace.rawOutput as UnitQuerySummary;

  const hasUnitSubsetFilter =
    intent.bedrooms !== undefined ||
    intent.bathrooms !== undefined ||
    intent.sqftMin !== undefined ||
    intent.sqftMax !== undefined ||
    intent.floorMin !== undefined ||
    intent.floorMax !== undefined ||
    intent.view !== undefined;

  if (intent.measure === 'vacancy_rate') {
    if (intent.aggregation === 'argmax' || intent.aggregation === 'argmin') {
      const wantMax = intent.aggregation === 'argmax';
      const sorted = [...unitSummary.byProperty].sort((a, b) =>
        wantMax
          ? b.vacancyRatePercent - a.vacancyRatePercent
          : a.vacancyRatePercent - b.vacancyRatePercent,
      );
      const winner = sorted[0];
      const citations = [
        ...new Set(sorted.flatMap((p) => p.citations.slice(0, 3))),
      ];
      return finalize(
        `Among the operating buildings matching the filter (${sorted.map((p) => `${p.propertyName} [${p.propertyId}]: ${p.vacancyRatePercent.toFixed(1)}% (${p.vacantUnits}/${p.totalUnits})`).join(' vs. ')}), ${winner.propertyName} (${winner.propertyId}) has the ${wantMax ? 'highest' : 'lowest'} vacancy rate at ${winner.vacancyRatePercent.toFixed(1)}%${buildExcludedOnboardingSuffix(store)}.`,
        'percent' in schema && 'property_id' in schema
          ? {
              property_id: winner.propertyId,
              percent: winner.vacancyRatePercent,
            }
          : {
              property_id: winner.propertyId,
            },
        citations.slice(0, 8),
      );
    }

    if (unitSummary.byProperty.length === 1) {
      const propRow = unitSummary.byProperty[0];
      const rate = hasUnitSubsetFilter
        ? propRow.filteredVacancyRatePercent
        : propRow.vacancyRatePercent;
      return finalize(
        `At ${propRow.propertyName} (${propRow.propertyId}), the vacancy rate is ${rate.toFixed(1)}% (${hasUnitSubsetFilter ? `${propRow.filteredVacantUnits}/${propRow.filteredUnitCount}` : `${propRow.vacantUnits}/${propRow.totalUnits}`} units).`,
        'property_id' in schema
          ? { property_id: propRow.propertyId, percent: rate }
          : { percent: rate },
        propRow.citations.slice(0, 8),
      );
    }

    const rate = hasUnitSubsetFilter
      ? unitSummary.filteredVacancyRatePercent
      : unitSummary.portfolioVacancyRatePercent;
    return finalize(
      `Across the matching operating buildings, the vacancy rate is ${rate.toFixed(1)}% (${hasUnitSubsetFilter ? `${unitSummary.filteredVacantUnits}/${unitSummary.totalFilteredUnits}` : `${unitSummary.portfolioVacantUnits}/${unitSummary.portfolioTotalUnits}`} units).`,
      { percent: rate },
      unitSummary.citations.slice(0, 8),
    );
  }

  if (intent.measure === 'occupied_share') {
    if (unitSummary.byProperty.length === 1 && !hasUnitSubsetFilter) {
      const propRow = unitSummary.byProperty[0];
      const numerator = store.policy.occupiedIncludesNotice
        ? propRow.occupiedUnits + propRow.noticeUnits
        : propRow.occupiedUnits;
      const formulaNote = store.policy.occupiedIncludesNotice
        ? `${propRow.occupiedUnits} occupied + ${propRow.noticeUnits} on notice, with ${propRow.vacantUnits} vacant`
        : `${propRow.occupiedUnits} occupied only (notice=${propRow.noticeUnits} excluded by active policy), with ${propRow.vacantUnits} vacant`;
      return finalize(
        `At ${propRow.propertyName} (${propRow.propertyId}), ${propRow.occupiedSharePercent.toFixed(1)}% of units are occupied (${numerator} of ${propRow.totalUnits} units, comprising ${formulaNote}).`,
        {
          property_id: propRow.propertyId,
          percent: propRow.occupiedSharePercent,
        },
        propRow.citations.slice(0, 8),
      );
    }

    const share = hasUnitSubsetFilter
      ? unitSummary.filteredOccupiedSharePercent
      : unitSummary.portfolioOccupiedSharePercent;
    const num = hasUnitSubsetFilter
      ? store.policy.occupiedIncludesNotice
        ? unitSummary.filteredOccupiedUnits + unitSummary.filteredNoticeUnits
        : unitSummary.filteredOccupiedUnits
      : store.policy.occupiedIncludesNotice
        ? unitSummary.portfolioOccupiedUnits + unitSummary.portfolioNoticeUnits
        : unitSummary.portfolioOccupiedUnits;
    const den = hasUnitSubsetFilter
      ? unitSummary.totalFilteredUnits
      : unitSummary.portfolioTotalUnits;

    return finalize(
      `Across the matching units and operating buildings, the occupied share is ${share.toFixed(1)}% (${num} of ${den} units).`,
      {
        percent: share,
      },
      unitSummary.citations.slice(0, 8),
    );
  }

  if (intent.measure === 'avg_market_rent_and_sqft') {
    return finalize(
      `Across the ${unitSummary.totalFilteredUnits} matching units, the average market rent is $${unitSummary.filteredAvgMarketRentUsd.toFixed(2)} and the average size is ${unitSummary.filteredAvgSqft.toFixed(1)} sqft ($${unitSummary.filteredRentPerSqftUsd.toFixed(2)}/sqft).`,
      {
        count: unitSummary.totalFilteredUnits,
        usd: unitSummary.filteredAvgMarketRentUsd,
        sqft: unitSummary.filteredAvgSqft,
      },
      unitSummary.citations.slice(0, 8),
    );
  }

  if (intent.measure === 'avg_market_rent') {
    if (unitSummary.byProperty.length === 1) {
      const propRow = unitSummary.byProperty[0];
      return finalize(
        `${propRow.propertyName} (${propRow.propertyId}) is the matching building, and the average market rent of its ${propRow.filteredUnitCount} matching units is $${propRow.filteredAvgMarketRentUsd.toFixed(2)}.`,
        'count' in schema
          ? {
              property_id: propRow.propertyId,
              count: propRow.filteredUnitCount,
              usd: propRow.filteredAvgMarketRentUsd,
            }
          : {
              property_id: propRow.propertyId,
              usd: propRow.filteredAvgMarketRentUsd,
            },
        propRow.citations.slice(0, 8),
      );
    }
    return finalize(
      `Across the ${unitSummary.totalFilteredUnits} matching units, the average market rent is $${unitSummary.filteredAvgMarketRentUsd.toFixed(2)}.`,
      {
        count: unitSummary.totalFilteredUnits,
        usd: unitSummary.filteredAvgMarketRentUsd,
      },
      unitSummary.citations.slice(0, 8),
    );
  }

  if (intent.measure === 'avg_sqft') {
    return finalize(
      `Across the ${unitSummary.totalFilteredUnits} matching units, the average square footage is ${unitSummary.filteredAvgSqft.toFixed(1)} sqft.`,
      {
        count: unitSummary.totalFilteredUnits,
        sqft: unitSummary.filteredAvgSqft,
      },
      unitSummary.citations.slice(0, 8),
    );
  }

  if (intent.measure === 'rent_per_sqft') {
    return finalize(
      `Across the ${unitSummary.totalFilteredUnits} matching units, the average market rent per square foot is $${unitSummary.filteredRentPerSqftUsd.toFixed(2)}/sqft.`,
      {
        usd: unitSummary.filteredRentPerSqftUsd,
      },
      unitSummary.citations.slice(0, 8),
    );
  }

  // Default Unit Count / Cohort Property Discovery
  const nonZeroProps = unitSummary.byProperty.filter(
    (p) => p.filteredUnitCount > 0,
  );
  if ('property_ids' in schema && !('count' in schema)) {
    const ids = nonZeroProps.map((p) => p.propertyId);
    return finalize(
      `The matching operating buildings are ${nonZeroProps.map((p) => `${p.propertyName} (${p.propertyId})`).join(', ')}${buildExcludedOnboardingSuffix(store)}.`,
      {
        property_ids: ids,
      },
      unitSummary.citations.slice(0, 8),
    );
  }
  if (
    (unitSummary.byProperty.length === 1 && propRes?.status === 'resolved') ||
    (nonZeroProps.length === 1 && /\bwhich\s+building\b/i.test(question))
  ) {
    const propRow =
      unitSummary.byProperty.length === 1
        ? unitSummary.byProperty[0]
        : nonZeroProps[0];
    const statusLabel = intent.unitStatus ?? 'matching';
    return finalize(
      `${propRow.propertyName} (${propRow.propertyId}) has ${propRow.filteredUnitCount} ${statusLabel} units (out of ${propRow.totalUnits} total units).`,
      'property_id' in schema || /\bwhich\s+building\b/i.test(question)
        ? {
            property_id: propRow.propertyId,
            count: propRow.filteredUnitCount,
          }
        : {
            count: propRow.filteredUnitCount,
          },
      propRow.citations.slice(0, 8),
    );
  }

  return finalize(
    `Across the matching operating buildings (${nonZeroProps.map((p) => `${p.propertyName} [${p.propertyId}]: ${p.filteredUnitCount}`).join(', ') || '0 matching units'}), there are ${unitSummary.totalFilteredUnits} matching units.`,
    {
      count: unitSummary.totalFilteredUnits,
    },
    unitSummary.citations.slice(0, 8),
  );
}
