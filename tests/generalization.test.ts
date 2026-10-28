import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { executeAgentTool } from '../src/agent/tools.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';
import type { PortfolioStore } from '../src/data/schema.ts';
import { evaluateBudgetDecisionsAndLearn } from '../src/domain/learner.ts';
import {
  evaluateGenericAllocationAndLearner,
  evaluateSheafCoboundary,
  FLOW_PORTFOLIO_SHEAF_EDGES,
  type GenericRelationalTables,
  portfolioStoreToGenericTables,
  verifySheafConsistency,
} from '../src/domain/sheaf.ts';
import { runOperadicConsistencySuite } from '../src/operadic-eval.ts';
import { FLOW_PORTFOLIO_SCHEMA, SAAS_FINOPS_SCHEMA } from '../src/schema.ts';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const store = loadPortfolioStore(repoRoot);

describe('Category Generalization · Domain 1: FLOW Real-Estate Cellular Sheaf (E1..E6)', () => {
  it('verifies global section after quarantine and recovers all real traps and coboundary residuals on 3,858 rows', () => {
    const coboundary = evaluateSheafCoboundary(store, FLOW_PORTFOLIO_SHEAF_EDGES);
    assert.equal(coboundary.isGlobalSection, true);
    assert.equal(coboundary.blockingResidualCount, 0);

    // E1: P09 non-operating onboarding property
    const e1 = coboundary.byEdge.E1_PROPERTIES_TO_UNITS_COUNT;
    assert.equal(e1.length, 1);
    assert.equal(e1[0].joinKey, 'P09');
    assert.ok(e1[0].citations.includes('properties:P09'));

    // E2: 0 status mismatches across all 1,100 units and 1,033 active leases
    const e2 = coboundary.byEdge.E2_UNITS_TO_LEASES_STATUS;
    assert.equal(e2.length, 0);

    // E3: Notice-unit market_rent vs contract monthly_rent fiber gap ($1,955/mo total; $370/mo at P06)
    const e3 = coboundary.byEdge.E3_UNITS_TO_LEASES_RENT_FIBER;
    assert.equal(e3.length, 8);
    const totalRentGap = e3.reduce((acc, r) => acc + r.residualMagnitude, 0);
    assert.equal(totalRentGap, 1955);
    const p06Gap = e3.find((r) => r.joinKey === 'P06');
    assert.equal(p06Gap?.residualMagnitude, 370);

    // E4: 9 duplicate phone-reentry leads (D01490..D01498) + 20 cross-month Q2->Q3 boundary shifts
    const e4 = coboundary.byEdge.E4_LEADS_TO_LEASES_PULLBACK;
    const dupResiduals = e4.filter((r) => r.severity === 'quarantine_row');
    const shiftResiduals = e4.filter(
      (r) => r.severity === 'temporal_boundary_shift',
    );
    assert.equal(dupResiduals.length, 9);
    assert.equal(shiftResiduals.length, 70);
    const q2ToQ3Shifts = shiftResiduals.filter((r) => r.leftProjection === '2026-06' && r.rightProjection === '2026-07');
    assert.equal(q2ToQ3Shifts.length, 20);

    // E5: 9 dead-spend (property_id, source) pairs totaling $46,599.90
    const e5 = coboundary.byEdge.E5_SPEND_TO_LEASES_SUPPORT;
    assert.equal(e5.length, 9);
    const deadSum = Number(
      e5.reduce((acc, r) => acc + r.residualMagnitude, 0).toFixed(2),
    );
    assert.equal(deadSum, 46599.9);

    // E6: Accepted decisions step-change coboundary residuals
    const e6 = coboundary.byEdge.E6_DECISIONS_TO_SPEND_STEP;
    assert.ok(e6.length >= 5);
    assert.ok(e6.some((r) => r.joinKey === 'X001'));

    // Generic schema-driven verification + reallocation over the same 3,858 rows
    const genericTables = portfolioStoreToGenericTables(store);
    const genericReport = verifySheafConsistency(
      FLOW_PORTFOLIO_SCHEMA,
      genericTables,
    );
    assert.equal(genericReport.totalRowsScanned, 3858);
    assert.equal(genericReport.quarantinedCountsByStalk.properties, 1); // P09
    assert.equal(genericReport.quarantinedCountsByStalk.spend, 10); // 10 void invoices
    assert.equal(genericReport.quarantinedCountsByStalk.leads, 10); // 9 duplicate leads + 1 D01011 injection

    const genericAlloc = evaluateGenericAllocationAndLearner(
      FLOW_PORTFOLIO_SCHEMA,
      genericTables,
    );
    assert.equal(genericAlloc.deadPairs.length, 9);
    assert.equal(genericAlloc.totalDeadSpendUsd, 46599.9);
    assert.equal(genericAlloc.bestChannel, 'Apartments.com');
    assert.equal(genericAlloc.bestChannelCpslUsd, 2915.86);
    assert.equal(genericAlloc.projectedAdditionalOutcomes, 15);
  });

  it('detects injected coboundary faults (vacant unit with active lease, funnel inversion, pre-lead lease start)', () => {
    const mutatedStore: PortfolioStore = {
      ...store,
      units: store.units.map((u, idx) =>
        idx === 0 ? { ...u, status: 'vacant' } : u,
      ),
      leads: store.leads.map((ld, idx) =>
        idx === 0
          ? { ...ld, toured: false, applied: true }
          : idx === 6
            ? { ...ld, createdDate: '2026-09-15' }
            : ld,
      ),
    };

    const faultReport = evaluateSheafCoboundary(
      mutatedStore,
      FLOW_PORTFOLIO_SHEAF_EDGES,
    );
    assert.equal(faultReport.isGlobalSection, false);
    assert.ok(faultReport.blockingResidualCount >= 3);
    assert.ok(
      faultReport.byEdge.E2_UNITS_TO_LEASES_STATUS.some(
        (r) => r.joinKey === store.units[0].unitId && r.blocking,
      ),
    );
    assert.ok(
      faultReport.byEdge.E4_LEADS_TO_LEASES_PULLBACK.some(
        (r) => r.joinKey === store.leads[0].leadId && r.blocking,
      ),
    );

    // Also verify the audit_sheaf_consistency agent tool
    const trace = executeAgentTool(store, 'audit_sheaf_consistency', {
      includeGenericReport: true,
    });
    assert.ok(trace.outputSummary.includes('isGlobalSection=true'));
    assert.ok(trace.citations.includes('properties:P09'));
  });

  it('classifies X009 (P01 Facebook Ads) and X010 (P08 Zillow unaccepted increase) accurately', () => {
    const learner = evaluateBudgetDecisionsAndLearn(store);
    const x009 = learner.evaluatedDecisions.find((d) => d.decisionId === 'X009');
    const x010 = learner.evaluatedDecisions.find((d) => d.decisionId === 'X010');

    assert.equal(x009?.propertyId, 'P01');
    assert.equal(x009?.source, 'Facebook Ads');
    assert.equal(x009?.verdict, 'low_sample_shrunk');
    assert.equal(x009?.smallSampleGuardTriggered, true);

    assert.equal(x010?.propertyId, 'P08');
    assert.equal(x010?.source, 'Zillow');
    assert.equal(x010?.accepted, false);
    assert.equal(x010?.smallSampleGuardTriggered, false);
    assert.equal(x010?.verdict, 'correctly_rejected_dead_spend_increase');
  });
});

