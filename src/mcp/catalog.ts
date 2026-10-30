/**
 * What the MCP server tells an agent: server identity and instructions,
 * the tool list with selection-tuned descriptions, argument examples and
 * closed input schemas, and the `flowiq_about` context card. The tool
 * logic lives in `src/agent/tools.ts`; this file only decides how the
 * tools are presented, after the Printing Press MCP conventions.
 */
import { buildFlowIqToolDefinitions } from '../agent/tools.ts';
import { resolvePolicyConfig } from '../config/rules.ts';
import type { PortfolioStore } from '../data/schema.ts';
import { plainWordmark } from '../cli/wordmark.ts';
import { FLOWIQ_VERSION } from '../version.ts';

export const MCP_SERVER_INFO = {
  name: 'flow-intelligence-mcp',
  title: 'FlowIQ by Ormus',
  version: FLOWIQ_VERSION,
} as const;

export const SERVER_INSTRUCTIONS = [
  'FlowIQ answers questions about one Chicago apartment portfolio from six CSV exports: eight operating buildings (P01-P08) and P09 on onboarding hold. Every tool is read-only and deterministic.',
  'For any question, call ask_flowiq with the user\'s words and relay its first text block as written, including the source rows line. Branch on structuredContent.status: answered, unknown ("I don\'t know" is a correct answer), refused (Fair Housing), or needs_clarification (ask the user which building).',
  'Use the query_* tools only when you need structured numbers to compute with. Call flowiq_about once if you need the coverage, the date range, the row ID format, or the what-if defaults.',
].join(' ');

/**
 * The four business assumptions a user may change for one question. Data
 * rules and guards (void invoices, dedup, P09 hold, Fair Housing, unknown)
 * cannot be switched off from outside.
 */
export const ASSUMPTIONS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  description:
    'Optional what-if for this question only. Use when the user says "what if" or changes an assumption; leave out otherwise.',
  properties: {
    cadToUsdRate: { type: 'number', minimum: 0.5, maximum: 1.5, description: 'USD per Canadian dollar for CAD invoices (default 0.73).' },
    occupiedIncludesNotice: { type: 'boolean', description: 'Count units on notice as occupied (default true).' },
    leaseBucketBy: { type: 'string', enum: ['lease_start_date', 'lead_created_date'], description: 'Which date puts a signed lease in a period (default lease_start_date).' },
    priorSpendUsdBeta0: { type: 'number', minimum: 500, maximum: 20000, description: 'Portfolio prior cost per signed lease used to shrink small samples (default 3250).' },
  },
} as const;

export const ASK_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    question: {
      type: 'string',
      minLength: 1,
      description:
        'The question in plain English, as the user asked it, e.g. "Which source cost us the least per signed lease at Kedzie Works this summer?"',
    },
    assumptions: ASSUMPTIONS_SCHEMA,
  },
  required: ['question'],
  examples: [
    { question: 'What is the vacancy rate at Kedzie Works?' },
    { question: 'How much did we spend on paid sources that signed no leases from April to September 2026?' },
    {
      question: 'How much did we spend on paid sources that signed no leases from April to September 2026?',
      assumptions: { cadToUsdRate: 0.8 },
    },
  ],
} as const;

export const ASK_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['answered', 'unknown', 'refused', 'needs_clarification'] },
    assumptions: { type: 'object' },
    answer: { type: 'string' },
    result: { type: 'object' },
    citations: { type: 'array', items: { type: 'string' } },
    clarificationNeeded: { type: 'boolean' },
    toolCalls: { type: 'array', items: { type: 'object' } },
  },
  required: ['status', 'answer', 'result', 'citations'],
} as const;

const ASK_DESCRIPTION =
  'Use this first for any question about the apartment portfolio, in plain English: occupancy, vacancies, rent, renewals, rent at risk, concessions, marketing spend, cost per signed lease, dead spend, or past budget decisions. ' +
  'Returns a short answer and the source rows it used (for example leases:L00105). ' +
  'It says "I don\'t know" when the exports cannot answer, asks which building when a name is ambiguous, and refuses requests that would screen or target people by a protected class under the Fair Housing Act. ' +
  'Pass the user\'s question through as written.';

const ABOUT_DESCRIPTION =
  'Context card for this server: what the portfolio covers (buildings, tables, date range), what it cannot answer, how source row IDs read, the what-if assumptions and their defaults, and which tool to use when. No arguments. Call it once when unsure; not needed before ask_flowiq.';

