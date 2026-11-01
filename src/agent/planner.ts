import { sealProof } from './envelope.ts';
import type { ClarifyOption } from './clarify.ts';
import { fmtUsd, plural } from '../domain/format.ts';
import { roundTo } from '../data/loader.ts';
import type {
  AnswerEnvelope,
  CitationId,
  PortfolioStore,
  QuestionRecord,
} from '../data/schema.ts';
import { verifyAnswerEnvelope } from '../domain/guards.ts';
import { unknownWords } from '../domain/vocabulary.ts';
import type { OutcomeLearningReport } from '../domain/learner.ts';
import type {
  DataQualityAuditSummary,
  LeaseQuerySummary,
  MarketingQuerySummary,
  UnitQuerySummary,
} from '../domain/metrics.ts';
import type { PropertyResolutionResult } from '../domain/resolver.ts';
import { BUILDING_BREAKDOWN_MEASURES, droppedBreakdownOf, requestedBreakdowns, scalarLeftoverOf, parseQueryIntent, sourceModeOf, UNIT_STATUS_EXCLUSION_RE, type ParsedQueryIntent } from './intent.ts';
import {
  dataCoverage,
  describeCoverage,
  findUnresolvedPlace,
  findUntrackedChannel,
  hasUnitSignal,
  UNKNOWN_HINT,
  windowOverlaps,
} from './recognition.ts';
import { executeAgentTool, type ToolCallTrace } from './tools.ts';

/** How a leftover-word refusal starts, so the vocabulary check can still clarify a typo first. */
export const LEFTOVER_REASON_HEAD = 'FlowIQ would answer this with one overall figure';

