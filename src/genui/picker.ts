import { askFlowIqCopilot, type CopilotTurnResult } from '../agent/copilot.ts';
import { parseQueryIntent, type ParsedQueryIntent } from '../agent/intent.ts';
import { executeCompositionalPlan } from '../agent/planner.ts';
import type { FairHousingSession } from '../domain/fair-housing.ts';
import { hashOf } from '../agent/envelope.ts';
import { verifyAnswerEnvelope } from '../domain/guards.ts';
import type { AnswerEnvelope, PortfolioStore } from '../data/schema.ts';
import type { ParseConfig } from '../agent/model-parse.ts';
import { specErrors, type ChartSpec, type Evidence, type EvidenceItem, type Num, type PanelState, type Unit } from './spec.ts';

/**
 * Deterministic intent-to-insight picker (rule table: docs/genui-rules.md).
 * Input: the S2 turn (typed query + verified envelope). Output: one ChartSpec
 * whose every number traces to a verified result. No model touches this step.
 * Breakdowns (per building, per source, per month) are extra typed queries,
 * each executed by the planner and kept only if its envelope verifies.
 */
const UNIT_OF: Record<string, Unit> = { usd: '$', percent: '%', count: 'count', sqft: 'sqft', leases: 'leases' };
const KEY_ORDER = ['usd', 'percent', 'count', 'sqft', 'leases'];
const primaryKey = (r: Readonly<Record<string, unknown>>) => KEY_ORDER.find((k) => typeof r[k] === 'number');

/** The insight each measure family shows, named for the reader. */
export const INSIGHT: Record<string, string> = {
  unit_count: 'Inventory: how many units match', vacancy_rate: 'Vacancy pressure', occupied_share: 'Occupancy health',
  avg_market_rent: 'Pricing position', avg_sqft: 'Unit mix size', rent_per_sqft: 'Price per square foot',
  avg_market_rent_and_sqft: 'Pricing vs size', lease_count: 'Leasing velocity', renewal_rate: 'Retention',
  ending_and_renewed: 'Renewal pipeline', average_concession: 'Concession cost', rent_at_risk: 'Revenue at risk',
  new_vs_renewal_and_concession: 'New vs renewal mix', renewal_rate_class_comparison: 'Retention by class',
  lead_count: 'Demand volume', spend_total: 'Marketing spend', spend_h1_vs_q3: 'Spend change between periods',
  cost_per_lead: 'Channel efficiency', cost_per_tour: 'Channel efficiency', cost_per_lead_and_tour: 'Channel efficiency',
  cost_per_signed_lease: 'Channel return (cost per lease)', signed_leases_ranking: 'Lease production',
  tour_to_lease_rate: 'Funnel conversion', apply_rate: 'Funnel conversion', applied_without_tour: 'Funnel leakage',
  applied_and_leased: 'Funnel conversion', dead_spend_pairs: 'Where we are losing money', dead_spend_building: 'Where we are losing money',
  reallocation_leases: 'What should I change: budget move', decision_lookup: 'Decision record',
  decision_cohort_rejected: 'Decision outcomes', decision_post_spend_comparison: 'Decision impact', decision_outcome_learning: 'Decision learning',
  void_and_duplicate_counts: 'Data quality', unsupported: 'Outside the data',
};

export interface PickInput { readonly question: string; readonly turn: CopilotTurnResult; readonly store: PortfolioStore }
export interface Panel { readonly question: string; readonly spec: ChartSpec; readonly evidence: Evidence; readonly errors: readonly string[]; readonly parsePath?: string; readonly parseFallbackReason?: string | null }

const intentOf = (t: CopilotTurnResult) => (t.envelope.query?.intent ?? null) as ParsedQueryIntent | null;
const TREND = /\b(by month|per month|each month|month by month|over time|trend|trending|month over month|monthly (trend|breakdown))\b/i;
const DELTA = /\b(compared? (to|with)|vs\.?|versus|than) (the )?(prior|previous|last)\b|\b(prior|previous) period\b/i;
const RANK = /\b(top \d+|top (three|five|ten)|rank|ranked|ranking|leaderboard|table)\b/i;
const HEAT = /\bby (building|property) and (source|channel)\b|\bby (source|channel) and (building|property)\b/i;
const SCATTER = /\b(rent|price)\b.*\b(vs\.?|versus|against)\b.*\b(size|sq ?ft|square (feet|footage))\b/i;
const CHANGE = /\b(what should (i|we) change|where are we losing money|what should (i|we) do|recommend)/i;

