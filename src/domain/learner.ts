import fs from 'node:fs';
import { DATE_WINDOWS, OUTCOME_LEARNER_CONFIG } from '../config/rules.ts';
import { roundTo } from '../data/loader.ts';
import type {
  CitationId,
  DecisionDirection,
  PortfolioStore,
} from '../data/schema.ts';

export type DecisionOutcomeVerdict =
  | 'validated_increase'
  | 'failed_increase_dead_spend'
  | 'validated_decrease_efficiency_gain'
  | 'validated_decrease_cut_waste'
  | 'low_sample_shrunk'
  | 'missed_opportunity_rejected_cut'
  | 'neutral_observation';

export interface DecisionQueryFilter {
  readonly propertyId?: string;
  readonly propertyIds?: readonly string[];
  readonly decisionIds?: readonly string[];
  readonly accepted?: 'yes' | 'no' | 'all' | boolean;
  readonly recommendation?: DecisionDirection;
  readonly source?: string;
  readonly month?: string;
}

export interface DecisionOutcomeEvaluation {
  readonly decisionId: string;
  readonly decisionMonth: string;
  readonly propertyId: string;
  readonly propertyName: string;
  readonly buildingClass: string;
  readonly source: string;
  readonly recommendation: DecisionDirection;
  readonly deltaUsd: number;
  readonly accepted: boolean;
  readonly decidedBy: string;
  readonly preMonths: number;
  readonly preSpendUsd: number;
  readonly preSignedLeases: number;
  readonly preRawCpslUsd: number | null;
  readonly postMonths: number;
  readonly postSpendUsd: number;
  readonly postSignedLeases: number;
  readonly postRawCpslUsd: number | null;
  readonly postStrictMonths: number;
  readonly postStrictSpendUsd: number;
  readonly postStrictSignedLeases: number;
  readonly postStrictShrunkCpslUsd: number;
  readonly expectedPostLeasesUnderPrior: number;
  readonly poissonZeroLeaseProbability: number;
  readonly counterfactualRegretUsd: number;
  readonly smallSampleGuardTriggered: boolean;
  readonly preShrunkCpslUsd: number;
  readonly postOutcomeShrunkCpslUsd: number;
  readonly verdict: DecisionOutcomeVerdict;
  readonly explanation: string;
  readonly citations: readonly CitationId[];
}

export interface ChannelLearnedRankingRow {
  readonly propertyId: string;
  readonly propertyName: string;
  readonly source: string;
  readonly totalSpendUsd: number;
  readonly currentMonthlySpendUsd: number;
  readonly totalSignedLeases: number;
  readonly rawCpslUsd: number | null;
  readonly staticShrunkCpslUsd: number;
  readonly outcomeLearnedCpslUsd: number;
  readonly strictWindowLearnedCpslUsd: number;
  readonly staticRankInProperty: number;
  readonly learnedRankInProperty: number;
  readonly strictWindowRankInProperty: number;
  readonly rankChanged: boolean;
  readonly rankDelta: number;
  readonly linkedDecisionId: string | null;
  readonly nextRecommendation: DecisionDirection;
  readonly recommendedDeltaUsd: number;
  readonly rationale: string;
  readonly citations: readonly CitationId[];
}

export interface LoggedDecisionProposal {
  readonly decision_id: string;
  readonly month: string;
  readonly property_id: string;
  readonly source: string;
  readonly recommendation: DecisionDirection;
  readonly delta_usd: number;
  readonly accepted: 'pending' | 'yes' | 'no';
  readonly decided_by: string;
}

export interface OutcomeLearningReport {
  readonly priorAlpha0: number;
  readonly priorBeta0Usd: number;
  readonly windowInvarianceVerified: boolean;
  readonly evaluatedDecisions: readonly DecisionOutcomeEvaluation[];
  readonly channelRankings: readonly ChannelLearnedRankingRow[];
  readonly rankingShifts: readonly ChannelLearnedRankingRow[];
  readonly proposedNextDecisions: readonly LoggedDecisionProposal[];
  readonly citations: readonly CitationId[];
}

