/**
 * Declarative Cellular Sheaf Schema Graph G = (V, E) for Multi-Table
 * Operational Reconciliation & Capital Allocation Systems.
 *
 * Uses ONLY the real FLOW repository tables (`properties`, `units`, `leases`,
 * `leads`, `spend`, `decisions`) and generalizes to arbitrary operational
 * funnels such as B2B SaaS / Cloud FinOps (`SAAS_FINOPS_SCHEMA`).
 */

export type QuarantineKind =
  | 'unlaunched_entity'
  | 'void_or_cancelled'
  | 'duplicate_foreign_claim'
  | 'untrusted_note_injection'
  | 'unapproved_destructive_action';

export type RestrictionKind =
  | 'referential_support'
  | 'conservation_law'
  | 'temporal_monotonicity'
  | 'state_duration_consistency';

export interface QuarantineRuleSpec {
  readonly id: string;
  readonly kind: QuarantineKind;
  readonly description: string;
  readonly check: (
    row: Readonly<Record<string, unknown>>,
    ctx: { readonly asOfDate: string; readonly seenKeys: Set<string> },
  ) => { readonly quarantined: boolean; readonly reason?: string };
}

export interface StalkSpec {
  readonly name: string;
  readonly primaryKey: string;
  readonly quarantineRules: readonly QuarantineRuleSpec[];
}

export interface RestrictionMapSpec {
  readonly id: string;
  readonly kind: RestrictionKind;
  readonly sourceStalk: string;
  readonly targetStalk: string;
  readonly foreignKey: string;
  readonly tolerance: number;
  readonly description: string;
  readonly params: Readonly<Record<string, string | number>>;
}

export interface AllocationFunctorSpec {
  readonly entityStalk: string;
  readonly entityPk: string;
  readonly spendStalk: string;
  readonly spendEntityFk: string;
  readonly spendChannelField: string;
  readonly spendAmountField: string;
  readonly outcomeStalk: string;
  readonly outcomeEntityFk: string;
  readonly outcomeChannelField: string;
  readonly outcomeCountField: string;
  readonly decisionStalk: string;
  readonly decisionPk: string;
  readonly decisionEntityFk: string;
  readonly decisionChannelField: string;
  readonly decisionDirectionField: string;
  readonly decisionDeltaField: string;
  readonly decisionAcceptedField: string;
  readonly priorAlpha0: number;
  readonly priorBeta0: number;
}

export interface RelationalSheafSchema {
  readonly schemaId: string;
  readonly domainName: string;
  readonly asOfDate: string;
  readonly stalks: readonly StalkSpec[];
  readonly restrictions: readonly RestrictionMapSpec[];
  readonly allocation: AllocationFunctorSpec;
}