/**
 * Presentation cues ("by month", "compared to the prior period", "by building
 * and source", "rent vs size", "where are we losing money?") pick the view, not
 * the numbers. They are cut from the text before the S2 parse so the closed
 * vocabulary sees only the data question; the picker reads them from the
 * original text. Cutting a cue never changes which rows the query reads.
 */
const CUT: readonly RegExp[] = [
  /\s*\b(compared? (to|with)|versus|vs\.?) (the )?(prior|previous|last) (period|quarter|month|window)\b/gi,
  /\s*\b(broken out |split )?by (building|property) and (source|channel)\b/gi,
  /\s*\b(broken out |split )?by (source|channel) and (building|property)\b/gi,
  /\s*\b(as a )?(trend|month by month|by month|per month|each month|over time|monthly trend|monthly breakdown)\b/gi,
  /^\s*(what should (i|we) change|where are we losing money|what should (i|we) do)\s*[?.:,]?\s*/i,
  /^\s*(show( me)?|chart|plot)\s+/i,
  /\s*\b(vs\.?|versus|against) (unit )?(size|sq ?ft|square (feet|footage))( by (building|property))?/gi,
  /,?\s*\b(as a )?(ranked( table)?|ranking|leaderboard)\b/gi,
];
export function coreQuestion(q: string): string {
  let s = q;
  for (const re of CUT) s = s.replace(re, '');
  s = s.replace(/\s+([?.,])/g, '$1').replace(/\s{2,}/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : q;
}

function itemFrom(key: string, label: string, env: AnswerEnvelope, question: string, intent: ParsedQueryIntent): EvidenceItem {
  return { key, label, template_id: env.proof?.template_id ?? 'guard', result: env.result, result_hash: hashOf(env.result), citations: env.citations, recipe: { question, intent } };
}
const num = (it: EvidenceItem, k: string): Num => ({ v: it.result[k] as number, ref: `items.${it.key}.result.${k}` });

/** Runs one extra typed query and keeps it only if it answers and verifies. */
function sub(store: PortfolioStore, question: string, intent: ParsedQueryIntent, key: string, label: string): EvidenceItem | null {
  const out = executeCompositionalPlan({ id: key, type: 'adhoc', question } as never, store, { intent });
  const env = out.envelope;
  if (out.clarificationNeeded || (env.result as Record<string, unknown>).unknown || !env.proof) return null;
  if (!verifyAnswerEnvelope(env, store).valid) return null;
  return itemFrom(key, label, env, question, intent);
}

function byBuilding(store: PortfolioStore, q: string, intent: ParsedQueryIntent, k: string): EvidenceItem[] {
  const it = { ...intent, aggregation: 'value', isWholePortfolioExplicit: false, isClassComparison: false } as ParsedQueryIntent;
  return store.operatingProperties.map((p) => sub(store, `${q} (scope: ${p.name})`, it, p.propertyId, p.name))
    .filter((x): x is EvidenceItem => !!x && (k === '' || typeof x.result[k] === 'number'));
}
function bySource(store: PortfolioStore, q: string, intent: ParsedQueryIntent, k: string): EvidenceItem[] {
  const srcs = intent.paidOnly || /\bpaid\b/i.test(q) ? store.paidSources : [...store.paidSources, ...store.organicSources];
  const it = (s: string) => ({ ...intent, aggregation: 'value', mentionedSources: [s] }) as ParsedQueryIntent;
  return [...new Set(srcs as readonly string[])].map((s) => sub(store, q, it(s), `src_${s.replace(/\W/g, '')}`, s))
    .filter((x): x is EvidenceItem => !!x && typeof x.result[k] === 'number');
}
function monthWin(m: string) {
  const [y, mo] = m.split('-').map(Number);
  const end = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const label = new Date(Date.UTC(y, mo - 1, 1)).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  return { key: `M_${m}`, label, startDate: `${m}-01`, endDate: `${m}-${String(end).padStart(2, '0')}`, months: [m] };
}
function shiftMonths(months: readonly string[]): string[] {
  const n = months.length; const [y, mo] = months[0].split('-').map(Number);
  return Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(y, mo - 1 - n + i, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; });
}