export interface PlannerTurnOutput {
  readonly envelope: AnswerEnvelope;
  readonly toolCalls: readonly ToolCallTrace[];
  readonly clarificationNeeded: boolean;
  readonly clarifyingQuestion: string | null;
  /** 2-4 typed readings offered when the question has unbound words (S1R-L1-5). */
  readonly clarifyOptions?: readonly ClarifyOption[];
  /** What the typed query computed, in plain language (S1R-L1-6). */
  readonly restatement?: string;
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
        `${p.propertyId} ${p.name} (${plural(p.actualUnitCount, 'unit')} in units.csv)`,
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
/** Every row tied with the first (already sorted) row on `key`. */
function tiedAtTop<T>(sorted: readonly T[], key: (r: T) => number): T[] {
  if (sorted.length === 0) return [];
  const top = key(sorted[0]);
  return sorted.filter((r) => Math.abs(key(r) - top) < 1e-9);
}
function listNames(names: readonly string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function executeCompositionalPlan(
  qRecord: QuestionRecord,
  store: PortfolioStore,
  { verify = true, intent: given }: { readonly verify?: boolean; readonly intent?: ParsedQueryIntent } = {},
): PlannerTurnOutput {
  const question = qRecord.question;
  const schema = qRecord.result_schema ?? {};
  // S2-L1: a validated TypedQuery from the model path replaces the parse.
  const intent = given ?? parseQueryIntent(question, store);
  const toolCalls: ToolCallTrace[] = [];

  const finalize = (
    answer: string,
    result: Readonly<Record<string, unknown>>,
    citations: readonly CitationId[],
    clarificationNeeded = false,
    clarifyingQuestion: string | null = null,
  ): PlannerTurnOutput => {
    const query = { question, intent, ...(qRecord.result_schema ? { result_schema: qRecord.result_schema } : {}) };
    const rows = [...new Set(citations)];
    const envelope: AnswerEnvelope = {
      id: qRecord.id,
      answer,
      result,
      citations: rows,
      query,
      proof: sealProof(query, result, rows),
    };
    return {
      envelope,
      toolCalls,
      clarificationNeeded,
      clarifyingQuestion,
      verification: verify
        ? verifyAnswerEnvelope(envelope, store, qRecord.result_schema)
        : { valid: true, errors: [] },
    };
  };

  // Honest "I don't know" (FLOW-103): answer only what the exports can answer.
  const unknown = (
    reason: string,
    citations: readonly CitationId[] = [],
  ): PlannerTurnOutput =>
    finalize(
      `I don't know: ${reason} ${UNKNOWN_HINT}`,
      { unknown: true, reason },
      citations,
      false,
      UNKNOWN_HINT,
    );

  const buildingLabel = (ids: readonly string[] | undefined): string => {
    if (!ids || ids.length !== 1) return 'the matching buildings';
    const p = store.properties.find((x) => x.propertyId === ids[0]);
    return p ? `${p.name} (${p.propertyId})` : ids[0];
  };
  // A restatement before the figure carries no digits, so the figure stays
  // the first number in the answer.
  const buildingName = (ids: readonly string[] | undefined): string => {
    if (!ids || ids.length !== 1) return 'the matching buildings';
    return store.properties.find((x) => x.propertyId === ids[0])?.name ?? ids[0];
  };
  const isFreeSource = (src: string): boolean =>
    store.organicSources.includes(src) && !store.paidSources.includes(src);

  const unknownBuilding = findUnresolvedPlace(question, store);
  if (unknownBuilding) {
    return unknown(
      `no building called "${unknownBuilding}" is in data/pms/properties.csv (known buildings: ${store.properties.map((p) => `${p.propertyId} ${p.name}`).join(', ')}).`,
    );
  }

  if (intent.domain === 'marketing' || intent.domain === 'units') {
    const untracked = findUntrackedChannel(question, store);
    if (untracked) {
      return unknown(
        `"${untracked}" is not a tracked marketing source. Spend and leads only cover ${[...new Set([...store.paidSources, ...store.organicSources])].join(', ')}.`,
      );
    }
  }

  const coverage = dataCoverage(store);
  if (
    intent.domain === 'marketing' &&
    intent.dateExplicit &&
    !windowOverlaps(intent.dateWindow, coverage.marketing)
  ) {
    return unknown(
      `${intent.dateWindow.label} is outside the marketing data, which covers ${describeCoverage(coverage.marketing)}.`,
    );
  }
  if (intent.domain === 'leases' && intent.dateExplicit) {
    if (
      intent.leaseStartWindow &&
      !windowOverlaps(intent.leaseStartWindow, coverage.leaseStarts)
    ) {
      return unknown(
        `no lease starts fall in ${intent.leaseStartWindow.label}; lease start dates run ${describeCoverage(coverage.leaseStarts)}.`,
      );
    }
    if (
      intent.leaseEndWindow &&
      !windowOverlaps(intent.leaseEndWindow, coverage.leaseEnds)
    ) {
      return unknown(
        `no lease ends fall in ${intent.leaseEndWindow.label}; lease end dates run ${describeCoverage(coverage.leaseEnds)}.`,
      );
    }
  }

  if (intent.measure === 'unsupported') {
    const dropped = droppedBreakdownOf(intent);
    if (dropped) {
      // The measure may be computable; the breakdown is what is missing.
      const what = dropped.dim === 'time' ? 'a figure per period' : `a figure for each ${dropped.dim === 'other' ? 'group' : dropped.dim}`;
      // Keep the more specific unbound-word note too (TENACITY 2899192 F9).
      const unbound = unknownWords(question, store);
      return unknown(
        `the question asks for ${what} ("${dropped.words}"), and FlowIQ has no answer laid out that way for this measure, so it will not give one overall figure in its place.${unbound.length > 0 ? ` FlowIQ also has no meaning for ${unbound.map((w) => `"${w}"`).join(', ')} in this question.` : ''}`,
      );
    }
    const leftover = scalarLeftoverOf(intent);
    if (leftover) {
      return unknown(
        `${LEFTOVER_REASON_HEAD}, but the question also asks for ${leftover}, which one figure cannot carry, so it will not answer a different question in its place.`,
      );
    }
    return unknown(
      `the ${intent.domain} exports cannot compute the measure asked for in "${question.trim()}".`,
    );
  }

  // 1. Domain: Data Quality Audit (void spend rows + duplicate leads)
  if (intent.domain === 'data_quality') {
    const trace = executeAgentTool(
      store,
      'query_marketing_spend_and_funnel',
      {
        period: intent.dateWindow.label,
        // The window's own dates, so its label is never re-parsed into another window.
        startDate: intent.dateWindow.startDate,
        endDate: intent.dateWindow.endDate,
        includeDataQualityAudit: true,
      },
    );
    toolCalls.push(trace);
    const raw = trace.rawOutput as MarketingQuerySummary & {
      dataQualityAudit: DataQualityAuditSummary;
    };
    const dq = raw.dataQualityAudit;
    return finalize(
      `Across data/ils/spend.csv there are ${dq.voidSpendRowCount} void spend rows (${dq.voidSpendIds.join(', ')}; ${fmtUsd(dq.voidSpendRawTotal)} face value, ${fmtUsd(dq.voidSpendUsdTotal)} in USD after converting CAD rows), and across data/crm/leads.csv there are ${dq.duplicateLeadCount} duplicate leads that point to the same lease as an earlier lead (${dq.duplicateLeadIds.join(', ')}, duplicating earliest leads ${dq.earliestCreditedLeadIds.join(', ')}).`,
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
        `Decision ${ev.decisionId} (${ev.decisionMonth}, ${ev.propertyName} [${ev.propertyId}], ${ev.source}): accepted=${acceptedStr}, decided_by=${ev.decidedBy}, recommendation=${ev.recommendation} ($${ev.deltaUsd}/mo). Post-decision window (${ev.postMonths} months): ${fmtUsd(ev.postSpendUsd)} posted spend, ${plural(ev.postSignedLeases, 'signed lease')} (strict post-month window: ${fmtUsd(ev.postStrictSpendUsd)} spend, ${plural(ev.postStrictSignedLeases, 'signed lease')}).`,
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
        `Across data/ops/decisions.csv, ${plural(ids.length, 'decision')} had accepted=no (${ids.join(', ')}), with a combined absolute recommended monthly delta of ${fmtUsd(sumAbsDelta)}.`,
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
        `Among the matching decisions (${sorted.map((d) => `${d.decisionId} [${d.propertyId} ${d.source}]: ${fmtUsd(d.postSpendUsd)}`).join(' vs. ')}), ${top.propertyName} (${top.propertyId}) ${top.source} (${top.decisionId}) spent the most in the months on or after the decision month at ${fmtUsd(top.postSpendUsd)}.`,
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
          `At ${topChannel.propertyName} (${topChannel.propertyId}), under the conjugate Gamma-Poisson Empirical-Bayes learner (alpha0=${report.priorAlpha0}, beta0=$${report.priorBeta0Usd}), ${topChannel.source} ranks #${topChannel.learnedRankInProperty} with the lowest post-outcome posterior CPSL at ${fmtUsd(topChannel.outcomeLearnedCpslUsd)} (raw CPSL ${fmtUsd((topChannel.rawCpslUsd ?? 0))} across ${plural(topChannel.totalSignedLeases, 'lease')} and ${fmtUsd(topChannel.totalSpendUsd)} spend; windowInvariance=${report.windowInvarianceVerified}).`,
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
          `${s.propertyId} ${s.source} (rank #${s.staticRankInProperty} -> #${s.learnedRankInProperty}, posterior CPSL ${fmtUsd(s.outcomeLearnedCpslUsd)})`,
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
          `${nonOp.name} (${nonOp.propertyId}) in ${nonOp.neighborhood} (PMS: ${nonOp.pms}) is an onboarding property with ${plural(nonOp.actualUnitCount, 'unit')} in data/pms/units.csv and is not operating yet (${nonOp.onboardingReadiness.blockingReasons.join('; ')}). Per portfolio rules, it is excluded from operating totals, averages, and rankings.`,
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
        `For the filtered buildings and sources, H1 2026 posted spend was ${fmtUsd(h1Mkt.totalSpendUsd)} USD vs. Q3 2026 posted spend of ${fmtUsd(q3Mkt.totalSpendUsd)} USD (CAD converted at ${store.policy.cadToUsdRate} USD, void invoices excluded).`,
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
    // A per-source answer names one source. It answers only a question that
    // ranks, names a source, or asks for a source breakdown; any other reads
    // as the overall ratio for the matched scope.
    // One source resolver for every source measure (intent.sourceModeOf).
    const sourceMode = sourceModeOf(question, intent);
    const sourceShaped = sourceMode !== 'overall';
    const scope = !matchedPropIds || matchedPropIds.length === 0 ? 'Across the operating portfolio' : matchedPropIds.length === 1 ? `At ${buildingName(matchedPropIds)}` : `Across the ${matchedPropIds.length} matching buildings`;
    const noOverall = (what: string) =>
      unknown(`FlowIQ reports ${what} by listing source; it does not carry one overall ${what} for "${question.trim()}", so it will not answer a different question in its place.`);
    // Which sources the figure covers, said as the filter actually applied.
    const sourceSet = intent.mentionedSources.length > 0
      ? intent.mentionedSources.join(' and ')
      : intent.paidOnly ? 'paid sources' : 'all sources';
    const unrankedWhich = (what: string) =>
      unknown(`"${question.trim()}" asks which source but not by what ranking, so FlowIQ will not name one source's ${what} in its place. Ask for the lowest or highest ${what}, or for ${what} by source.`);
    // Per-source tour and lease counts over every matched building.
    const funnelBySource = () => {
      const m = new Map<string, { source: string; isPaid: boolean; toured: number; leased: number; citations: CitationId[] }>();
      for (const r of mkt.byPropertySource) {
        const g = m.get(r.source) ?? { source: r.source, isPaid: r.isPaidSource, toured: 0, leased: 0, citations: [] };
        g.toured += r.touredCount;
        g.leased += r.leasedFromCreatedLeadsCount;
        g.citations.push(...r.citations.slice(0, 2));
        m.set(r.source, g);
      }
      return [...m.values()];
    };

    if (intent.measure === 'reallocation_leases') {
      const realloc = mkt.deadSpendReallocation;
      if (!realloc.bestPortfolioPaidSource) {
        return finalize(
          `No paid source signed a lease in ${mkt.windowLabel}, so there is no cost per signed lease to reallocate the ${fmtUsd(realloc.totalDeadSpendUsd)} of dead spend against.`,
          { source: null, leases: null },
          realloc.citations.slice(0, 8),
        );
      }
      return finalize(
        `In ${mkt.windowLabel}, the ${realloc.deadPairs.length} zero-lease paid (building, source) pairs spent ${fmtUsd(realloc.totalDeadSpendUsd)} in total. Moving that ${fmtUsd(realloc.totalDeadSpendUsd)} to ${realloc.bestPortfolioPaidSource} — the paid source with the lowest portfolio cost per signed lease (${fmtUsd(realloc.bestSourcePortfolioCpslUsd)}/lease, or $${realloc.bestSourceSpendUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / ${plural(realloc.bestSourceSignedLeases, 'lease')}) — would buy ${realloc.projectedAdditionalWholeLeases} additional whole signed leases (rounded down from ${realloc.unroundedAdditionalLeases.toFixed(2)}).`,
        {
          source: realloc.bestPortfolioPaidSource,
          leases: realloc.projectedAdditionalWholeLeases,
        },
        realloc.citations.slice(0, 18),
      );
    }

    // "Which sources signed no leases" without a single named building is a
    // portfolio question; answering for the first building in the list
    // (P01) was a confident wrong answer.
    const deadSpendForOneBuilding =
      intent.measure === 'dead_spend_building' && matchedPropIds?.length === 1;
    if (
      intent.measure === 'dead_spend_pairs' ||
      (intent.measure === 'dead_spend_building' && !deadSpendForOneBuilding)
    ) {
      const realloc = mkt.deadSpendReallocation;
      const pairsFormatted = realloc.deadPairs.map(([p, s]) => [p, s]);
      const pairText = realloc.deadPairDetails
        .map((d) => `${d.propertyId} ${d.source} (${fmtUsd(d.spendUsd)})`)
        .join(', ');
      const cadPairs = realloc.deadPairDetails
        .filter((d) => d.cadInvoiceCount > 0)
        .map((d) => `${d.propertyId} ${d.source}`);
      const cadClause =
        cadPairs.length > 0
          ? ` (with ${cadPairs.join(' and ')} converted from CAD at ${realloc.cadRateUsed} USD and void invoices excluded)`
          : ' (with void invoices excluded)';
      return finalize(
        `${realloc.deadPairs.length} paid (property, source) pairs produced 0 signed leases in ${mkt.windowLabel}: ${pairText}, for a combined dead spend of ${fmtUsd(realloc.totalDeadSpendUsd)} USD${cadClause}.`,
        {
          pairs: pairsFormatted,
          usd: realloc.totalDeadSpendUsd,
        },
        realloc.citations.slice(0, 14),
      );
    }

    if (deadSpendForOneBuilding) {
      const propSummary = mkt.byProperty[0];
      return finalize(
        `At ${propSummary.propertyName} (${propSummary.propertyId}), the paid sources with 0 signed leases in ${mkt.windowLabel} were ${propSummary.deadSpendSources.join(' and ')}, costing ${fmtUsd(propSummary.deadSpendUsd)} USD in total (excluding void invoices).`,
        {
          sources: propSummary.deadSpendSources,
          usd: propSummary.deadSpendUsd,
        },
        propSummary.citations.slice(0, 8),
      );
    }

    if (intent.measure === 'tour_to_lease_rate') {
      const groups = funnelBySource();
      const rateOf = (toured: number, leased: number) => Math.round((leased / toured) * 1000) / 10;
      if (!sourceShaped || sourceMode === 'pooled') {
        const toured = groups.reduce((a, r) => a + r.toured, 0);
        const leased = groups.reduce((a, r) => a + r.leased, 0);
        if (toured === 0) return noOverall('tour-to-lease rate');
        const pct = rateOf(toured, leased);
        return finalize(
          `${scope} in ${mkt.windowLabel}, ${leased} of ${plural(toured, 'toured deduplicated lead')} from ${sourceSet} signed a lease, ${sourceSet === 'all sources' ? 'an overall' : 'a pooled'} tour-to-lease rate of ${pct.toFixed(1)}%.`,
          sourceMode === 'pooled' ? { sources: [...intent.mentionedSources], percent: pct } : { percent: pct },
          mkt.citations.slice(0, 12),
        );
      }
      if (sourceMode === 'which') return unrankedWhich('tour-to-lease rate');
      if (sourceMode === 'list' || sourceMode === 'ranked') {
        const rows = groups.filter((g) => g.toured > 0).map((g) => ({ ...g, pct: rateOf(g.toured, g.leased) }));
        if (rows.length === 0) return noOverall('tour-to-lease rate');
        if (sourceMode === 'list') {
          return finalize(
            `${scope} in ${mkt.windowLabel}, tour-to-lease rate by source: ${rows.map((r) => `${r.source} ${r.pct.toFixed(1)}% (${r.leased}/${r.toured})`).join(', ')}.`,
            { by_source: rows.map((r) => ({ source: r.source, percent: r.pct })) },
            rows.flatMap((r) => r.citations).slice(0, 12),
          );
        }
        const sortedT2l = [...rows].sort((x, y) => (intent.aggregation === 'argmin' ? x.pct - y.pct : y.pct - x.pct) || x.source.localeCompare(y.source));
        const best = sortedT2l[0];
        const tiedT2l = tiedAtTop(sortedT2l, (r) => r.pct);
        if (tiedT2l.length > 1) {
          return finalize(
            `${scope} in ${mkt.windowLabel}, ${listNames(tiedT2l.map((r) => r.source))} tied for the ${intent.aggregation === 'argmin' ? 'lowest' : 'highest'} tour-to-lease rate at ${best.pct.toFixed(1)}% (${tiedT2l.map((r) => `${r.source} ${r.leased} of ${r.toured}`).join(', ')} toured leads).`,
            { source: best.source, tied_sources: tiedT2l.map((r) => r.source), percent: best.pct },
            tiedT2l.flatMap((r) => r.citations).slice(0, 12),
          );
        }
        return finalize(
          `${scope} in ${mkt.windowLabel}, ${best.source} had the ${intent.aggregation === 'argmin' ? 'lowest' : 'highest'} tour-to-lease rate at ${best.pct.toFixed(1)}% (${best.leased} of ${best.toured} toured leads).`,
          { source: best.source, percent: best.pct },
          best.citations.slice(0, 12),
        );
      }
      const row = mkt.byPropertySource.length === 1 ? mkt.byPropertySource[0] : undefined;
      const g = groups.find((x) => x.source === intent.mentionedSources[0]);
      if (!g || g.toured === 0) {
        const src = intent.mentionedSources[0];
        return finalize(
          `At ${buildingLabel(matchedPropIds)} in ${mkt.windowLabel}, ${src} had no tours, so a tour-to-lease rate is not defined.`,
          { percent: null },
          propRes?.citations ?? [],
        );
      }
      if (row) {
        return finalize(
          `At ${row.propertyName} (${row.propertyId}) in ${mkt.windowLabel}, ${row.source} generated ${plural(row.leadsCreatedCount, 'deduplicated lead')}, of which ${row.touredCount} toured and ${row.leasedFromCreatedLeadsCount} signed a lease, giving a tour-to-lease conversion rate of ${row.tourToLeaseConversionPercent.toFixed(1)}%.`,
          { percent: row.tourToLeaseConversionPercent },
          row.citations.slice(0, 12),
        );
      }
      const pct = rateOf(g.toured, g.leased);
      return finalize(
        `${scope} in ${mkt.windowLabel}, ${g.leased} of ${plural(g.toured, 'toured deduplicated lead')} from ${g.source} signed a lease, a tour-to-lease rate of ${pct.toFixed(1)}%.`,
        { percent: pct },
        g.citations.slice(0, 12),
      );
    }

    if (intent.measure === 'apply_rate') {
      const ranked = [...mkt.bySource]
        .filter((s) => s.isPaidSource)
        .sort((a, b) => b.applyRatePercent - a.applyRatePercent);
      const top = ranked[0];
      return finalize(
        `${matchedPropIds && matchedPropIds.length === 1 ? `At ${buildingLabel(matchedPropIds)} in` : 'In'} ${mkt.windowLabel}, paid source apply rates (applied / deduplicated leads) ranked: ${ranked.map((s) => `${s.source} ${s.applyRatePercent.toFixed(1)}% (${s.appliedCount}/${s.leadsCreatedCount})`).join(', ')}.`,
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
        `In ${mkt.windowLabel}, ${plural(mkt.totalAppliedWithoutTour, 'deduplicated lead')} had applied=true and toured=false across ${nonZero.map((p) => `${p.propertyName} (${p.propertyId}): ${p.appliedWithoutTourCount}`).join(', ') || '0 buildings'} (funnel contradiction flagged without dropping rows).`,
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
      if (sourceMode !== 'one') return noOverall('cost per lead and per tour');
      const srcRow = mkt.bySource.find((r) => r.source === intent.mentionedSources[0]);
      if (!srcRow) {
        return finalize(
          `No matching source had spend or leads in ${mkt.windowLabel}, so cost per lead and per tour are not defined.`,
          { cpl_usd: null, cpt_usd: null, leads: 0, tours: 0, spend_usd: 0 },
          propRes?.citations ?? [],
        );
      }
      return finalize(
        `In ${mkt.windowLabel}, ${srcRow.source} spent ${fmtUsd(srcRow.spendUsd)} across ${plural(srcRow.leadsCreatedCount, 'deduplicated lead')} and ${plural(srcRow.touredCount, 'tour')}, for a cost per lead of ${srcRow.costPerLeadUsd === null ? 'n/a (no leads or free source)' : `${fmtUsd(srcRow.costPerLeadUsd)}`} and a cost per tour of ${srcRow.costPerTourUsd === null ? 'n/a (no tours or free source)' : `${fmtUsd(srcRow.costPerTourUsd)}`}.`,
        {
          cpl_usd: srcRow.costPerLeadUsd,
          cpt_usd: srcRow.costPerTourUsd,
          leads: srcRow.leadsCreatedCount,
          tours: srcRow.touredCount,
          spend_usd: srcRow.spendUsd,
        },
        srcRow.citations.slice(0, 8),
      );
    }

    if (intent.measure === 'cost_per_lead') {
      if (!sourceShaped || sourceMode === 'pooled') {
        if (mkt.totalLeadsCreated === 0) return noOverall('cost per lead');
        const usd = Math.round((mkt.totalSpendUsd / mkt.totalLeadsCreated) * 100) / 100;
        return finalize(
          `${scope} in ${mkt.windowLabel}, the ${sourceSet === 'all sources' ? 'overall' : 'pooled'} cost per lead was ${fmtUsd(usd)} (${fmtUsd(mkt.totalSpendUsd)} posted spend / ${plural(mkt.totalLeadsCreated, 'deduplicated lead')} from ${sourceSet}).`,
          sourceMode === 'pooled' ? { sources: [...intent.mentionedSources], usd } : { usd },
          mkt.citations.slice(0, 8),
        );
      }
      if (sourceMode === 'which') return unrankedWhich('cost per lead');
      if (sourceMode === 'list' || sourceMode === 'ranked') {
        const rows = mkt.bySource.filter((r) => r.costPerLeadUsd !== null);
        if (rows.length === 0) return noOverall('cost per lead');
        if (sourceMode === 'list') {
          return finalize(
            `${scope} in ${mkt.windowLabel}, cost per lead by paid source: ${rows.map((r) => `${r.source} ${fmtUsd(r.costPerLeadUsd!)} (${fmtUsd(r.spendUsd)} / ${plural(r.leadsCreatedCount, 'lead')})`).join(', ')}.`,
            { by_source: rows.map((r) => ({ source: r.source, usd: r.costPerLeadUsd })) },
            rows.flatMap((r) => r.citations.slice(0, 2)).slice(0, 12),
          );
        }
        const paid = rows.filter((r) => r.isPaidSource);
        const sortedCpl = [...paid].sort((x, y) => (intent.aggregation === 'argmin' ? x.costPerLeadUsd! - y.costPerLeadUsd! : y.costPerLeadUsd! - x.costPerLeadUsd!) || x.source.localeCompare(y.source));
        const best = sortedCpl[0];
        if (!best) return noOverall('cost per lead');
        const tiedCpl = tiedAtTop(sortedCpl, (r) => r.costPerLeadUsd!);
        if (tiedCpl.length > 1) {
          return finalize(
            `${scope} in ${mkt.windowLabel}, ${listNames(tiedCpl.map((r) => r.source))} tied for the ${intent.aggregation === 'argmin' ? 'lowest' : 'highest'} cost per lead among paid sources at ${fmtUsd(best.costPerLeadUsd!)} (${tiedCpl.map((r) => `${r.source} ${fmtUsd(r.spendUsd)} spend / ${plural(r.leadsCreatedCount, 'deduplicated lead')}`).join(', ')}).`,
            { source: best.source, tied_sources: tiedCpl.map((r) => r.source), usd: best.costPerLeadUsd },
            tiedCpl.flatMap((r) => r.citations.slice(0, 4)).slice(0, 12),
          );
        }
        return finalize(
          `${scope} in ${mkt.windowLabel}, ${best.source} had the ${intent.aggregation === 'argmin' ? 'lowest' : 'highest'} cost per lead among paid sources at ${fmtUsd(best.costPerLeadUsd!)} (${fmtUsd(best.spendUsd)} spend / ${plural(best.leadsCreatedCount, 'deduplicated lead')}).`,
          { source: best.source, usd: best.costPerLeadUsd },
          best.citations.slice(0, 8),
        );
      }
      const row = mkt.bySource.find((r) => r.source === intent.mentionedSources[0]);
      if (!row) {
        const src = intent.mentionedSources[0] ?? null;
        return finalize(
          `At ${buildingLabel(matchedPropIds)} in ${mkt.windowLabel}, ${src ?? 'no source'} had no spend or leads, so cost per lead is not defined.`,
          { source: src, usd: null },
          propRes?.citations ?? [],
        );
      }
      if (row.costPerLeadUsd === null) {
        return finalize(
          isFreeSource(row.source)
            ? `${row.source} is a free source with no spend, so cost per lead is not applicable (${plural(row.leadsCreatedCount, 'deduplicated lead')} in ${mkt.windowLabel}).`
            : `${row.source} had ${fmtUsd(row.spendUsd)} spend but no leads in ${mkt.windowLabel}, so cost per lead is not defined.`,
          { source: row.source, usd: null },
          row.citations.slice(0, 8),
        );
      }
      return finalize(
        `${scope} in ${mkt.windowLabel}, ${row.source} had a cost per lead of ${fmtUsd(row.costPerLeadUsd)} (${fmtUsd(row.spendUsd)} spend / ${plural(row.leadsCreatedCount, 'deduplicated lead')}).`,
        {
          source: row.source,
          usd: row.costPerLeadUsd,
        },
        row.citations.slice(0, 8),
      );
    }

    if (intent.measure === 'cost_per_tour') {
      if (!sourceShaped || sourceMode === 'pooled') return noOverall('cost per tour');
      if (sourceMode === 'which') return unrankedWhich('cost per tour');
      // Per source over every matched building; one building's rows are never shown unlabelled.
      const eligible = mkt.bySource.filter(
        (r) => r.isPaidSource && r.costPerTourUsd !== null,
      );
      const top = eligible[0];
      if (!top) {
        return finalize(
          `${scope}, no paid source had tours in ${mkt.windowLabel}, so cost per tour is not defined.`,
          { source: null, usd: null },
          propRes?.citations ?? [],
        );
      }
      if (sourceMode === 'ranked') {
        const sortedCpt = [...eligible].sort((x, y) => (intent.aggregation === 'argmin' ? x.costPerTourUsd! - y.costPerTourUsd! : y.costPerTourUsd! - x.costPerTourUsd!) || x.source.localeCompare(y.source));
        const best = sortedCpt[0];
        const tiedCpt = tiedAtTop(sortedCpt, (r) => r.costPerTourUsd!);
        if (tiedCpt.length > 1) {
          return finalize(
            `${scope} in ${mkt.windowLabel}, ${listNames(tiedCpt.map((r) => r.source))} tied for the ${intent.aggregation === 'argmin' ? 'lowest' : 'highest'} cost per tour among paid sources at ${fmtUsd(best.costPerTourUsd!)} (${tiedCpt.map((r) => `${r.source} ${fmtUsd(r.spendUsd)} spend / ${plural(r.touredCount, 'tour')}`).join(', ')}).`,
            { source: best.source, tied_sources: tiedCpt.map((r) => r.source), usd: best.costPerTourUsd },
            tiedCpt.flatMap((r) => r.citations.slice(0, 4)).slice(0, 12),
          );
        }
        return finalize(
          `${scope} in ${mkt.windowLabel}, ${best.source} had the ${intent.aggregation === 'argmin' ? 'lowest' : 'highest'} cost per tour among paid sources at ${fmtUsd(best.costPerTourUsd!)} (${fmtUsd(best.spendUsd)} spend / ${plural(best.touredCount, 'tour')}).`,
          { source: best.source, usd: best.costPerTourUsd },
          best.citations.slice(0, 8),
        );
      }
      return finalize(
        `${scope} in ${mkt.windowLabel}, cost per tour by paid source: ${eligible.map((r) => `${r.source} ${fmtUsd(r.costPerTourUsd!)} (${fmtUsd(r.spendUsd)} / ${plural(r.touredCount, 'tour')})`).join(', ')}.`,
        {
          source: top.source,
          usd: top.costPerTourUsd,
        },
        top.citations.slice(0, 8),
      );
    }

    if (intent.measure === 'lead_count') {
      return finalize(
        `${scope} in ${mkt.windowLabel}${intent.dateExplicit ? '' : ' (the full data window, since no period was named)'}, there were ${plural(mkt.totalLeadsCreated, 'lead')}${intent.bedrooms === undefined ? '' : intent.bedrooms === 0 ? ' that wanted a studio' : ` that wanted a ${intent.bedrooms}-bedroom unit`}${intent.mentionedSources.length > 0 ? ` from ${sourceSet}` : intent.paidOnly ? ' from paid sources' : ''} after merging phone re-entry duplicates.${new RegExp(UNIT_STATUS_EXCLUSION_RE.source, 'i').test(question) ? ' Unit status (such as down units) does not apply to leads, so no lead was set aside for it.' : ''}`,
        { count: mkt.totalLeadsCreated },
        mkt.citations.slice(0, 8),
      );
    }

    if (intent.measure === 'spend_total') {
      return finalize(
        `In ${mkt.windowLabel}, total posted marketing spend${intent.mentionedSources.length > 0 ? ` from ${sourceSet}` : intent.paidOnly ? ' from paid sources' : ''} ${matchedPropIds && matchedPropIds.length === 1 ? `at ${buildingName(matchedPropIds)}` : 'across the matching operating buildings'} was ${fmtUsd(mkt.totalSpendUsd)} USD (with void invoices at $0 and CAD converted at ${store.policy.cadToUsdRate} USD).`,
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
          ...(runnerUp ? runnerUp.citations.slice(0, 4) : []),
        ]),
      ];
      const allZero = sortedProps.every((p) => p.signedLeasesInPeriod === 0);
      const isTie = runnerUp && winner.signedLeasesInPeriod === runnerUp.signedLeasesInPeriod;
      const prose = allZero
        ? `Among the operating buildings matching the criteria (${sortedProps.map((p) => `${p.propertyName} [${p.propertyId}]: 0 signed leases`).join(' vs. ')}), 0 leases from leads were signed in ${mkt.windowLabel} (a 0-0 tie across the candidate buildings; note that the CRM/PMS lead-to-lease export covers through ${store.policy.asOfDate})${buildExcludedOnboardingSuffix(store)}.`
        : isTie
          ? `Among the operating buildings matching the criteria (${sortedProps.map((p) => `${p.propertyName} [${p.propertyId}]: ${plural(p.signedLeasesInPeriod, 'signed lease')}`).join(' vs. ')}), ${winner.propertyName} (${winner.propertyId}) and ${runnerUp.propertyName} (${runnerUp.propertyId}) tied with ${plural(winner.signedLeasesInPeriod, 'signed lease')} in ${mkt.windowLabel}${buildExcludedOnboardingSuffix(store)}.`
          : `Among the operating buildings matching the criteria (${sortedProps.map((p) => `${p.propertyName} [${p.propertyId}]: ${plural(p.signedLeasesInPeriod, 'signed lease')}`).join(' vs. ')}), ${winner.propertyName} (${winner.propertyId}) signed the most leases in ${mkt.windowLabel} with ${plural(winner.signedLeasesInPeriod, 'signed lease')}${buildExcludedOnboardingSuffix(store)}.`;
      return finalize(
        prose,
        {
          property_id: winner.propertyId,
        },
        citations,
      );
    }

    // Default Marketing Measure: Cost Per Signed Lease (CPSL), through the same source resolver.
    const wantHighest = intent.aggregation === 'argmax';
    const isSingleBuilding =
      Boolean(matchedPropIds && matchedPropIds.length === 1);
    const asksLeaseCount =
      /\bhow\s+many\s+(?:signed\s+)?leases\b/i.test(question) &&
      !/\bcost\b/i.test(question);
    if (isSingleBuilding && (asksLeaseCount || (qRecord.result_schema && ("count" in qRecord.result_schema || "leases" in qRecord.result_schema) && !("source" in qRecord.result_schema)))) {
      return finalize(
        `In ${mkt.windowLabel}, matching sources produced ${plural(mkt.totalSignedLeases, 'signed lease')} across ${mkt.totalSpendUsd.toFixed(2)} USD posted spend (any untrusted CRM free-text notes are quarantined).`,
        { count: mkt.totalSignedLeases, leases: mkt.totalSignedLeases },
        mkt.citations.slice(0, 8),
      );
    }
    if (!sourceShaped) return noOverall('cost per signed lease');
    if (sourceMode === 'which') return unrankedWhich('cost per signed lease');
    // Per source over every matched building (one building: that building's rows).
    const cpslRows = mkt.bySource;
    if (sourceMode === 'one') {
      // A question about one named source gets that source's figure, or
      // an honest "not defined"; it is never re-labelled the cheapest.
      const src = intent.mentionedSources[0];
      const row = cpslRows.find((r) => r.source === src);
      if (isFreeSource(src)) {
        return finalize(
          `${src} is a free source with no spend, so cost per signed lease is not applicable ${isSingleBuilding ? `at ${buildingLabel(matchedPropIds)}` : 'across the matching buildings'} (${plural(row?.signedLeasesInPeriod ?? 0, 'signed lease')} in ${mkt.windowLabel}).`,
          { source: src, usd: null, applicable: false },
          row ? row.citations.slice(0, 8) : propRes?.citations ?? [],
        );
      }
      if (!row || row.costPerSignedLeaseUsd === null) {
        return finalize(
          `${src} ${isSingleBuilding ? `at ${buildingLabel(matchedPropIds)}` : 'across the matching buildings'} had ${fmtUsd(row?.spendUsd ?? 0)} spend and no signed leases in ${mkt.windowLabel}, so its cost per signed lease is not defined (no signed leases). Any CRM note claiming a figure for it is quarantined.`,
          { source: src, usd: null, leases: 0 },
          row ? row.citations.slice(0, 8) : propRes?.citations ?? [],
        );
      }
      return finalize(
        `${scope} in ${mkt.windowLabel}, ${src} cost ${fmtUsd(row.costPerSignedLeaseUsd)} per signed lease (${fmtUsd(row.spendUsd)} spend across ${plural(row.signedLeasesInPeriod, 'signed lease')}).`,
        { source: src, usd: row.costPerSignedLeaseUsd },
        row.citations.slice(0, 8),
      );
    }
    if (sourceMode === 'pooled') {
      const rows = cpslRows.filter((r) => intent.mentionedSources.includes(r.source));
      const spend = rows.reduce((x, r) => x + r.spendUsd, 0);
      const leases = rows.reduce((x, r) => x + r.signedLeasesInPeriod, 0);
      if (leases === 0) {
        return finalize(
          `${scope} in ${mkt.windowLabel}, ${sourceSet} signed no leases (${fmtUsd(spend)} spend), so their pooled cost per signed lease is not defined.`,
          { sources: [...intent.mentionedSources], usd: null, leases: 0 },
          rows.flatMap((r) => r.citations.slice(0, 2)).slice(0, 8),
        );
      }
      const usd = Math.round((spend / leases) * 100) / 100;
      return finalize(
        `${scope} in ${mkt.windowLabel}, the pooled cost per signed lease was ${fmtUsd(usd)} (${fmtUsd(spend)} spend / ${plural(leases, 'signed lease')} from ${sourceSet}).`,
        { sources: [...intent.mentionedSources], usd },
        rows.flatMap((r) => r.citations.slice(0, 2)).slice(0, 8),
      );
    }
    const zeroLeasePaid = cpslRows.filter((r) => r.isPaidSource && r.spendUsd > 0 && r.signedLeasesInPeriod === 0).map((r) => r.source);
    if (sourceMode === 'list') {
      const rows = cpslRows.filter((r) => r.isPaidSource);
      if (rows.length === 0) return noOverall('cost per signed lease');
      return finalize(
        `${scope} in ${mkt.windowLabel}, cost per signed lease by paid source: ${rows.map((r) => r.costPerSignedLeaseUsd === null ? `${r.source} not defined (${fmtUsd(r.spendUsd)} spend, 0 signed leases)` : `${r.source} ${fmtUsd(r.costPerSignedLeaseUsd)} (${fmtUsd(r.spendUsd)} / ${plural(r.signedLeasesInPeriod, 'signed lease')})`).join(', ')}.`,
        { by_source: rows.map((r) => ({ source: r.source, usd: r.costPerSignedLeaseUsd })) },
        rows.flatMap((r) => r.citations.slice(0, 2)).slice(0, 12),
      );
    }
    // Ranked. One key for the sort and the tie test, so they cannot disagree.
    const cpslKey = (r: (typeof cpslRows)[number]): number =>
      r.exactCostPerSignedLeaseUsd ?? r.costPerSignedLeaseUsd ?? Number.NaN;
    const zeroNote =
      isSingleBuilding && zeroLeasePaid.length > 0
        ? ` (Note: ${zeroLeasePaid.join(', ')} signed 0 leases and therefore has no defined cost per signed lease; any untrusted CRM free-text notes claiming otherwise are quarantined.)`
        : '';
    const eligible = cpslRows
      .filter((r) => r.isPaidSource && r.signedLeasesInPeriod > 0 && r.costPerSignedLeaseUsd !== null)
      .sort((a, b) =>
        (wantHighest ? cpslKey(b) - cpslKey(a) : cpslKey(a) - cpslKey(b)) || a.source.localeCompare(b.source),
      );
    const best = eligible[0];
    if (!best) {
      return finalize(
        isSingleBuilding
          ? `No paid source signed a lease at ${buildingLabel(matchedPropIds)} in ${mkt.windowLabel}, so no source has a defined cost per signed lease${zeroLeasePaid.length > 0 ? ` (${zeroLeasePaid.join(', ')} spent without a signed lease)` : ''}.`
          : `No paid source signed a lease across the matching buildings in ${mkt.windowLabel}, so no source has a defined cost per signed lease.`,
        { source: null, usd: null },
        isSingleBuilding ? propRes?.citations ?? [] : mkt.citations.slice(0, 8),
      );
    }
    const tiedCpsl = tiedAtTop(eligible, cpslKey);
    if (tiedCpsl.length > 1) {
      return finalize(
        `${isSingleBuilding ? `At ${buildingLabel(matchedPropIds)}` : scope} in ${mkt.windowLabel}, ${listNames(tiedCpsl.map((r) => r.source))} tied for the ${wantHighest ? 'highest' : 'lowest'} cost per signed lease among paid sources at ${fmtUsd(best.costPerSignedLeaseUsd!)} (${tiedCpsl.map((r) => `${r.source} ${fmtUsd(r.spendUsd)} spend / ${plural(r.signedLeasesInPeriod, 'signed lease')}`).join(', ')}).${zeroNote}`,
        { source: best.source, tied_sources: tiedCpsl.map((r) => r.source), usd: best.costPerSignedLeaseUsd! },
        tiedCpsl.flatMap((r) => r.citations.slice(0, 4)).slice(0, 12),
      );
    }
    if (isSingleBuilding) {
      return finalize(
        `At ${buildingLabel(matchedPropIds)} in ${mkt.windowLabel}, ${best.source} had the ${wantHighest ? 'highest' : 'lowest'} cost per signed lease among paid sources at ${fmtUsd(best.costPerSignedLeaseUsd!)} (${fmtUsd(best.spendUsd)} spend across ${plural(best.signedLeasesInPeriod, 'signed lease')}).${zeroNote}`,
        { source: best.source, usd: best.costPerSignedLeaseUsd! },
        best.citations.slice(0, 8),
      );
    }
    return finalize(
      `${scope} in ${mkt.windowLabel}, ${best.source} had the ${wantHighest ? 'highest' : 'lowest'} cost per signed lease at ${fmtUsd(best.costPerSignedLeaseUsd!)} (${fmtUsd(best.spendUsd)} spend / ${plural(best.signedLeasesInPeriod, 'signed lease')} after deduplicating phone re-entry leads and excluding void invoices).`,
      { source: best.source, usd: best.costPerSignedLeaseUsd! },
      best.citations.slice(0, 10),
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
      bedroomsMin: intent.bedroomsMin,
      bedroomsMax: intent.bedroomsMax,
      bathroomsMin: intent.bathroomsMin,
      bathroomsMax: intent.bathroomsMax,
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
        `At ${propRow?.propertyName ?? 'the matching buildings'} (${propRow?.propertyId ?? ''}), ${plural(leaseSummary.totalMatchingLeases, 'lease')} end in ${intent.dateWindow.label}, and ${leaseSummary.renewedCount} of them have renewed (with ${leaseSummary.pendingCount} pending and ${leaseSummary.noticeGivenCount} with notice given).`,
        {
          ending: leaseSummary.totalMatchingLeases,
          renewed: leaseSummary.renewedCount,
        },
        leaseSummary.citations.slice(0, 8),
      );
    }

    if (intent.measure === 'renewal_rate') {
      // The rate is renewed / (renewed + pending + notice given); leases not
      // yet due are outside it. Say that denominator, and the window applied.
      const decided = leaseSummary.renewedCount + leaseSummary.pendingCount + leaseSummary.noticeGivenCount;
      const scopeLabel = intent.leaseEndWindow
        ? `ending in ${intent.leaseEndWindow.label}`
        : 'on file (all end dates)';
      const where = matchedPropIds && matchedPropIds.length === 1 ? `At ${buildingLabel(matchedPropIds)}, f` : 'F';
      if (decided === 0) {
        return unknown(`no lease ${scopeLabel}${matchedPropIds && matchedPropIds.length === 1 ? ` at ${buildingLabel(matchedPropIds)}` : ''} has a renewal outcome (renewed, pending or notice given) in data/pms/leases.csv, so there is no renewal rate for it.`, leaseSummary.citations.slice(0, 4));
      }
      return finalize(
        `${where}or the ${plural(leaseSummary.totalMatchingLeases, 'matching lease')} ${scopeLabel}, ${leaseSummary.renewedCount} of the ${decided} with a renewal outcome have renewed (${leaseSummary.pendingCount} pending, ${leaseSummary.noticeGivenCount} notice given; ${leaseSummary.notDueCount} not yet due are excluded), giving a renewal rate of ${leaseSummary.renewalRatePercent.toFixed(1)}%.`,
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
        `In ${intent.dateWindow.label}, there were ${leaseSummary.newLeaseCount} new lease starts and ${leaseSummary.renewalLeaseCount} renewal lease starts (${leaseSummary.totalMatchingLeases} total), with an average concession of ${fmtUsd(leaseSummary.averageConcessionUsd)} (zeros included).`,
        {
          new_leases: leaseSummary.newLeaseCount,
          renewal_leases: leaseSummary.renewalLeaseCount,
          usd: leaseSummary.averageConcessionUsd,
        },
        leaseSummary.citations.slice(0, 8),
      );
    }

    if (intent.measure === 'total_concession') {
      // One building is named only when the question resolved to exactly one.
      const one = propRes?.matched.length === 1 ? propRes.matched[0] : undefined;
      const where = one ? `At ${one.name} (${one.propertyId})` : 'Across the operating portfolio';
      const leases = `${plural(leaseSummary.totalMatchingLeases, `${intent.leaseType ?? 'matching'} lease`)}${intent.leaseStartWindow ? ` starting in ${intent.dateWindow.label}` : ` in ${intent.dateWindow.label}`}`;
      return finalize(
        `${where}, concessions totalled ${fmtUsd(leaseSummary.totalConcessionUsd)} on the ${leases}.`,
        { usd: leaseSummary.totalConcessionUsd, leases: leaseSummary.totalMatchingLeases },
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
        if (!winner) {
          return finalize(
            `No ${intent.leaseType ?? 'matching'} leases started in ${intent.dateWindow.label}, so no building has an average concession to rank.`,
            { property_id: null, leases: 0 },
            leaseSummary.citations.slice(0, 8),
          );
        }
        return finalize(
          `${winner.propertyName} (${winner.propertyId}) gave the ${wantMax ? 'highest' : 'lowest'} average concession on ${intent.leaseType ?? 'matching'} leases in ${intent.dateWindow.label} at ${fmtUsd(winner.averageConcessionUsd)} across ${plural(winner.matchingLeaseCount, 'lease')} (${store.policy.includeZeroConcessions ? 'zeros included' : 'non-zero only'}).`,
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
      if (leaseSummary.totalMatchingLeases === 0) {
        return finalize(
          `No ${intent.leaseType ?? 'matching'} leases ${intent.leaseStartWindow ? `started in ${intent.dateWindow.label}` : 'matched'}${propRes?.matched.length === 1 ? ` at ${propRes.matched[0].name} (${propRes.matched[0].propertyId})` : ''}, so there is no average concession to report.`,
          { usd: null, leases: 0 },
          propRes?.citations ?? [],
        );
      }
      return finalize(
        `${propRes?.matched.length === 1 ? `At ${propRow?.propertyName} (${propRow?.propertyId})` : 'Across the operating portfolio'}, the average concession on the ${leaseSummary.totalMatchingLeases} ${intent.leaseType ?? 'matching'} leases in ${intent.dateWindow.label} was ${fmtUsd(leaseSummary.averageConcessionUsd)} (${store.policy.includeZeroConcessions ? 'zeros included' : 'non-zero only'}).`,
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
        if (intent.topK && intent.topK > 1 && !('property_id' in schema)) {
          const topList = sorted.slice(0, intent.topK);
          const combinedUsd = topList.reduce((acc, p) => acc + p.totalMonthlyRentUsd, 0);
          const topCites = [...new Set(topList.flatMap((p) => p.citations.slice(0, 3)))];
          return finalize(
            `The top ${topList.length} operating buildings by ${intent.leaseEndWindow ? `monthly rent on leases ending in ${intent.dateWindow.label}` : 'active monthly contract lease rent roll (from data/pms/leases.csv)'} are: ${topList.map((p, idx) => `#${idx + 1} ${p.propertyName} (${p.propertyId}) at ${fmtUsd(p.totalMonthlyRentUsd, { trimCents: true })}/mo across ${plural(p.matchingLeaseCount, 'lease')}`).join('; ')}.`,
            {
              property_ids: topList.map((p) => p.propertyId),
              ranking: topList.map((p) => ({
                property_id: p.propertyId,
                name: p.propertyName,
                monthly_rent_usd: p.totalMonthlyRentUsd,
                leases: p.matchingLeaseCount,
              })),
              usd: combinedUsd,
            },
            topCites,
          );
        }
        const winner = sorted[0];
        return finalize(
          `${winner.propertyName} (${winner.propertyId}) has the ${wantMax ? 'highest' : 'lowest'} monthly rent on ${intent.leaseEndWindow ? `leases ending in ${intent.dateWindow.label}` : 'active leases'} at ${fmtUsd(winner.totalMonthlyRentUsd, { trimCents: true })} across ${plural(winner.matchingLeaseCount, 'lease')}.`,
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
          ? `At ${propRow.propertyName} (${propRow.propertyId}), ${fmtUsd(leaseSummary.totalMonthlyRentUsd, { trimCents: true })} in monthly contract rent (from data/pms/leases.csv monthly_rent) is at risk across ${plural(leaseSummary.totalMatchingLeases, 'matching lease')}.`
          : `Across the operating portfolio in ${intent.dateWindow.label}, ${fmtUsd(leaseSummary.totalMonthlyRentUsd, { trimCents: true })} in monthly contract rent is at risk across ${plural(leaseSummary.totalMatchingLeases, 'matching lease')}.`,
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
      `Across the matching operating buildings (${nonZeroProps.map((p) => `${p.propertyName} [${p.propertyId}]: ${p.matchingLeaseCount}`).join(', ') || 'none'}), there are ${plural(leaseSummary.totalMatchingLeases, 'lease')} matching the criteria.`,
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
    bedroomsMin: intent.bedroomsMin,
    bedroomsMax: intent.bedroomsMax,
    bathroomsMin: intent.bathroomsMin,
    bathroomsMax: intent.bathroomsMax,
    rentMin: intent.rentMin,
    rentMax: intent.rentMax,
    sqftMin: intent.sqftMin,
    sqftMax: intent.sqftMax,
    floorMin: intent.floorMin,
    floorMax: intent.floorMax,
    view: intent.view,
    status: intent.unitStatus,
    ...(intent.unitStatusIn ? { statusIn: intent.unitStatusIn } : {}),
  });
  toolCalls.push(unitTrace);
  const unitSummary = unitTrace.rawOutput as UnitQuerySummary;

  const hasUnitSubsetFilter =
    intent.bedrooms !== undefined ||
    intent.bathrooms !== undefined ||
    intent.bedroomsMin !== undefined ||
    intent.bedroomsMax !== undefined ||
    intent.bathroomsMin !== undefined ||
    intent.bathroomsMax !== undefined ||
    intent.rentMin !== undefined ||
    intent.rentMax !== undefined ||
    intent.sqftMin !== undefined ||
    intent.sqftMax !== undefined ||
    intent.floorMin !== undefined ||
    intent.floorMax !== undefined ||
    intent.view !== undefined ||
    intent.unitStatusIn !== undefined;

  // A unit filter no unit in scope meets (4-bedroom where none exist) has no
  // rate and no ranking: 0 of 0 is not 0.0%, and a tie at 0 is not a winner.
  // A count of zero is a true count and stays.
  if (hasUnitSubsetFilter && (!/count/.test(intent.measure) || intent.aggregation === 'argmax' || intent.aggregation === 'argmin') && (intent.unitStatus !== undefined || intent.unitStatusIn !== undefined || unitSummary.totalFilteredUnits === 0)) {
    const subset = (executeAgentTool(store, 'query_units_and_occupancy', {
      propertyIds: matchedPropIds, buildingClass: intent.buildingClass, bedrooms: intent.bedrooms, bathrooms: intent.bathrooms,
      bedroomsMin: intent.bedroomsMin, bedroomsMax: intent.bedroomsMax, bathroomsMin: intent.bathroomsMin, bathroomsMax: intent.bathroomsMax,
      rentMin: intent.rentMin, rentMax: intent.rentMax, sqftMin: intent.sqftMin, sqftMax: intent.sqftMax, floorMin: intent.floorMin, floorMax: intent.floorMax, view: intent.view,
    }).rawOutput as UnitQuerySummary);
    if (subset.totalFilteredUnits === 0) {
      return unknown(`no unit at ${matchedPropIds && matchedPropIds.length > 0 ? buildingName(matchedPropIds) : 'any operating building'} matches the unit filter in "${question.trim()}" (data/pms/units.csv), so there is no figure to give for it.`, propRes?.citations ?? []);
    }
  }

  // FLOWIQ-SITE-004: "occupancy at each building", "vacancies by property",
  // "units in each building" list one row per building, total last.
  // Occupancy follows the active policy; on-notice units are shown as their
  // own figure on every row. Counting notice as occupied is the CURRENT
  // DEFAULT (Tau's default, not yet confirmed by Manu).
  if (
    BUILDING_BREAKDOWN_MEASURES.has(intent.measure) &&
    intent.aggregation !== 'argmax' && intent.aggregation !== 'argmin' &&
    requestedBreakdowns(question).some((b) => b.dim === 'building' && !b.ranked) &&
    unitSummary.byProperty.length > 1
  ) {
    const filtered = hasUnitSubsetFilter || intent.unitStatus !== undefined;
    const notice = store.policy.occupiedIncludesNotice;
    const pick = (p: {
      totalUnits: number; occupiedUnits: number; noticeUnits: number; vacantUnits: number;
      filteredUnitCount: number; filteredOccupiedUnits: number; filteredNoticeUnits: number; filteredVacantUnits: number;
    }) => {
      const units = filtered ? p.filteredUnitCount : p.totalUnits;
      const occ = filtered ? p.filteredOccupiedUnits : p.occupiedUnits;
      const ntc = filtered ? p.filteredNoticeUnits : p.noticeUnits;
      const vac = filtered ? p.filteredVacantUnits : p.vacantUnits;
      return { units, occ, ntc, vac, occupiedCount: notice ? occ + ntc : occ };
    };
    const pct = (n: number, d: number) => (d === 0 ? 0 : Number(((n / d) * 100).toFixed(1)));
    const rows = unitSummary.byProperty.map((p) => ({ id: p.propertyId, name: p.propertyName, ...pick(p) }));
    const total = pick({
      totalUnits: unitSummary.portfolioTotalUnits, occupiedUnits: unitSummary.portfolioOccupiedUnits,
      noticeUnits: unitSummary.portfolioNoticeUnits, vacantUnits: unitSummary.portfolioVacantUnits,
      filteredUnitCount: unitSummary.totalFilteredUnits, filteredOccupiedUnits: unitSummary.filteredOccupiedUnits,
      filteredNoticeUnits: unitSummary.filteredNoticeUnits, filteredVacantUnits: unitSummary.filteredVacantUnits,
    });
    const noticeNote = notice
      ? 'current default: occupied includes units on notice, shown separately'
      : 'units on notice are not counted as occupied under the active policy';
    let lines: string[];
    let header: string;
    let result: Record<string, unknown>;
    if (intent.measure === 'occupied_share') {
      header = `Occupancy by building (${noticeNote}):`;
      const line = (label: string, r: typeof total) =>
        `${label}: ${pct(r.occupiedCount, r.units).toFixed(1)}% (${r.occupiedCount}/${r.units} units; ${r.ntc} on notice)`;
      lines = [...rows.map((r) => line(`${r.name} [${r.id}]`, r)), line('Portfolio total', total)];
      result = {
        by_property: rows.map((r) => ({ property_id: r.id, percent: pct(r.occupiedCount, r.units), occupied: r.occupiedCount, notice: r.ntc, units: r.units })),
        total: { percent: pct(total.occupiedCount, total.units), occupied: total.occupiedCount, notice: total.ntc, units: total.units },
      };
    } else if (intent.measure === 'vacancy_rate') {
      header = 'Vacancy rate by building:';
      const line = (label: string, r: typeof total) => `${label}: ${pct(r.vac, r.units).toFixed(1)}% (${r.vac}/${r.units} units vacant)`;
      lines = [...rows.map((r) => line(`${r.name} [${r.id}]`, r)), line('Portfolio total', total)];
      result = {
        by_property: rows.map((r) => ({ property_id: r.id, percent: pct(r.vac, r.units), vacant: r.vac, units: r.units })),
        total: { percent: pct(total.vac, total.units), vacant: total.vac, units: total.units },
      };
    } else {
      const what = intent.unitStatus === 'vacant' ? 'Vacant units' : intent.unitStatus ? `Units (${intent.unitStatus})` : 'Units';
      header = `${what} by building:`;
      lines = [...rows.map((r) => `${r.name} [${r.id}]: ${r.units}`), `Portfolio total: ${total.units}`];
      result = {
        by_property: rows.map((r) => ({ property_id: r.id, count: r.units })),
        total: { count: total.units },
      };
    }
    return finalize(
      `${header}\n${lines.map((l) => `- ${l}`).join('\n')}${buildExcludedOnboardingSuffix(store)}`,
      result,
      [...new Set(unitSummary.byProperty.flatMap((p) => p.citations.slice(0, 2)))].slice(0, 16),
    );
  }

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
        `At ${propRow.propertyName} (${propRow.propertyId}), ${propRow.occupiedSharePercent.toFixed(1)}% of units are occupied (${numerator} of ${plural(propRow.totalUnits, 'unit')}, comprising ${formulaNote}).`,
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
      `${matchedPropIds && matchedPropIds.length === 1 ? `At ${buildingLabel(matchedPropIds)}, across the matching units` : 'Across the matching units and operating buildings'}, the occupied share is ${share.toFixed(1)}% (${num} of ${plural(den, 'unit')}).`,
      {
        percent: share,
      },
      unitSummary.citations.slice(0, 8),
    );
  }

  // An average over no units has no value; zero would be a fabricated figure.
  if (
    ['avg_market_rent_and_sqft', 'avg_market_rent', 'avg_sqft', 'rent_per_sqft'].includes(intent.measure) &&
    unitSummary.totalFilteredUnits === 0
  ) {
    return unknown('no units match the filter, so there is no average to report.');
  }

  if (intent.measure === 'avg_market_rent_and_sqft') {
    return finalize(
      `Across the ${plural(unitSummary.totalFilteredUnits, 'matching unit')}, the average market rent is ${fmtUsd(unitSummary.filteredAvgMarketRentUsd)} and the average size is ${unitSummary.filteredAvgSqft.toFixed(1)} sqft (${fmtUsd(unitSummary.filteredRentPerSqftUsd)}/sqft).`,
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
        `${propRow.propertyName} (${propRow.propertyId}) is the matching building, and the average market rent of its ${plural(propRow.filteredUnitCount, 'matching unit')} is ${fmtUsd(propRow.filteredAvgMarketRentUsd)}.`,
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
      `Across the ${plural(unitSummary.totalFilteredUnits, 'matching unit')}, the average market rent is ${fmtUsd(unitSummary.filteredAvgMarketRentUsd)}.`,
      {
        count: unitSummary.totalFilteredUnits,
        usd: unitSummary.filteredAvgMarketRentUsd,
      },
      unitSummary.citations.slice(0, 8),
    );
  }

  if (intent.measure === 'avg_sqft') {
    return finalize(
      `Across the ${plural(unitSummary.totalFilteredUnits, 'matching unit')}, the average square footage is ${unitSummary.filteredAvgSqft.toFixed(1)} sqft.`,
      {
        count: unitSummary.totalFilteredUnits,
        sqft: unitSummary.filteredAvgSqft,
      },
      unitSummary.citations.slice(0, 8),
    );
  }

  if (intent.measure === 'rent_per_sqft') {
    return finalize(
      `Across the ${plural(unitSummary.totalFilteredUnits, 'matching unit')}, the average market rent per square foot is ${fmtUsd(unitSummary.filteredRentPerSqftUsd)}/sqft.`,
      {
        usd: unitSummary.filteredRentPerSqftUsd,
      },
      unitSummary.citations.slice(0, 8),
    );
  }

  const asksHowManyBuildings =
    /\b(how\s+many|which)\s+(?:operating\s+)?(?:buildings|properties)\b/i.test(
      question,
    ) && !/\b(units?|apartments?|studios?|bedrooms?|1br|2br|3br|4br)\b/i.test(question);

  // Default Unit Count / Cohort Property Discovery
  const nonZeroProps = unitSummary.byProperty.filter(
    (p) => p.filteredUnitCount > 0,
  );
  const asksTotalAndOccupied =
    /\bhow\s+many\s+total\s+units\b.*\bhow\s+many\s+are\s+occupied\b/i.test(
      question,
    );
  if (
    !asksHowManyBuildings &&
    !asksTotalAndOccupied &&
    !('property_ids' in schema) &&
    !hasUnitSubsetFilter &&
    intent.unitStatus === undefined &&
    intent.unitStatusIn === undefined &&
    !hasUnitSignal(question)
  ) {
    return unknown(
      `I could not match "${question.trim()}" to a metric, table, or field in the portfolio exports.`,
      propRes?.citations ?? [],
    );
  }
  if (
    (intent.aggregation === 'argmax' || intent.aggregation === 'argmin') &&
    /\bwhich\s+(?:operating\s+)?(?:building|property)\b/i.test(question) &&
    unitSummary.byProperty.length > 1
  ) {
    const wantMax = intent.aggregation === 'argmax';
    const ranked = [...unitSummary.byProperty].sort((a, b) =>
      wantMax
        ? b.filteredUnitCount - a.filteredUnitCount
        : a.filteredUnitCount - b.filteredUnitCount,
    );
    const top = ranked[0];
    const tied = ranked.filter(
      (p) => p.filteredUnitCount === top.filteredUnitCount,
    );
    const statusLabel = `${intent.unitStatus ?? 'matching'}${unitFilterLabel(intent)}`;
    // Every building at the runner-up count is named, so a tie for second is not hidden.
    const next = ranked.filter((p) => p !== top && p.filteredUnitCount === ranked[1].filteredUnitCount);
    const nextNames = next.map((p) => p.propertyName);
    const nextLabel = `${nextNames.length > 1 ? `${nextNames.slice(0, -1).join(', ')} and ${nextNames[nextNames.length - 1]}` : nextNames[0]}${next.length > 1 ? ' tie' : ''} with ${ranked[1].filteredUnitCount}${next.length > 1 ? ' each' : ''}`;
    return finalize(
      tied.length > 1
        ? `${tied.map((p) => `${p.propertyName} (${p.propertyId})`).join(' and ')} tie for the ${wantMax ? 'most' : 'fewest'} ${statusLabel} units at ${top.filteredUnitCount} each.`
        : `${top.propertyName} (${top.propertyId}) has the ${wantMax ? 'most' : 'fewest'} ${statusLabel} units at ${top.filteredUnitCount} (next: ${nextLabel})${buildExcludedOnboardingSuffix(store)}.`,
      { property_id: top.propertyId, count: top.filteredUnitCount },
      [...new Set(ranked.slice(0, 2).flatMap((p) => p.citations.slice(0, 4)))],
    );
  }
  if ('property_ids' in schema && !('count' in schema)) {
    const ids = nonZeroProps.map((p) => p.propertyId);
    return finalize(
      `The matching operating buildings are ${nonZeroProps.map((p) => `${p.propertyName} (${p.propertyId})`).join(', ')}${buildExcludedOnboardingSuffix(store)}.`,
      {
        property_ids: ids,
      },
      nonZeroProps.flatMap((p) => p.citations.slice(0, 2)),
    );
  }
  if (asksHowManyBuildings) {
    const ids = nonZeroProps.map((p) => p.propertyId);
    return finalize(
      `The ${ids.length} matching operating buildings are ${nonZeroProps.map((p) => `${p.propertyName} (${p.propertyId})`).join(', ')}${buildExcludedOnboardingSuffix(store)}.`,
      {
        count: ids.length,
        property_ids: ids,
      },
      nonZeroProps.flatMap((p) => p.citations.slice(0, 2)),
    );
  }
  if (asksTotalAndOccupied) {
    const ids = nonZeroProps.map((p) => p.propertyId);
    const totalUnits = nonZeroProps.reduce((acc, p) => acc + p.totalUnits, 0);
    const occupiedUnits = nonZeroProps.reduce(
      (acc, p) =>
        acc +
        (store.policy.occupiedIncludesNotice
          ? p.occupiedUnits + p.noticeUnits
          : p.occupiedUnits),
      0,
    );
    return finalize(
      `Across the ${ids.length} matching operating buildings (${ids.join(', ')}), there are ${totalUnits} total units and ${occupiedUnits} occupied units.`,
      {
        property_ids: ids,
        total_units: totalUnits,
        occupied_units: occupiedUnits,
      },
      nonZeroProps.flatMap((p) => p.citations.slice(0, 2)),
    );
  }
  if ('property_ids' in schema && !('count' in schema)) {
    const ids = nonZeroProps.map((p) => p.propertyId);
    return finalize(
      `The matching operating buildings are ${nonZeroProps.map((p) => `${p.propertyName} (${p.propertyId})`).join(', ')}${buildExcludedOnboardingSuffix(store)}.`,
      {
        property_ids: ids,
      },
      nonZeroProps.flatMap((p) => p.citations.slice(0, 2)),
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
      `${propRow.propertyName} (${propRow.propertyId}) has ${propRow.filteredUnitCount} ${statusLabel} units (${unitFilterLabel(intent).trim() ? `${unitFilterLabel(intent).trim()}; ` : ''}out of ${propRow.totalUnits} total units).`,
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
    `Across the matching operating buildings (${nonZeroProps.map((p) => `${p.propertyName} [${p.propertyId}]: ${p.filteredUnitCount}`).join(', ') || '0 matching units'}), there are ${plural(unitSummary.totalFilteredUnits, 'matching unit')}.`,
    {
      count: unitSummary.totalFilteredUnits,
    },
    unitSummary.citations.slice(0, 8),
  );
}

/**
 * The unit filters a ranking applied, read off the parsed fields, so the
 * text names the subset it ranked (" 2-bedroom", " studio, rent under $2,000").
 */
function unitFilterLabel(intent: ParsedQueryIntent): string {
  const parts: string[] = [];
  const range = (lo: number | undefined, hi: number | undefined, unit: string, fmt = (n: number) => String(n)) =>
    lo !== undefined && hi !== undefined ? `${unit} ${fmt(lo)} to ${fmt(hi)}` : lo !== undefined ? `${unit} ${fmt(lo)} or more` : hi !== undefined ? `${unit} up to ${fmt(hi)}` : null;
  if (intent.bedrooms !== undefined) parts.push(intent.bedrooms === 0 ? 'studio' : `${intent.bedrooms}-bedroom`);
  if (intent.bathrooms !== undefined) parts.push(`${intent.bathrooms}-bath`);
  const usd = (n: number) => `$${n.toLocaleString('en-US')}`;
  for (const r of [range(intent.bedroomsMin, intent.bedroomsMax, 'bedrooms'), range(intent.bathroomsMin, intent.bathroomsMax, 'baths'), range(intent.rentMin, intent.rentMax, 'rent', usd), range(intent.sqftMin, intent.sqftMax, 'sq ft'), range(intent.floorMin, intent.floorMax, 'floor')]) if (r) parts.push(r);
  if (intent.view) parts.push(`${intent.view} view`);
  if (intent.buildingClass) parts.push(`class ${intent.buildingClass}`);
  return parts.length > 0 ? ` ${parts.join(', ')}` : '';
}