export const FLOW_PORTFOLIO_SCHEMA: RelationalSheafSchema = {
  schemaId: 'flow_multifamily_v2',
  domainName: 'FLOW Multifamily Portfolio (data/{pms,crm,ils,ops}/*.csv — 3,858 rows)',
  asOfDate: '2026-10-01',
  stalks: [
    {
      name: 'properties',
      primaryKey: 'property_id',
      quarantineRules: [
        {
          id: 'Q_NON_OPERATING_P09',
          kind: 'unlaunched_entity',
          description:
            'Quarantine properties with 0 units in units.csv or unsupported PMS adapter (properties:P09 Cornell Annex, AppFolio, 0 units)',
          check: (row) => {
            const actualUnits = Number(row.actual_units ?? row.units ?? 0);
            const isOperating = row.is_operating !== false && actualUnits > 0;
            if (!isOperating) {
              return {
                quarantined: true,
                reason: `Non-operating onboarding property ${String(row.property_id)} (actual_units=${actualUnits}, pms=${String(row.pms ?? '')}) excluded from operating denominators`,
              };
            }
            return { quarantined: false };
          },
        },
      ],
    },
    {
      name: 'units',
      primaryKey: 'unit_id',
      quarantineRules: [],
    },
    {
      name: 'leases',
      primaryKey: 'lease_id',
      quarantineRules: [],
    },
    {
      name: 'leads',
      primaryKey: 'lead_id',
      quarantineRules: [
        {
          id: 'Q_DUPLICATE_PHONE_REENTRY_LEADS',
          kind: 'duplicate_foreign_claim',
          description:
            'Quarantine 9 duplicate phone-reentry leads (D01490..D01498) pointing to an already-credited lease_id (D00224..D01454)',
          check: (row, ctx) => {
            const leaseId = String(row.lease_id ?? '').trim();
            if (row.is_duplicate_for_lease === true) {
              return {
                quarantined: true,
                reason: `Duplicate phone-reentry lead ${String(row.lead_id)} for lease ${leaseId} (credited to earliest lead ${String(row.duplicate_of_lead_id ?? '')})`,
              };
            }
            if (leaseId) {
              if (ctx.seenKeys.has(leaseId)) {
                return {
                  quarantined: true,
                  reason: `Duplicate lead ${String(row.lead_id)} claiming lease ${leaseId}`,
                };
              }
              ctx.seenKeys.add(leaseId);
            }
            return { quarantined: false };
          },
        },
        {
          id: 'Q_PROMPT_INJECTION_NOTE',
          kind: 'untrusted_note_injection',
          description:
            'Quarantine untrusted CRM free-text notes containing prompt-injection watermarks (leads:D01011 on P06 Facebook Ads)',
          check: (row) =>
            row.is_prompt_injection === true
              ? {
                  quarantined: true,
                  reason: `Untrusted CRM note prompt-injection attempt on ${String(row.lead_id)} (${String(row.property_id)} ${String(row.source)})`,
                }
              : { quarantined: false },
        },
      ],
    },
    {
      name: 'spend',
      primaryKey: 'spend_id',
      quarantineRules: [
        {
          id: 'Q_VOID_SPEND_INVOICES',
          kind: 'void_or_cancelled',
          description:
            'Quarantine 10 voided invoice rows (S0003, S0054, S0062, S0073, S0105, S0110, S0119, S0140, S0149, S0174) so effective_usd = 0',
          check: (row) =>
            String(row.status ?? '').toLowerCase() === 'void' || row.is_void === true
              ? {
                  quarantined: true,
                  reason: `Voided spend invoice ${String(row.spend_id)} (status=void, raw_amount=${String(row.raw_amount ?? row.amount ?? 0)})`,
                }
              : { quarantined: false },
        },
      ],
    },
    {
      name: 'decisions',
      primaryKey: 'decision_id',
      quarantineRules: [
        {
          id: 'Q_UNAPPROVED_DESTRUCTIVE_DECISION',
          kind: 'unapproved_destructive_action',
          description:
            'Block destructive budget cuts lacking human approval (approved_by=none or decided_by=none)',
          check: (row) => {
            const decidedBy = String(row.decided_by ?? row.approved_by ?? '').toLowerCase();
            if (decidedBy === 'none' || row.unapproved_destructive === true) {
              return {
                quarantined: true,
                reason: `Unapproved destructive decision ${String(row.decision_id)} blocked at human gate`,
              };
            }
            return { quarantined: false };
          },
        },
      ],
    },
  ],
  restrictions: [
    {
      id: 'E1_PROPERTIES_TO_UNITS_SUPPORT',
      kind: 'referential_support',
      sourceStalk: 'units',
      targetStalk: 'properties',
      foreignKey: 'property_id',
      tolerance: 0,
      description:
        'Operating properties must have declaredUnits == COUNT(units) >= 1 and supported PMS adapter (quarantines P09)',
      params: {},
    },
    {
      id: 'E2_UNITS_TO_LEASES_STATE_CONSISTENCY',
      kind: 'state_duration_consistency',
      sourceStalk: 'leases',
      targetStalk: 'units',
      foreignKey: 'unit_id',
      tolerance: 0,
      description:
        'Occupied/notice units have exactly 1 active lease, vacant units have 0, and unit.status=notice <-> lease.renewal_status=notice_given',
      params: { statusField: 'renewal_status', startField: 'start_date', endField: 'end_date' },
    },
    {
      id: 'E3_UNITS_TO_LEASES_RENT_CONSERVATION',
      kind: 'conservation_law',
      sourceStalk: 'leases',
      targetStalk: 'units',
      foreignKey: 'unit_id',
      tolerance: 0,
      description:
        'Notice units market_rent vs contract monthly_rent fiber gap ($1,955/mo across portfolio; $370/mo at P06 on T12)',
      params: { amountField: 'monthly_rent', baselineField: 'market_rent' },
    },
    {
      id: 'E4_LEADS_TO_LEASES_TEMPORAL_PULLBACK',
      kind: 'temporal_monotonicity',
      sourceStalk: 'leads',
      targetStalk: 'leases',
      foreignKey: 'lease_id',
      tolerance: 0,
      description:
        'CRM lead -> PMS lease pullback: created_date <= start_date, funnel monotonicity (leased => applied => toured), and 20 cross-month Q2->Q3 boundary shifts',
      params: { earlierField: 'created_date', laterField: 'start_date' },
    },
  ],
  allocation: {
    entityStalk: 'properties',
    entityPk: 'property_id',
    spendStalk: 'spend',
    spendEntityFk: 'property_id',
    spendChannelField: 'source',
    spendAmountField: 'effective_usd',
    outcomeStalk: 'leases',
    outcomeEntityFk: 'property_id',
    outcomeChannelField: 'source',
    outcomeCountField: 'signed_count',
    decisionStalk: 'decisions',
    decisionPk: 'decision_id',
    decisionEntityFk: 'property_id',
    decisionChannelField: 'source',
    decisionDirectionField: 'recommendation',
    decisionDeltaField: 'delta_usd',
    decisionAcceptedField: 'accepted',
    priorAlpha0: 1.0,
    priorBeta0: 3250.0,
  },
};