/** Which way is good, per measure (design: no red/green; the renderer says favorable/unfavorable). */
export const GOOD_DIRECTION: Record<string, 'up' | 'down'> = {
  vacancy_rate: 'down', unit_count: 'down', occupied_share: 'up', avg_market_rent: 'up', rent_per_sqft: 'up', avg_sqft: 'up',
  lease_count: 'up', renewal_rate: 'up', ending_and_renewed: 'up', average_concession: 'down', rent_at_risk: 'down',
  lead_count: 'up', spend_total: 'down', spend_h1_vs_q3: 'down', cost_per_lead: 'down', cost_per_tour: 'down', cost_per_lead_and_tour: 'down',
  cost_per_signed_lease: 'down', signed_leases_ranking: 'up', tour_to_lease_rate: 'up', apply_rate: 'up', applied_and_leased: 'up',
  dead_spend_pairs: 'down', dead_spend_building: 'down', reallocation_leases: 'up', void_and_duplicate_counts: 'down',
};

const clarify = (mode: 'clarify' | 'unknown' | 'refuse', t: CopilotTurnResult, intent: string, asked: string, state: PanelState = 'ready'): ChartSpec => ({
  template: 'clarify_card', state, intent, source: 'guard', insight: mode === 'refuse' ? 'Fair-housing guard' : mode === 'clarify' ? 'Needs a choice before charting' : 'Outside the data',
  title: mode === 'refuse' ? 'FlowIQ will not do this' : mode === 'clarify' ? 'Which did you mean?' : 'Not in the connected data',
  props: {
    mode, question: asked, restatement: t.clarifyingQuestion ?? t.envelope.answer,
    options: (t.clarifyOptions ?? []).slice(0, 4).map((o, i) => ({ id: `o${i + 1}`, label: (o as { label?: string }).label ?? (o as { question?: string }).question ?? String(o) })),
    allow_free_text: true,
  },
});