/** Selection-tuned titles, descriptions and examples, keyed by tool name. */
const PRESENTATION: Record<string, { title: string; description: string; examples: readonly Record<string, unknown>[] }> = {
  find_properties: {
    title: 'Find buildings',
    description:
      'Resolve a loosely named building ("the lakefront one", "Kedzie") to its property ID, or list buildings by neighborhood, class, PMS, year built or amenity. With resolutionMode single_building it returns status ambiguous_match and a question when more than one building fits. Use it to get IDs for the query_* tools.',
    examples: [
      { queryText: 'Kedzie Works', resolutionMode: 'single_building' },
      { neighborhood: 'Logan Square' },
    ],
  },
  query_units_and_occupancy: {
    title: 'Units and occupancy',
    description:
      'Structured unit data: unit counts, occupied share (units on notice count as occupied), vacancy rate, asking rent, square feet and rent per square foot, filtered by building, class, bedrooms, bathrooms, floor, view or status. Use when you need numbers to compute with; for a plain answer use ask_flowiq.',
    examples: [{ propertyIds: ['P06'] }, { bedrooms: 2, status: 'vacant' }],
  },
  query_leases_and_renewals: {
    title: 'Leases and renewals',
    description:
      'Structured lease data: lease counts, renewal rate, monthly rent at risk and average concession (zeros included), filtered by building, PMS, class, unit attributes, lease type, start or end date range, or renewal status.',
    examples: [
      { propertyIds: ['P02'], endDateFrom: '2026-10-01', endDateTo: '2026-12-31' },
      { renewalStatus: 'notice_given' },
    ],
  },
  query_marketing_spend_and_funnel: {
    title: 'Marketing spend and funnel',
    description:
      'Structured marketing data by source: spend (CAD converted, void invoices at $0), deduplicated leads, tours, signed leases, and cost per lead, tour and signed lease, plus dead-spend pairs and reallocation math. A source with spend and no signed leases has a null cost per lease, never $0.',
    examples: [
      { propertyIds: ['P06'], startDate: '2026-04-01', endDate: '2026-09-30', paidOnly: true },
      { period: 'Q3 2026', sources: ['Google Ads'] },
    ],
  },
  evaluate_budget_decisions: {
    title: 'Budget decision review',
    description:
      'How past budget decisions in decisions.csv turned out: before and after outcomes, small samples shrunk toward the portfolio average, regret, and the next recommendation. Filter by building, decision ID, accepted, direction, source or month.',
    examples: [{ decisionIds: ['X009'] }, { propertyId: 'P06', accepted: 'yes' }],
  },
  audit_sheaf_consistency: {
    title: 'Cross-table consistency',
    description:
      'Data quality across the six exports: which rows were held out or did not reconcile between properties, units, leases, leads, spend and decisions, with the row IDs. Use to explain why a number looks off.',
    examples: [{}],
  },
};

export interface McpToolListing {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
  readonly annotations: Readonly<Record<string, boolean>>;
}

/** The tools in the order an agent should consider them. */
export function listMcpTools(
  store: PortfolioStore,
  annotations: Readonly<Record<string, boolean>>,
): McpToolListing[] {
  const engineTools = buildFlowIqToolDefinitions(store).map((t) => {
    const p = PRESENTATION[t.name];
    return {
      name: t.name,
      title: p?.title ?? t.name,
      description: p?.description ?? t.description,
      inputSchema: {
        ...(t.inputSchema as Record<string, unknown>),
        additionalProperties: false,
        ...(p ? { examples: p.examples } : {}),
      },
      annotations,
    };
  });
  return [
    {
      name: 'ask_flowiq',
      title: 'Ask FlowIQ',
      description: ASK_DESCRIPTION,
      inputSchema: ASK_INPUT_SCHEMA as unknown as Record<string, unknown>,
      outputSchema: ASK_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
      annotations,
    },
    ...engineTools,
    {
      name: 'flowiq_about',
      title: 'About FlowIQ',
      description: ABOUT_DESCRIPTION,
      inputSchema: { type: 'object', additionalProperties: false, properties: {}, examples: [{}] },
      annotations,
    },
  ];
}

/** Tool names in listing order, for agent-context and docs. */
export const MCP_TOOL_NAMES = [
  'ask_flowiq',
  'find_properties',
  'query_units_and_occupancy',
  'query_leases_and_renewals',
  'query_marketing_spend_and_funnel',
  'evaluate_budget_decisions',
  'audit_sheaf_consistency',
  'flowiq_about',
] as const;

export interface AboutCard {
  readonly schema_version: 1;
  readonly server: typeof MCP_SERVER_INFO;
  readonly portfolio: {
    readonly operatingBuildings: ReadonlyArray<{ id: string; name: string; neighborhood: string; units: number }>;
    readonly onboardingHold: ReadonlyArray<{ id: string; name: string; note: string }>;
    readonly asOfDate: string;
    readonly tables: readonly string[];
    readonly rowsIndexed: number;
  };
  readonly sourceRowIds: string;
  readonly cannotAnswer: readonly string[];
  readonly guards: readonly string[];
  readonly assumptions: { readonly note: string; readonly defaults: Readonly<Record<string, unknown>> };
  readonly playbook: ReadonlyArray<{ when: string; use: string }>;
  readonly statuses: Readonly<Record<string, string>>;
}