describe('Category Generalization · Domain 2: B2B SaaS / Cloud FinOps Schema (Zero Engine Changes)', () => {
  it('runs verifySheafConsistency and evaluateGenericAllocationAndLearner on SAAS_FINOPS_SCHEMA', () => {
    const saasTables: GenericRelationalTables = {
      regions: [
        { region_id: 'R01', name: 'us-east-1', active_clusters: 12 },
        { region_id: 'R02', name: 'eu-central-1', active_clusters: 8 },
        { region_id: 'R03', name: 'ap-northeast-1', active_clusters: 0 }, // unlaunched region -> quarantined
      ],
      campaigns: [
        { campaign_id: 'C001', region_id: 'R01', channel: 'GitHub Sponsors', status: 'posted', raw_amount: 4000, effective_usd: 4000 },
        { campaign_id: 'C002', region_id: 'R01', channel: 'LinkedIn Ads', status: 'posted', raw_amount: 6000, effective_usd: 6000 }, // 0 contracts -> dead spend
        { campaign_id: 'C003', region_id: 'R01', channel: 'LinkedIn Ads', status: 'void', raw_amount: 2000, effective_usd: 0 }, // void -> quarantined
        { campaign_id: 'C004', region_id: 'R02', channel: 'GitHub Sponsors', status: 'posted', raw_amount: 2000, effective_usd: 2000 },
        { campaign_id: 'C005', region_id: 'R02', channel: 'Paid Search', status: 'posted', raw_amount: 3000, effective_usd: 3000 }, // 0 contracts -> dead spend
        { campaign_id: 'C006', region_id: 'R03', channel: 'GitHub Sponsors', status: 'posted', raw_amount: 5000, effective_usd: 5000 }, // on quarantined R03
      ],
      trials_weekly: [
        { trial_id: 'TR001', region_id: 'R01', channel: 'GitHub Sponsors', created_date: '2026-05-01', contract_id: 'CT001', is_prompt_injection: false },
        { trial_id: 'TR002', region_id: 'R01', channel: 'GitHub Sponsors', created_date: '2026-05-03', contract_id: 'CT001', is_prompt_injection: false }, // duplicate claim -> quarantined
        { trial_id: 'TR003', region_id: 'R02', channel: 'GitHub Sponsors', created_date: '2026-06-01', contract_id: 'CT002', is_prompt_injection: false },
        { trial_id: 'TR004', region_id: 'R01', channel: 'LinkedIn Ads', created_date: '2026-06-10', contract_id: '', is_prompt_injection: true }, // injection -> quarantined
      ],
      contracts_signed: [
        { contract_id: 'CT001', region_id: 'R01', channel: 'GitHub Sponsors', signed_count: 2, start_date: '2026-05-15', end_date: '2027-05-14', status: 'active' },
        { contract_id: 'CT002', region_id: 'R02', channel: 'GitHub Sponsors', signed_count: 1, start_date: '2026-06-15', end_date: '2027-06-14', status: 'active' },
      ],
      autoscale_decisions: [
        { decision_id: 'AD001', region_id: 'R01', channel: 'GitHub Sponsors', recommendation: 'increase', delta_usd: 500, accepted: true, decided_by: 'finops_lead' },
        { decision_id: 'AD002', region_id: 'R01', channel: 'LinkedIn Ads', recommendation: 'decrease', delta_usd: -6000, accepted: false, decided_by: 'none' }, // unapproved -> quarantined
      ],
    };

    const report = verifySheafConsistency(SAAS_FINOPS_SCHEMA, saasTables);
    assert.equal(report.quarantinedCountsByStalk.regions, 1); // R03
    assert.equal(report.quarantinedCountsByStalk.campaigns, 1); // C003 void
    assert.equal(report.quarantinedCountsByStalk.trials_weekly, 2); // TR002 dup + TR004 injection
    assert.equal(report.quarantinedCountsByStalk.autoscale_decisions, 1); // AD002 decided_by=none

    const alloc = evaluateGenericAllocationAndLearner(
      SAAS_FINOPS_SCHEMA,
      saasTables,
    );
    // Dead pairs: R01::LinkedIn Ads ($6,000) and R02::Paid Search ($3,000) -> $9,000 total (R03 excluded)
    assert.deepEqual(alloc.deadPairs, [
      ['R01', 'LinkedIn Ads'],
      ['R02', 'Paid Search'],
    ]);
    assert.equal(alloc.totalDeadSpendUsd, 9000);
    // Best channel: GitHub Sponsors ($6,000 across R01+R02 / 3 contracts = $2,000/contract) -> floor(9000 / 2000) = 4
    assert.equal(alloc.bestChannel, 'GitHub Sponsors');
    assert.equal(alloc.bestChannelCpslUsd, 2000);
    assert.equal(alloc.projectedAdditionalOutcomes, 4);
  });
});