/** Picks the template and fills the spec. Pure given (question, turn, store). */
export function pick({ question: asked, turn, store }: PickInput): { spec: ChartSpec; evidence: Evidence } {
  const question = asked; const core = coreQuestion(asked);
  const env = turn.envelope; const res = env.result as Record<string, unknown>;
  const intent = intentOf(turn);
  const tid = env.proof?.template_id ?? 'guard';
  if (res.refused) return { spec: clarify('refuse', turn, 'guard.refuse', asked), evidence: { items: [] } };
  if (turn.clarificationNeeded || res.clarification_needed) return { spec: clarify('clarify', turn, tid, asked), evidence: { items: [] } };
  if (env.proof && !turn.verification.valid) return { spec: clarify('unknown', turn, tid, asked, 'error_data'), evidence: { items: [] } };
  if (res.unknown || !intent || !env.proof) return { spec: clarify('unknown', turn, tid, asked), evidence: { items: [] } };

  const main = itemFrom('main', 'answer', env, core, intent);
  const items: EvidenceItem[] = [main];
  const m = intent.measure; const ag = intent.aggregation;
  const numKeys = Object.keys(res).filter((x) => typeof res[x] === 'number');
  let k = primaryKey(res) ?? numKeys[0];
  let pre: EvidenceItem[] | null = null;
  if (!k && (ag === 'argmax' || ag === 'argmin')) {
    // the winner-only result: the breakdown supplies the measured key
    pre = res.source !== undefined ? bySource(store, core, intent, 'usd') : byBuilding(store, core, intent, '');
    k = pre.length ? primaryKey(pre[0].result) : undefined;
    if (k) pre = pre.filter((x) => typeof x.result[k!] === 'number');
  }
  const unit: Unit | undefined = k ? UNIT_OF[k] : undefined;
  const gd = GOOD_DIRECTION[m] ?? 'up';
  const title = question.replace(/\s+/g, ' ').trim().replace(/[?.]$/, '');
  const base = { title, intent: tid, insight: INSIGHT[m] ?? m, answer: env.answer, subtitle: intent.dateExplicit ? intent.dateWindow.label : undefined,
    source: tid, as_of: intent.dateWindow.endDate, state: 'ready' as PanelState };
  const done = (spec: ChartSpec) => ({ spec, evidence: { items } });
  /** partial: some breakdown members had no verified answer; the caption names them. */
  const partial = (want: readonly string[], got: readonly string[]) => {
    const missing = want.filter((w) => !got.includes(w));
    return missing.length ? { state: 'partial' as PanelState, missing } : {};
  };

  // recommendation_card: the decision-style asks. Approve only drafts; confidence is not scored by the engine.
  if (m === 'reallocation_leases' && typeof res.leases === 'number') {
    return done({ ...base, template: 'recommendation_card', title: 'Recommended budget move', props: {
      title: `Move dead spend to ${String(res.source)}`, summary: 'Reallocate paid spend that signed no leases to the lowest cost-per-lease source.', impact_level: 'high',
      impacts: [{ label: 'Added leases', value: num(main, 'leases'), unit: 'leases', good_direction: 'up' }], confidence: null, citations: env.citations.slice(0, 12),
      reasoning: ['Source pairs that signed no leases in the window are the money to move.', `${String(res.source)} is the source the typed query selects for the move.`, 'Approve creates a draft record marked pending approval; nothing is sent.'],
      actions: ['approve', 'dismiss'] } });
  }
  if ((m === 'dead_spend_pairs' || m === 'dead_spend_building') && typeof res.usd === 'number' && CHANGE.test(question)) {
    return done({ ...base, template: 'recommendation_card', title: 'Where we are losing money', props: {
      title: 'Pause or reallocate paid spend that signed no leases', summary: 'Paid sources with spend and no signed leases in the window.', impact_level: 'high',
      impacts: [{ label: 'Spend with no leases', value: num(main, 'usd'), unit: '$', good_direction: 'down' }], confidence: null, citations: env.citations.slice(0, 12),
      reasoning: ['Each pair is a paid source at a building with spend and no signed leases.', 'Rollback: restore spend if leads drop in the next month.', 'Approve creates a draft record marked pending approval; nothing is sent.'],
      actions: ['approve', 'dismiss'] } });
  }
  // ranked_table: lists
  if (Array.isArray(res.pairs)) {
    const rows = (res.pairs as string[][]).map((p) => ({ building: store.properties.find((x) => x.propertyId === p[0])?.name ?? p[0], source: p[1] }));
    return done({ ...base, template: 'ranked_table', props: { columns: [{ key: 'building', label: 'Building', align: 'left' }, { key: 'source', label: 'Source', align: 'left' }], rows, limit: 10, total: num(main, 'usd'), total_label: 'Spend with no leases', unit: '$' } });
  }
  if (Array.isArray(res.sources)) {
    return done({ ...base, template: 'ranked_table', props: { columns: [{ key: 'source', label: 'Source', align: 'left' }], rows: (res.sources as string[]).map((s) => ({ source: s })), limit: 10,
      total: typeof res.usd === 'number' ? num(main, 'usd') : undefined, total_label: 'Spend with no leases', unit: '$' } });
  }
  // stacked_bar: renewal pipeline
  if (typeof res.ending === 'number' && typeof res.renewed === 'number' && typeof res.percent !== 'number') {
    return done({ ...base, template: 'stacked_bar', props: { categories: ['Leases ending'], total: [num(main, 'ending')], segments: [{ name: 'Renewed', values: [num(main, 'renewed')] }], focus: 'Renewed', rest_label: 'Not renewed yet', unit: 'leases' } });
  }
  if (!k) return { spec: clarify('unknown', turn, tid, asked), evidence: { items } };

  // kpi_delta: two periods in one result, or an explicit comparison to the prior period
  if (m === 'spend_h1_vs_q3' && numKeys.length >= 2) {
    return done({ ...base, template: 'kpi_delta', props: { value: num(main, numKeys[1]), unit, prior: num(main, numKeys[0]), vs: numKeys[0], current_label: numKeys[1], good_direction: gd } });
  }
  if (ag === 'value' && DELTA.test(question) && intent.dateWindow.months.length) {
    const pm = shiftMonths(intent.dateWindow.months);
    const pw = { key: 'PRIOR', label: `${monthWin(pm[0]).label} to ${monthWin(pm[pm.length - 1]).label}`, startDate: `${pm[0]}-01`, endDate: monthWin(pm[pm.length - 1]).endDate, months: pm };
    const prior = sub(store, core, { ...intent, dateWindow: pw } as ParsedQueryIntent, 'prior', pw.label);
    if (prior && typeof prior.result[k] === 'number') {
      items.push(prior);
      return done({ ...base, template: 'kpi_delta', props: { value: num(main, k), unit, prior: num(prior, k), vs: pw.label, current_label: intent.dateWindow.label, good_direction: gd } });
    }
  }
  // trend_line: over time
  if (TREND.test(question) && intent.dateWindow.months.length >= 2) {
    const want = intent.dateWindow.months.map((mm) => monthWin(mm).label);
    const pts = intent.dateWindow.months.map((mm) => sub(store, core, { ...intent, aggregation: 'value', dateWindow: monthWin(mm) } as ParsedQueryIntent, `M${mm.replace('-', '')}`, monthWin(mm).label))
      .filter((x): x is EvidenceItem => !!x && typeof x.result[k] === 'number');
    if (pts.length >= 2) {
      items.push(...pts);
      return done({ ...base, ...partial(want, pts.map((p) => p.label)), template: 'trend_line', props: { x: pts.map((p) => p.label), series: [{ name: INSIGHT[m] ?? m, values: pts.map((p) => num(p, k!)), primary: true }], unit, good_direction: gd } });
    }
  }
  // grid_heatmap: building x source
  if (HEAT.test(question) && intent.domain === 'marketing') {
    const srcs = [...new Set([...store.paidSources, ...(intent.paidOnly ? [] : store.organicSources)] as string[])];
    const props = store.operatingProperties;
    const values = props.map((p) => srcs.map((s) => {
      const it = sub(store, `${core} (scope: ${p.name})`, { ...intent, aggregation: 'value', isWholePortfolioExplicit: false, mentionedSources: [s] } as ParsedQueryIntent, `${p.propertyId}_${s.replace(/\W/g, '')}`, `${p.name} / ${s}`);
      if (!it || typeof it.result[k!] !== 'number') return null; items.push(it); return num(it, k!);
    }));
    const missing = props.flatMap((p, i) => srcs.filter((_, j) => values[i][j] === null).map((s) => `${p.name} / ${s}`));
    return done({ ...base, ...(missing.length ? { state: 'partial' as PanelState, missing } : {}), template: 'grid_heatmap', props: { rows: props.map((p) => p.name), cols: srcs, values, unit } });
  }
  // scatter: rent vs size by building
  if (SCATTER.test(question) || m === 'avg_market_rent_and_sqft') {
    const names = store.operatingProperties.map((p) => p.name);
    const pts = store.operatingProperties.map((p) => {
      const rq = `What is the average market rent at ${p.name}?`, sq = `What is the average square footage at ${p.name}?`;
      const rent = sub(store, rq, parseQueryIntent(rq, store), `${p.propertyId}_rent`, p.name);
      const size = sub(store, sq, parseQueryIntent(sq, store), `${p.propertyId}_sqft`, p.name);
      if (!rent || !size || typeof rent.result.usd !== 'number' || typeof size.result.sqft !== 'number') return null;
      items.push(rent, size); return { label: p.name, x: num(size, 'sqft'), y: num(rent, 'usd') };
    }).filter((x): x is NonNullable<typeof x> => !!x);
    if (pts.length >= 2) {
      const top = [...pts].sort((a, b) => b.y.v / b.x.v - a.y.v / a.x.v)[0].label;
      return done({ ...base, ...partial(names, pts.map((p) => p.label)), template: 'scatter', props: { points: pts, x: { label: 'Avg sq ft', unit: 'sqft' }, y: { label: 'Avg market rent', unit: '$' }, highlight: [top], highlight_reason: 'highest rent per square foot' } });
    }
  }
  // argmax / argmin / compare: breakdown chart
  if (ag === 'argmax' || ag === 'argmin' || ag === 'compare' || intent.topK) {
    const bd = pre ?? (res.source !== undefined ? bySource(store, core, intent, k) : byBuilding(store, core, intent, k));
    if (bd.length >= 2) {
      items.push(...bd);
      const sorted = [...bd].sort((a, b) => (b.result[k] as number) - (a.result[k] as number));
      const winner = String(res.source ?? store.properties.find((p) => p.propertyId === res.property_id)?.name ?? '');
      const ent = res.source !== undefined ? 'Source' : 'Building';
      if (RANK.test(question) || intent.topK) {
        const top = sorted.slice(0, intent.topK ?? sorted.length);
        return done({ ...base, template: 'ranked_table', props: { columns: [{ key: 'entity', label: ent, align: 'left' }, { key: 'value', label: INSIGHT[m] ?? m, unit, align: 'right' }], rows: top.map((x) => ({ entity: x.label, value: num(x, k!) })), rank_by: 'value', limit: 10, highlight: [winner] } });
      }
      return done({ ...base, template: 'sorted_bar', props: { items: sorted.map((x) => ({ label: x.label, value: num(x, k!) })), unit, sort: 'desc', highlight: [winner], good_direction: gd } });
    }
  }
  // kpi: one value
  const secondary = numKeys.filter((x) => x !== k).map((x) => ({ label: x.replace(/_/g, ' '), value: num(main, x), unit: UNIT_OF[x] ?? 'count' }));
  return done({ ...base, template: 'kpi', props: { value: num(main, k), unit, secondary: secondary.length ? secondary : undefined, good_direction: gd } });
}