/** The context card as data: the Printing Press "context" tool, for FlowIQ. */
export function aboutFlowIq(store: PortfolioStore): AboutCard {
  const defaults = resolvePolicyConfig();
  return {
    schema_version: 1,
    server: MCP_SERVER_INFO,
    portfolio: {
      operatingBuildings: store.operatingProperties.map((p) => ({
        id: p.propertyId,
        name: p.name,
        neighborhood: p.neighborhood,
        units: p.actualUnitCount,
      })),
      onboardingHold: store.onboardingProperties.map((p) => ({
        id: p.propertyId,
        name: p.name,
        note: 'no units in the exports yet; left out of every portfolio number',
      })),
      asOfDate: store.policy.asOfDate,
      tables: ['properties', 'units', 'leases', 'leads', 'spend', 'decisions'],
      rowsIndexed: store.primaryKeyIndex.size,
    },
    sourceRowIds:
      'A citation is table:primary_key, for example properties:P06, units:U0141, leases:L00105, leads:D00931, spend:S0125, decisions:X009. Every cited row exists in the exports.',
    cannotAnswer: [
      'operating expenses, payroll, utilities, landscaping or any other general-ledger line',
      'anything about a specific resident or applicant as a person',
      'dates after the as-of date, or forecasts the exports do not support',
    ],
    guards: [
      'void invoices count as $0; CAD invoices convert at the CAD rate',
      'duplicate phone leads are deduplicated to the earliest lead',
      'free-text CRM notes are untrusted and never change a number',
      'requests to screen, steer or advertise by a protected class are refused (Fair Housing Act)',
    ],
    assumptions: {
      note: 'ask_flowiq accepts these as a what-if for one question; nothing is saved.',
      defaults: {
        cadToUsdRate: defaults.cadToUsdRate,
        occupiedIncludesNotice: defaults.occupiedIncludesNotice,
        leaseBucketBy: defaults.leaseBucketBy,
        priorSpendUsdBeta0: defaults.priorSpendUsdBeta0,
      },
    },
    playbook: [
      { when: 'any question in plain English', use: 'ask_flowiq' },
      { when: 'a building named loosely, or IDs needed', use: 'find_properties' },
      { when: 'unit counts, occupancy, vacancy, asking rent', use: 'query_units_and_occupancy' },
      { when: 'leases ending, renewal rate, rent at risk', use: 'query_leases_and_renewals' },
      { when: 'spend, leads, tours, cost per lease, dead spend', use: 'query_marketing_spend_and_funnel' },
      { when: 'how past budget decisions turned out', use: 'evaluate_budget_decisions' },
      { when: 'why a number might look off', use: 'audit_sheaf_consistency' },
    ],
    statuses: {
      answered: 'relay the answer and its source rows',
      unknown: 'the exports do not hold this; say so, do not estimate',
      refused: 'relay the refusal; do not rephrase the request to get around it',
      needs_clarification: 'ask the user the question in the answer',
    },
  };
}

/**
 * The context card as text: the wordmark in a code block, then short
 * lines. Sent only by flowiq_about and flowiq://about, never inside an
 * answer, so the art never lands in a reply the user asked for.
 */
export function aboutFlowIqText(store: PortfolioStore): string {
  const a = aboutFlowIq(store);
  const p = a.portfolio;
  const units = p.operatingBuildings.reduce((n, b) => n + b.units, 0);
  return [
    '```text',
    plainWordmark(FLOWIQ_VERSION),
    '```',
    '',
    `Portfolio: ${p.operatingBuildings.length} operating buildings, ${units.toLocaleString('en-US')} units (${p.operatingBuildings.map((b) => `${b.id} ${b.name}`).join(', ')}). On hold and not counted: ${p.onboardingHold.map((b) => `${b.id} ${b.name}`).join(', ')}.`,
    `Data: six CSV exports (${p.tables.join(', ')}), ${p.rowsIndexed.toLocaleString('en-US')} rows, as of ${p.asOfDate}.`,
    `Source rows: ${a.sourceRowIds}`,
    `Cannot answer: ${a.cannotAnswer.join('; ')}.`,
    `What-if defaults: ${Object.entries(a.assumptions.defaults).map(([k, v]) => `${k} ${String(v)}`).join(', ')}.`,
    '',
    'Which tool:',
    ...a.playbook.map((s) => `- ${s.when}: ${s.use}`),
  ].join('\n');
}