export const SAAS_FINOPS_SCHEMA: RelationalSheafSchema = {
  schemaId: 'saas_finops_v1',
  domainName: 'B2B SaaS / Cloud FinOps Acquisition & Autoscale Funnel',
  asOfDate: '2026-10-01',
  stalks: [
    {
      name: 'regions',
      primaryKey: 'region_id',
      quarantineRules: [
        {
          id: 'Q_UNLAUNCHED_REGION',
          kind: 'unlaunched_entity',
          description: 'Quarantine unlaunched cloud regions (active_clusters = 0)',
          check: (row) =>
            Number(row.active_clusters ?? 0) <= 0
              ? {
                  quarantined: true,
                  reason: `Unlaunched region ${String(row.region_id)} (active_clusters=0)`,
                }
              : { quarantined: false },
        },
      ],
    },
    {
      name: 'campaigns',
      primaryKey: 'campaign_id',
      quarantineRules: [
        {
          id: 'Q_VOID_CAMPAIGN',
          kind: 'void_or_cancelled',
          description: 'Quarantine voided cloud ad invoices',
          check: (row) =>
            String(row.status ?? '').toLowerCase() === 'void'
              ? {
                  quarantined: true,
                  reason: `Voided campaign invoice ${String(row.campaign_id)}`,
                }
              : { quarantined: false },
        },
      ],
    },
    {
      name: 'trials_weekly',
      primaryKey: 'trial_id',
      quarantineRules: [
        {
          id: 'Q_DUPLICATE_TRIAL_CLAIM',
          kind: 'duplicate_foreign_claim',
          description: 'Quarantine duplicate trial records pointing to the same contract_id',
          check: (row, ctx) => {
            const cid = String(row.contract_id ?? '').trim();
            if (cid) {
              if (ctx.seenKeys.has(cid)) {
                return {
                  quarantined: true,
                  reason: `Duplicate trial ${String(row.trial_id)} claiming contract ${cid}`,
                };
              }
              ctx.seenKeys.add(cid);
            }
            return { quarantined: false };
          },
        },
        {
          id: 'Q_TRIAL_PROMPT_INJECTION',
          kind: 'untrusted_note_injection',
          description: 'Quarantine CRM trial notes containing prompt injection',
          check: (row) =>
            row.is_prompt_injection === true
              ? {
                  quarantined: true,
                  reason: `Prompt injection in trial note ${String(row.trial_id)}`,
                }
              : { quarantined: false },
        },
      ],
    },
    {
      name: 'contracts_signed',
      primaryKey: 'contract_id',
      quarantineRules: [],
    },
    {
      name: 'autoscale_decisions',
      primaryKey: 'decision_id',
      quarantineRules: [
        {
          id: 'Q_UNAPPROVED_AUTOSCALE',
          kind: 'unapproved_destructive_action',
          description: 'Quarantine unapproved destructive autoscale budget cuts',
          check: (row) =>
            String(row.decided_by ?? row.approved_by ?? '').toLowerCase() === 'none'
              ? {
                  quarantined: true,
                  reason: `Unapproved destructive autoscale decision ${String(row.decision_id)}`,
                }
              : { quarantined: false },
        },
      ],
    },
  ],
  restrictions: [
    {
      id: 'R1_SAAS_REFERENTIAL_SUPPORT',
      kind: 'referential_support',
      sourceStalk: 'trials_weekly',
      targetStalk: 'regions',
      foreignKey: 'region_id',
      tolerance: 0,
      description: 'Trials must reference an active launched cloud region',
      params: {},
    },
    {
      id: 'R2_SAAS_CONSERVATION_SPEND',
      kind: 'conservation_law',
      sourceStalk: 'campaigns',
      targetStalk: 'regions',
      foreignKey: 'region_id',
      tolerance: 0,
      description: 'Campaign spend conserves FX-normalized non-void USD totals',
      params: { amountField: 'effective_usd', baselineField: 'raw_amount' },
    },
    {
      id: 'R3_SAAS_TEMPORAL_MONOTONICITY',
      kind: 'temporal_monotonicity',
      sourceStalk: 'trials_weekly',
      targetStalk: 'contracts_signed',
      foreignKey: 'contract_id',
      tolerance: 0,
      description: 'Trial created_date must be <= contract start_date',
      params: { earlierField: 'created_date', laterField: 'start_date' },
    },
    {
      id: 'R4_SAAS_STATE_DURATION',
      kind: 'state_duration_consistency',
      sourceStalk: 'contracts_signed',
      targetStalk: 'regions',
      foreignKey: 'region_id',
      tolerance: 0,
      description: 'Active contracts must have start_date <= end_date',
      params: { statusField: 'status', startField: 'start_date', endField: 'end_date' },
    },
  ],
  allocation: {
    entityStalk: 'regions',
    entityPk: 'region_id',
    spendStalk: 'campaigns',
    spendEntityFk: 'region_id',
    spendChannelField: 'channel',
    spendAmountField: 'effective_usd',
    outcomeStalk: 'contracts_signed',
    outcomeEntityFk: 'region_id',
    outcomeChannelField: 'channel',
    outcomeCountField: 'signed_count',
    decisionStalk: 'autoscale_decisions',
    decisionPk: 'decision_id',
    decisionEntityFk: 'region_id',
    decisionChannelField: 'channel',
    decisionDirectionField: 'recommendation',
    decisionDeltaField: 'delta_usd',
    decisionAcceptedField: 'accepted',
    priorAlpha0: 1.0,
    priorBeta0: 2500.0,
  },
};