describe('Scale Benchmark · 100,000 Relational Rows in < 250ms (O(N) Indexed Hash-Join)', () => {
  it('verifies a 100,000-row relational dataset in < 250ms with O(N) time complexity', () => {
    const properties = Array.from({ length: 100 }, (_, i) => ({
      property_id: `P${String(i + 1).padStart(3, '0')}`,
      name: `Property ${i + 1}`,
      pms: 'Yardi',
      units: i === 99 ? 0 : 200,
      actual_units: i === 99 ? 0 : 200,
      is_operating: i !== 99,
    }));

    const units = Array.from({ length: 20_000 }, (_, i) => ({
      unit_id: `U${String(i + 1).padStart(6, '0')}`,
      property_id: `P${String((i % 99) + 1).padStart(3, '0')}`,
      bedrooms: i % 3,
      market_rent: 2200 + (i % 500),
      status: i % 10 === 0 ? 'vacant' : i % 15 === 0 ? 'notice' : 'occupied',
    }));

    const leases = Array.from({ length: 20_000 }, (_, i) => ({
      lease_id: `L${String(i + 1).padStart(6, '0')}`,
      unit_id: `U${String(i + 1).padStart(6, '0')}`,
      property_id: `P${String((i % 99) + 1).padStart(3, '0')}`,
      source: i % 2 === 0 ? 'Apartments.com' : 'Zillow',
      signed_count: 1,
      start_date: '2026-06-01',
      end_date: '2027-05-31',
      monthly_rent: 2200 + (i % 500),
      concession_usd: 0,
      renewal_status: i % 15 === 0 ? 'notice_given' : 'not_due',
    }));

    const leads = Array.from({ length: 50_000 }, (_, i) => ({
      lead_id: `D${String(i + 1).padStart(6, '0')}`,
      property_id: `P${String((i % 99) + 1).padStart(3, '0')}`,
      created_date: '2026-05-15',
      source: i % 2 === 0 ? 'Apartments.com' : 'Zillow',
      toured: true,
      applied: i < 20_000,
      leased: i < 20_000,
      lease_id: i < 20_000 ? `L${String(i + 1).padStart(6, '0')}` : '',
      is_duplicate_for_lease: false,
      duplicate_of_lead_id: '',
      is_prompt_injection: i === 49_999,
    }));

    const spend = Array.from({ length: 9_800 }, (_, i) => ({
      spend_id: `S${String(i + 1).padStart(6, '0')}`,
      month: '2026-06',
      property_id: `P${String((i % 99) + 1).padStart(3, '0')}`,
      source: i % 3 === 0 ? 'Rent.' : 'Apartments.com',
      raw_amount: 1200,
      currency: 'USD',
      status: i % 50 === 0 ? 'void' : 'posted',
      is_void: i % 50 === 0,
      effective_usd: i % 50 === 0 ? 0 : 1200,
    }));

    const decisions = Array.from({ length: 100 }, (_, i) => ({
      decision_id: `X${String(i + 1).padStart(4, '0')}`,
      month: '2026-06',
      property_id: `P${String((i % 99) + 1).padStart(3, '0')}`,
      source: 'Apartments.com',
      recommendation: 'increase',
      delta_usd: 200,
      accepted: true,
      decided_by: 'asset manager',
    }));

    const synthetic100k: GenericRelationalTables = {
      properties,
      units,
      leases,
      leads,
      spend,
      decisions,
    };

    const report = verifySheafConsistency(FLOW_PORTFOLIO_SCHEMA, synthetic100k);
    assert.equal(report.totalRowsScanned, 100_000);
    assert.ok(
      report.elapsedMs < 250,
      `Expected < 250ms for 100,000 rows, took ${report.elapsedMs}ms`,
    );
    assert.ok(report.throughputRowsPerSec > 400_000);
  });
});

describe('Operadic Consistency (op-consist) & TypeSafe System One Suite (10/10 Pairs)', () => {
  it('achieves 10/10 direct-vs-decomposed agreement (oc_signal = 1.00, ACCEPT)', async () => {
    const summary = await runOperadicConsistencySuite(store);
    assert.equal(summary.totalPairs, 10);
    assert.equal(summary.agreedPairs, 10);
    assert.equal(summary.ocSignal, 1.0);
    assert.equal(summary.verdict, 'ACCEPT');
    assert.equal(summary.failingEdges.length, 0);
  });
});