const canon = (x: unknown): string => JSON.stringify(x, (_k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, y]) => y !== undefined).sort(([a], [b]) => a.localeCompare(b))) : v);
/**
 * Full-intent coverage: the picker charts only an intent that equals, field by
 * field, the deterministic lexicon reading of the same question. A model parse
 * that changes the measure, window, scope or any other field goes to Clarify,
 * so the model can never choose which number is shown (S2 F2).
 */
export function intentGate(turn: CopilotTurnResult, core: string, store: PortfolioStore): ChartSpec | null {
  const intent = intentOf(turn);
  if (!intent || !turn.envelope.proof) return null;
  if (canon(intent) === canon(parseQueryIntent(core, store))) return null;
  return { ...clarify('clarify', turn, turn.envelope.proof.template_id, core), insight: 'The parsed reading differs from the question text', title: 'Which did you mean?' };
}

/** Full path: S2 parse (model if configured, deterministic otherwise) -> picker -> validated spec. */
export async function askPanel(input: string, store: PortfolioStore, parse: ParseConfig | null = null): Promise<Panel> {
  // multi-turn input "a → b → c" runs every turn in one fair-housing session; the last turn is charted
  const turns = input.split(/\s*→\s*/).filter(Boolean);
  const session: FairHousingSession = { refusedEarlier: false };
  let turn!: CopilotTurnResult;
  for (const t of turns) turn = await askFlowIqCopilot(coreQuestion(t), { mode: 'deterministic', store, parse, session });
  const question = turns[turns.length - 1];
  const gate = intentGate(turn, coreQuestion(question), store);
  if (gate) return { question: input, spec: gate, evidence: { items: [] }, errors: [], parsePath: turn.parsePath, parseFallbackReason: turn.parseFallbackReason ?? null };
  const { spec, evidence } = pick({ question, turn, store });
  const errors = specErrors(spec, evidence, store);
  // a spec that fails fidelity is never rendered as a chart
  const shown: ChartSpec = errors.length ? { ...clarify('unknown', turn, spec.intent, question, 'error_data') } : spec;
  return { question: input, spec: shown, evidence, errors, parsePath: turn.parsePath, parseFallbackReason: turn.parseFallbackReason ?? null };
}

/**
 * Full re-check of a panel: the structural and recompute rules in specErrors,
 * then the picker is run again on the question (deterministic parse) and the
 * whole spec and every evidence recipe must be identical. This binds each
 * breakdown item to the item the picker would build for that question, so a
 * consistent forgery (recipe, result, hash and spec swapped together) fails.
 */
export async function panelErrors(question: string, spec: unknown, evidence: Evidence | undefined, store: PortfolioStore): Promise<string[]> {
  if (typeof question !== 'string' || !spec || typeof spec !== 'object') return ['panel needs a question and a spec'];
  const fresh = await askPanel(question, store, null);
  const errs = evidence ? specErrors(spec as ChartSpec, evidence, store) : [];
  if (canon(spec) !== canon(fresh.spec)) errs.push('spec differs from the spec the picker builds for this question');
  if (evidence && canon(evidence) !== canon(fresh.evidence)) errs.push('evidence differs from the evidence the picker builds for this question');
  return errs;
}