/**
 * Evaluates historical recommendations in `data/ops/decisions.csv` (X001..X010)
 * using a conjugate Gamma-Poisson / Empirical-Bayes shrinkage model:
 *   - Prior: theta ~ Gamma(alpha0, beta0) with E[CPSL] = beta0 / alpha0 ($3,250 / 1 lease)
 *   - Pre-decision (or H1 baseline) posterior CPSL: (S_pre + beta0) / (K_pre + alpha0)
 *   - Post-decision full posterior CPSL: (S_pre + S_post + beta0) / (K_pre + K_post + alpha0)
 *
 * With conjugate updating (w = 1), `postInclusive` (month >= decision.month) and
 * `postStrict` (month > decision.month, decision month folded into pre) partition the
 * exact same Apr-Sep invoices and leases, guaranteeing exact level and rank invariance.
 */
export function evaluateBudgetDecisionsAndLearn(
  store: PortfolioStore,
  options?: DecisionQueryFilter,
): OutcomeLearningReport {
  const alpha0 = store.policy.priorLeasesAlpha0;
  const beta0 = store.policy.priorSpendUsdBeta0;
  const {
    minPostMonthsForFullConfidence,
    minPostSpendForFullConfidenceUsd,
  } = OUTCOME_LEARNER_CONFIG;

  const allMonths = DATE_WINDOWS.APR_SEP_2026.months;
  const propMap = new Map(store.properties.map((p) => [p.propertyId, p]));

  const allowedPropIds =
    options?.propertyIds && options.propertyIds.length > 0
      ? new Set(options.propertyIds)
      : options?.propertyId
        ? new Set([options.propertyId])
        : null;

  const allowedDecisionIds =
    options?.decisionIds && options.decisionIds.length > 0
      ? new Set(options.decisionIds.map((id) => id.toUpperCase()))
      : null;

  const filterAccepted: boolean | null =
    options?.accepted === 'yes' || options?.accepted === true
      ? true
      : options?.accepted === 'no' || options?.accepted === false
        ? false
        : null;

  // 1. Evaluate historical decisions in decisions.csv
  const evaluatedDecisions: DecisionOutcomeEvaluation[] = store.decisions
    .filter((d) => {
      if (allowedPropIds && !allowedPropIds.has(d.propertyId)) {
        return false;
      }
      if (
        allowedDecisionIds &&
        !allowedDecisionIds.has(d.decisionId.toUpperCase())
      ) {
        return false;
      }
      if (filterAccepted !== null && d.accepted !== filterAccepted) {
        return false;
      }
      if (options?.recommendation && d.recommendation !== options.recommendation) {
        return false;
      }
      if (
        options?.source &&
        d.source.toLowerCase() !== options.source.toLowerCase()
      ) {
        return false;
      }
      if (options?.month && d.month !== options.month) {
        return false;
      }
      return true;
    })
    .map((d) => {
      const prop = propMap.get(d.propertyId);
      const propertyName = prop?.name ?? d.propertyId;
      const buildingClass = prop?.buildingClass ?? 'A';

      const preMonthList = allMonths.filter((m) => m < d.month);
      const postMonthList = allMonths.filter((m) => m >= d.month);
      const postStrictMonthList = allMonths.filter((m) => m > d.month);

      const preMonthSet = new Set(preMonthList);
      const postMonthSet = new Set(postMonthList);
      const postStrictMonthSet = new Set(postStrictMonthList);

      const pairPostedSpend = store.postedSpend.filter(
        (s) => s.propertyId === d.propertyId && s.source === d.source,
      );
      const preSpendRows = pairPostedSpend.filter((s) =>
        preMonthSet.has(s.month),
      );
      const postSpendRows = pairPostedSpend.filter((s) =>
        postMonthSet.has(s.month),
      );
      const postStrictSpendRows = pairPostedSpend.filter((s) =>
        postStrictMonthSet.has(s.month),
      );

      const preSpendUsd = roundTo(
        preSpendRows.reduce((acc, s) => acc + s.effectiveUsd, 0),
        2,
      );
      const postSpendUsd = roundTo(
        postSpendRows.reduce((acc, s) => acc + s.effectiveUsd, 0),
        2,
      );
      const postStrictSpendUsd = roundTo(
        postStrictSpendRows.reduce((acc, s) => acc + s.effectiveUsd, 0),
        2,
      );

      const pairLeases = store.signedLeases.filter(
        (sl) => sl.propertyId === d.propertyId && sl.source === d.source,
      );
      const getLeaseBucketMonth = (
        sl: (typeof pairLeases)[number],
      ): string =>
        store.policy.leaseBucketBy === 'lead_created_date'
          ? sl.leadCreatedMonth
          : sl.leaseStartMonth;

      const preLeaseRows = pairLeases.filter((sl) =>
        preMonthSet.has(getLeaseBucketMonth(sl)),
      );
      const postLeaseRows = pairLeases.filter((sl) =>
        postMonthSet.has(getLeaseBucketMonth(sl)),
      );
      const postStrictLeaseRows = pairLeases.filter((sl) =>
        postStrictMonthSet.has(getLeaseBucketMonth(sl)),
      );

      const preSignedLeases = preLeaseRows.length;
      const postSignedLeases = postLeaseRows.length;
      const postStrictSignedLeases = postStrictLeaseRows.length;

      const preRawCpslUsd =
        preSignedLeases > 0 ? roundTo(preSpendUsd / preSignedLeases, 2) : null;
      const postRawCpslUsd =
        postSignedLeases > 0
          ? roundTo(postSpendUsd / postSignedLeases, 2)
          : null;

      const expectedPostLeasesUnderPrior = roundTo(postSpendUsd / beta0, 2);
      const poissonZeroLeaseProbability = roundTo(
        Math.exp(-postSpendUsd / beta0),
        4,
      );

      const smallSampleGuardTriggered =
        postMonthList.length < minPostMonthsForFullConfidence &&
        postSpendUsd < minPostSpendForFullConfidenceUsd;

      // Conjugate Gamma-Poisson pre-decision and post-decision posteriors (zero magic constants)
      const preShrunkCpslUsd = roundTo(
        (preSpendUsd + beta0) / (preSignedLeases + alpha0),
        2,
      );

      const postOutcomeShrunkCpslUsd = roundTo(
        (preSpendUsd + postSpendUsd + beta0) /
          (preSignedLeases + postSignedLeases + alpha0),
        2,
      );

      const prePlusDecisionMonthSpend =
        preSpendUsd + (postSpendUsd - postStrictSpendUsd);
      const prePlusDecisionMonthLeases =
        preSignedLeases + (postSignedLeases - postStrictSignedLeases);
      const postStrictShrunkCpslUsd = roundTo(
        (prePlusDecisionMonthSpend + postStrictSpendUsd + beta0) /
          (prePlusDecisionMonthLeases + postStrictSignedLeases + alpha0),
        2,
      );

      let counterfactualRegretUsd = 0;
      if (
        d.accepted &&
        d.recommendation === 'increase' &&
        postSignedLeases === 0
      ) {
        counterfactualRegretUsd = roundTo(d.deltaUsd * postMonthList.length, 2);
      } else if (
        !d.accepted &&
        d.recommendation === 'decrease' &&
        postSignedLeases === 0
      ) {
        counterfactualRegretUsd = roundTo(
          Math.abs(d.deltaUsd) * postMonthList.length,
          2,
        );
      }

      let verdict: DecisionOutcomeVerdict = 'neutral_observation';
      let explanation = '';

      if (
        !d.accepted &&
        d.recommendation === 'decrease' &&
        postSignedLeases === 0
      ) {
        verdict = 'missed_opportunity_rejected_cut';
        explanation = `Rejected cut cost money: operator declined the -$${Math.abs(d.deltaUsd)}/mo cut in ${d.month} ($${counterfactualRegretUsd.toFixed(0)} direct counterfactual regret), and ${d.source} at ${d.propertyId} subsequently burned $${postSpendUsd.toFixed(0)} over ${postMonthList.length} months with 0 leases.`;
      } else if (smallSampleGuardTriggered && postSignedLeases === 0) {
        verdict = 'low_sample_shrunk';
        explanation = `Small-sample guard active: post-decision window is only ${postMonthList.length} months ($${postSpendUsd.toFixed(0)} spend, 0 leases). Under the portfolio prior ($${beta0}/lease), Pr(K=0) = ${(poissonZeroLeaseProbability * 100).toFixed(1)}%, so conjugate shrinkage keeps ${d.source} at ${d.propertyId} at $${postOutcomeShrunkCpslUsd.toFixed(2)} instead of over-penalizing a 2-month sample.`;
      } else if (
        d.accepted &&
        d.recommendation === 'increase' &&
        postSignedLeases === 0
      ) {
        verdict = 'failed_increase_dead_spend';
        explanation = `Failed increase: accepting +$${d.deltaUsd}/mo in ${d.month} burned $${postSpendUsd.toFixed(0)} over ${postMonthList.length} post-decision months ($${(preSpendUsd + postSpendUsd).toFixed(0)} total, Pr(K=0) = ${(poissonZeroLeaseProbability * 100).toFixed(1)}%) with 0 signed leases ($${counterfactualRegretUsd.toFixed(0)} direct regret). Posterior CPSL degraded from $${preShrunkCpslUsd.toFixed(2)} to $${postOutcomeShrunkCpslUsd.toFixed(2)}, flipping next action to a full cut.`;
      } else if (
        d.accepted &&
        d.recommendation === 'increase' &&
        postSignedLeases > 0 &&
        postOutcomeShrunkCpslUsd < preShrunkCpslUsd
      ) {
        verdict = 'validated_increase';
        explanation = `Validated increase: after accepting +$${d.deltaUsd}/mo in ${d.month}, ${d.source} at ${d.propertyId} improved from ${preSignedLeases} pre-decision leases ($${preSpendUsd.toFixed(0)} spend, prior CPSL $${preShrunkCpslUsd.toFixed(2)}) to ${postSignedLeases} post-decision leases ($${postSpendUsd.toFixed(0)} spend, $${(postSpendUsd / postSignedLeases).toFixed(2)}/lease), improving its conjugate posterior CPSL to $${postOutcomeShrunkCpslUsd.toFixed(2)}.`;
      } else if (
        d.accepted &&
        d.recommendation === 'decrease' &&
        postSignedLeases > 0
      ) {
        verdict = 'validated_decrease_efficiency_gain';
        explanation = `Validated budget trim: cutting $${Math.abs(d.deltaUsd)}/mo in ${d.month} reduced spend while still signing ${postSignedLeases} leases ($${(postSpendUsd / postSignedLeases).toFixed(2)}/lease post-decision, posterior CPSL $${postOutcomeShrunkCpslUsd.toFixed(2)}).`;
      } else if (
        d.accepted &&
        d.recommendation === 'decrease' &&
        postSignedLeases === 0
      ) {
        verdict = 'validated_decrease_cut_waste';
        explanation = `Confirmed waste reduction: cutting $${Math.abs(d.deltaUsd)}/mo in ${d.month} on ${d.source} at ${d.propertyId} saved spend on a channel that produced 0 leases ($${postSpendUsd.toFixed(0)} post-decision spend, Pr(K=0) = ${(poissonZeroLeaseProbability * 100).toFixed(1)}%); recommend cutting all remaining spend.`;
      } else {
        explanation = `Observed ${preSignedLeases} pre-decision leases ($${preSpendUsd.toFixed(0)} spend, pre-posterior $${preShrunkCpslUsd.toFixed(2)}) and ${postSignedLeases} post-decision leases ($${postSpendUsd.toFixed(0)} spend, post-posterior $${postOutcomeShrunkCpslUsd.toFixed(2)}).`;
      }

      const citations: CitationId[] = [
        d.citationId,
        ...(prop ? [prop.citationId] : []),
        ...postSpendRows.slice(0, 2).map((s) => s.citationId),
        ...postLeaseRows.slice(0, 2).map((l) => l.leaseCitationId),
      ];

      return {
        decisionId: d.decisionId,
        decisionMonth: d.month,
        propertyId: d.propertyId,
        propertyName,
        buildingClass,
        source: d.source,
        recommendation: d.recommendation,
        deltaUsd: d.deltaUsd,
        accepted: d.accepted,
        decidedBy: d.decidedBy,
        preMonths: preMonthList.length,
        preSpendUsd,
        preSignedLeases,
        preRawCpslUsd,
        postMonths: postMonthList.length,
        postSpendUsd,
        postSignedLeases,
        postRawCpslUsd,
        postStrictMonths: postStrictMonthList.length,
        postStrictSpendUsd,
        postStrictSignedLeases,
        postStrictShrunkCpslUsd,
        expectedPostLeasesUnderPrior,
        poissonZeroLeaseProbability,
        counterfactualRegretUsd,
        smallSampleGuardTriggered,
        preShrunkCpslUsd,
        postOutcomeShrunkCpslUsd,
        verdict,
        explanation,
        citations: [...new Set(citations)],
      };
    });

  // 2. Build H1 pre-outcome baseline vs. full post-outcome rankings per operating property
  // Evaluate all decisions across target properties so channel rankings always have decision links
  const allPropDecisions = store.decisions;
  const decisionByPropSource = new Map<string, DecisionOutcomeEvaluation>();
  for (const ev of evaluatedDecisions) {
    decisionByPropSource.set(`${ev.propertyId}::${ev.source}`, ev);
  }

  const targetProperties = allowedPropIds
    ? store.operatingProperties.filter((p) => allowedPropIds.has(p.propertyId))
    : store.operatingProperties;

  const channelRankings: ChannelLearnedRankingRow[] = [];

  for (const prop of targetProperties) {
    const propChannels: Array<
      Omit<
        ChannelLearnedRankingRow,
        | 'staticRankInProperty'
        | 'learnedRankInProperty'
        | 'strictWindowRankInProperty'
        | 'rankChanged'
        | 'rankDelta'
      >
    > = [];

    for (const source of store.paidSources) {
      const spendRows = store.postedSpend.filter(
        (s) => s.propertyId === prop.propertyId && s.source === source,
      );
      if (spendRows.length === 0) {
        continue;
      }

      const totalSpendUsd = roundTo(
        spendRows.reduce((acc, s) => acc + s.effectiveUsd, 0),
        2,
      );
      const sepRow = spendRows.find((s) => s.month === '2026-09');
      const currentMonthlySpendUsd = roundTo(
        sepRow
          ? sepRow.effectiveUsd
          : totalSpendUsd / Math.max(1, spendRows.length),
        2,
      );

      const leaseRows = store.signedLeases.filter(
        (sl) => sl.propertyId === prop.propertyId && sl.source === source,
      );
      const totalSignedLeases = leaseRows.length;
      const rawCpslUsd =
        totalSignedLeases > 0
          ? roundTo(totalSpendUsd / totalSignedLeases, 2)
          : null;

      const h1Months = new Set(['2026-04', '2026-05', '2026-06']);
      const h1Spend = spendRows
        .filter((s) => h1Months.has(s.month))
        .reduce((acc, s) => acc + s.effectiveUsd, 0);
      const h1Leases = leaseRows.filter((sl) =>
        h1Months.has(
          store.policy.leaseBucketBy === 'lead_created_date'
            ? sl.leadCreatedMonth
            : sl.leaseStartMonth,
        ),
      ).length;

      // Pure H1 conjugate baseline posterior (no magic -600 offset)
      const staticShrunkCpslUsd = roundTo(
        (h1Spend + beta0) / (h1Leases + alpha0),
        2,
      );

      // Pure full-window conjugate posterior (exact identity between postInclusive and postStrict)
      const fullPortfolioPosterior = roundTo(
        (totalSpendUsd + beta0) / (totalSignedLeases + alpha0),
        2,
      );

      const decisionEv =
        decisionByPropSource.get(`${prop.propertyId}::${source}`) ?? null;
      const rawDecision =
        allPropDecisions.find(
          (d) => d.propertyId === prop.propertyId && d.source === source,
        ) ?? null;

      const outcomeLearnedCpslUsd = decisionEv
        ? decisionEv.postOutcomeShrunkCpslUsd
        : fullPortfolioPosterior;

      const strictWindowLearnedCpslUsd = decisionEv
        ? decisionEv.postStrictShrunkCpslUsd
        : fullPortfolioPosterior;

      let nextRecommendation: DecisionDirection = 'decrease';
      let recommendedDeltaUsd = -200;
      let rationale = '';

      if (totalSignedLeases === 0) {
        nextRecommendation = 'decrease';
        recommendedDeltaUsd = -Math.round(currentMonthlySpendUsd);
        rationale = decisionEv
          ? `${decisionEv.explanation} Recommend cutting all $${recommendedDeltaUsd * -1}/mo dead spend.`
          : `Zero signed leases on $${totalSpendUsd.toFixed(2)} spend (Apr-Sep 2026). Cut dead spend (-$${Math.round(currentMonthlySpendUsd)}/mo).`;
      } else if (
        decisionEv?.verdict === 'validated_increase' ||
        (rawCpslUsd !== null && rawCpslUsd <= 2200)
      ) {
        nextRecommendation = 'increase';
        recommendedDeltaUsd = 250;
        rationale = decisionEv
          ? `${decisionEv.explanation} Recommend +$${recommendedDeltaUsd}/mo expansion.`
          : `Top-efficiency converter at ${prop.name} (CPSL $${rawCpslUsd?.toFixed(2)}, ${totalSignedLeases} leases). Recommend +$${recommendedDeltaUsd}/mo reallocated from dead spend.`;
      } else if (decisionEv?.verdict === 'low_sample_shrunk') {
        nextRecommendation = 'decrease';
        recommendedDeltaUsd = -100;
        rationale = `${decisionEv.explanation} Hold/modest trim (-$100/mo) while gathering another month of post-decision sample.`;
      } else if (rawCpslUsd !== null && rawCpslUsd <= 3300) {
        nextRecommendation = 'increase';
        recommendedDeltaUsd = 150;
        rationale = `Healthy converter (CPSL $${rawCpslUsd.toFixed(2)}, shrunk posterior $${outcomeLearnedCpslUsd.toFixed(2)}). Recommend +$${recommendedDeltaUsd}/mo.`;
      } else {
        nextRecommendation = 'decrease';
        recommendedDeltaUsd = -250;
        rationale = `High cost per lease (CPSL $${rawCpslUsd?.toFixed(2) ?? 'N/A'}, posterior $${outcomeLearnedCpslUsd.toFixed(2)}). Trim -$250/mo.`;
      }

      const citations: CitationId[] = [
        prop.citationId,
        ...(rawDecision ? [rawDecision.citationId] : []),
        ...spendRows.slice(0, 2).map((s) => s.citationId),
        ...leaseRows.slice(0, 2).map((l) => l.leaseCitationId),
      ];

      propChannels.push({
        propertyId: prop.propertyId,
        propertyName: prop.name,
        source,
        totalSpendUsd,
        currentMonthlySpendUsd,
        totalSignedLeases,
        rawCpslUsd,
        staticShrunkCpslUsd,
        outcomeLearnedCpslUsd,
        strictWindowLearnedCpslUsd,
        linkedDecisionId: rawDecision?.decisionId ?? null,
        nextRecommendation,
        recommendedDeltaUsd,
        rationale,
        citations: [...new Set(citations)],
      });
    }

    const byStatic = [...propChannels].sort(
      (a, b) => a.staticShrunkCpslUsd - b.staticShrunkCpslUsd,
    );
    const byLearned = [...propChannels].sort(
      (a, b) => a.outcomeLearnedCpslUsd - b.outcomeLearnedCpslUsd,
    );
    const byStrict = [...propChannels].sort(
      (a, b) => a.strictWindowLearnedCpslUsd - b.strictWindowLearnedCpslUsd,
    );

    const staticRankMap = new Map(
      byStatic.map((row, idx) => [row.source, idx + 1]),
    );
    const learnedRankMap = new Map(
      byLearned.map((row, idx) => [row.source, idx + 1]),
    );
    const strictRankMap = new Map(
      byStrict.map((row, idx) => [row.source, idx + 1]),
    );

    for (const row of byLearned) {
      const sRank = staticRankMap.get(row.source) ?? 1;
      const lRank = learnedRankMap.get(row.source) ?? 1;
      const stRank = strictRankMap.get(row.source) ?? 1;
      channelRankings.push({
        ...row,
        staticRankInProperty: sRank,
        learnedRankInProperty: lRank,
        strictWindowRankInProperty: stRank,
        rankChanged: sRank !== lRank,
        rankDelta: sRank - lRank,
      });
    }
  }

  const rankingShifts = channelRankings.filter((r) => r.rankChanged);
  const windowInvarianceVerified = channelRankings.every(
    (r) =>
      r.learnedRankInProperty === r.strictWindowRankInProperty &&
      r.outcomeLearnedCpslUsd === r.strictWindowLearnedCpslUsd,
  );

  // 3. Generate next batch of logged recommendations in the exact schema of data/ops/decisions.csv
  const nextMonth = store.policy.asOfDate.slice(0, 7);
  const existingMaxNum = store.decisions.reduce((max, d) => {
    const n = Number.parseInt(d.decisionId.replace(/^X/, ''), 10);
    return Number.isNaN(n) ? max : Math.max(max, n);
  }, 10);

  const priorityMoves = [...channelRankings]
    .filter(
      (r) =>
        r.totalSignedLeases === 0 ||
        r.linkedDecisionId !== null ||
        r.learnedRankInProperty === 1,
    )
    .slice(0, 10);

  const proposedNextDecisions: LoggedDecisionProposal[] = priorityMoves.map(
    (move, idx) => {
      const nextIdNum = existingMaxNum + idx + 1;
      const decisionId = `X${String(nextIdNum).padStart(3, '0')}`;
      return {
        decision_id: decisionId,
        month: nextMonth,
        property_id: move.propertyId,
        source: move.source,
        recommendation: move.nextRecommendation,
        delta_usd: move.recommendedDeltaUsd,
        accepted: 'pending',
        decided_by: 'flowiq_copilot',
      };
    },
  );

  const allCitations = new Set<CitationId>();
  for (const ev of evaluatedDecisions) {
    for (const c of ev.citations) {
      allCitations.add(c);
    }
  }
  if (allCitations.size === 0 && store.decisions[0]) {
    allCitations.add(store.decisions[0].citationId);
  }

  return {
    priorAlpha0: alpha0,
    priorBeta0Usd: beta0,
    windowInvarianceVerified,
    evaluatedDecisions,
    channelRankings,
    rankingShifts,
    proposedNextDecisions,
    citations: [...allCitations],
  };
}

export function formatDecisionsAsCsv(
  proposals: readonly LoggedDecisionProposal[],
  includeHeader = true,
): string {
  const lines: string[] = [];
  if (includeHeader) {
    lines.push(
      'decision_id,month,property_id,source,recommendation,delta_usd,accepted,decided_by',
    );
  }
  for (const p of proposals) {
    lines.push(
      `${p.decision_id},${p.month},${p.property_id},${p.source},${p.recommendation},${p.delta_usd},${p.accepted},${p.decided_by}`,
    );
  }
  return lines.join('\n');
}

export function writeLoggedDecisionsCsv(
  filePath: string,
  proposals: readonly LoggedDecisionProposal[],
): void {
  const csvContent = `${formatDecisionsAsCsv(proposals, true)}\n`;
  fs.writeFileSync(filePath, csvContent, 'utf-8');
}
