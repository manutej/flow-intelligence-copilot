import { extreme } from '../domain/extreme.ts';
import { twoMeasureGuard, misspeltBuildingGuard } from './guards.ts';
import { currencyAsk, withoutCurrency, type CurrencyAsk } from './currency.ts';
import { rateProvider } from '../fx/provider.ts';
import { convert, fxAnswer, rateLabel } from '../fx/convert.ts';
import { billedRows } from './spec.ts';
import { askFlowIqCopilot, type CopilotTurnResult } from '../agent/copilot.ts';
import { parseQueryIntent, type ParsedQueryIntent } from '../agent/intent.ts';
import { executeCompositionalPlan } from '../agent/planner.ts';
import type { FairHousingSession } from '../domain/fair-housing.ts';
import { hashOf } from '../agent/envelope.ts';
import { verifyAnswerEnvelope } from '../domain/guards.ts';
import type { AnswerEnvelope, PortfolioStore } from '../data/schema.ts';
import type { ParseConfig } from '../agent/model-parse.ts';
import { readSettings } from './inputs.ts';
import { resolvePropertiesFromText } from '../domain/resolver.ts';
import { inLabel, OVERALL, specErrors, type ChartSpec, type Evidence, type EvidenceItem, type Num, type PanelState, type Unit } from './spec.ts';

/**
 * Deterministic intent-to-insight picker (rule table: docs/genui-rules.md).
 * Input: the S2 turn (typed query + verified envelope). Output: one ChartSpec
 * whose every number traces to a verified result. No model touches this step.
 * Breakdowns (per building, per source, per month) are extra typed queries,
 * each executed by the planner and kept only if its envelope verifies.
 */
const UNIT_OF: Record<string, Unit> = { usd: '$', percent: '%', count: 'count', sqft: 'sqft', leases: 'leases' };
const KEY_ORDER = ['usd', 'percent', 'count', 'sqft', 'leases'];
/** The result key a measure is about, where the generic order would pick a side figure (avg_sqft also carries the unit count). */
const MEASURE_KEY: Readonly<Record<string, string>> = { avg_sqft: 'sqft', total_concession: 'usd', lease_count: 'count' };
const primaryKey = (r: Readonly<Record<string, unknown>>, m?: string) => {
  const own = m ? MEASURE_KEY[m] : undefined;
  if (own) return typeof r[own] === 'number' ? own : undefined;
  return KEY_ORDER.find((k) => typeof r[k] === 'number');
};

/** The insight each measure family shows, named for the reader. */
export const INSIGHT: Record<string, string> = {
  unit_count: 'Inventory: how many units match', vacancy_rate: 'Vacancy pressure', occupied_share: 'Occupancy health',
  avg_market_rent: 'Pricing position', avg_sqft: 'Unit mix size', rent_per_sqft: 'Price per square foot',
  avg_market_rent_and_sqft: 'Pricing vs size', lease_count: 'Leasing velocity', renewal_rate: 'Retention',
  ending_and_renewed: 'Renewal pipeline', average_concession: 'Concession cost', total_concession: 'Concession cost', rent_at_risk: 'Revenue at risk',
  new_vs_renewal_and_concession: 'New vs renewal mix', renewal_rate_class_comparison: 'Retention by class',
  lead_count: 'Demand volume', leads_leased: 'Lead conversion', spend_total: 'Marketing spend', spend_h1_vs_q3: 'Spend change between periods',
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

/** The operating buildings a question names, when it names two or more: a comparison charts only those. */
export function namedBuildings(store: PortfolioStore, q: string) {
  const ids = new Set(resolvePropertiesFromText(store, q).matched.map((p) => p.propertyId));
  const named = store.operatingProperties.filter((p) => ids.has(p.propertyId));
  return named.length >= 2 ? named : null;
}
const escRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * One building's slice of the question: every building the question names is cut and the
 * slice is scoped to that building alone, so each bar is computed for one building with the
 * main answer's window and definition. A slice whose text does not resolve to exactly that
 * building is dropped (the panel shows it as partial), never charted as another scope.
 */
export function scopedQuestion(store: PortfolioStore, q: string, p: { propertyId: string; name: string }): string | null {
  let t = q;
  for (const n of resolvePropertiesFromText(store, q, { includeOnboarding: true }).matched)
    for (const w of [n.name, n.name.replace(/&/g, 'and'), n.propertyId]) t = t.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escRe(w)}(?![\\p{L}\\p{N}])`, 'giu'), ' ');
  const scoped = `${t.replace(/\s+([?.,])/g, '$1').replace(/\s{2,}/g, ' ').trim()} (scope: ${p.name})`;
  const r = resolvePropertiesFromText(store, scoped).matched;
  return r.length === 1 && r[0].propertyId === p.propertyId ? scoped : null;
}
function byBuilding(store: PortfolioStore, q: string, intent: ParsedQueryIntent, k: string): EvidenceItem[] {
  const it = { ...intent, aggregation: 'value', isWholePortfolioExplicit: false, isClassComparison: false } as ParsedQueryIntent;
  return (namedBuildings(store, q) ?? store.operatingProperties).map((p) => { const sq = scopedQuestion(store, q, p); return sq ? sub(store, sq, it, p.propertyId, p.name) : null; })
    .filter((x): x is EvidenceItem => !!x && (k === '' || typeof x.result[k] === 'number'));
}

/**
 * The highlight is derived from the plotted series alone: the single largest (or, for
 * argmin, smallest) plotted value. When the extreme value is shared, nothing is highlighted.
 */
export function seriesWinner(series: ReadonlyArray<{ label: string; v: number }>, want: 'max' | 'min'): string | null {
  return extreme(series, (x) => x.v, want).winner?.label ?? null;
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
  lease_count: 'up', renewal_rate: 'up', ending_and_renewed: 'up', average_concession: 'down', total_concession: 'down', rent_at_risk: 'down',
  lead_count: 'up', leads_leased: 'up', spend_total: 'down', spend_h1_vs_q3: 'down', cost_per_lead: 'down', cost_per_tour: 'down', cost_per_lead_and_tour: 'down',
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
  let k: string | undefined = primaryKey(res, intent.measure) ?? (MEASURE_KEY[intent.measure] ? undefined : numKeys[0]);
  let pre: EvidenceItem[] | null = null;
  if (!k && (ag === 'argmax' || ag === 'argmin')) {
    // the winner-only result: the breakdown supplies the measured key
    pre = res.source !== undefined ? bySource(store, core, intent, 'usd') : byBuilding(store, core, intent, '');
    k = pre.length ? primaryKey(pre[0].result, intent.measure) : undefined;
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
      reasoning: ['Source and building combinations that signed no leases in the window are the money to move.', `${String(res.source)} is the source the typed query selects for the move.`, 'Approve creates a draft record marked pending approval; nothing is sent.'],
      actions: ['approve', 'dismiss'] } });
  }
  if ((m === 'dead_spend_pairs' || m === 'dead_spend_building') && typeof res.usd === 'number' && CHANGE.test(question)) {
    return done({ ...base, template: 'recommendation_card', title: 'Where we are losing money', props: {
      title: 'Pause or reallocate paid spend that signed no leases', summary: 'Paid sources with spend and no signed leases in the window.', impact_level: 'high',
      impacts: [{ label: 'Spend with no leases', value: num(main, 'usd'), unit: '$', good_direction: 'down' }], confidence: null, citations: env.citations.slice(0, 12),
      reasoning: ['Each row is a paid source at a building with spend and no signed leases.', 'Rollback: restore spend if leads drop in the next month.', 'Approve creates a draft record marked pending approval; nothing is sent.'],
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
    const pw = { key: 'PRIOR', label: pm.length === 1 ? monthWin(pm[0]).label : `${monthWin(pm[0]).label} to ${monthWin(pm[pm.length - 1]).label}`, startDate: `${pm[0]}-01`, endDate: monthWin(pm[pm.length - 1]).endDate, months: pm };
    // the prior period moves every window the question is cut by, the lease-start window included
    const prior = sub(store, core, { ...intent, dateWindow: pw, ...(intent.leaseStartWindow ? { leaseStartWindow: pw } : {}) } as ParsedQueryIntent, 'prior', pw.label);
    if (prior && typeof prior.result[k] === 'number') {
      items.push(prior);
      return done({ ...base, template: 'kpi_delta', props: { value: num(main, k), unit, prior: num(prior, k), vs: pw.label, current_label: intent.dateWindow.label, good_direction: gd } });
    }
  }
  // trend_line: over time
  if (TREND.test(question) && intent.dateWindow.months.length >= 2) {
    const want = intent.dateWindow.months.map((mm) => monthWin(mm).label);
    const pts = intent.dateWindow.months.map((mm) => sub(store, core, { ...intent, aggregation: 'value', dateWindow: monthWin(mm), ...(intent.leaseStartWindow ? { leaseStartWindow: monthWin(mm) } : {}) } as ParsedQueryIntent, `M${mm.replace('-', '')}`, monthWin(mm).label))
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
    // the buildings asked about: one named building is its own two figures, never the portfolio
    const ids = new Set(resolvePropertiesFromText(store, core).matched.map((p) => p.propertyId));
    const scope = ids.size ? store.operatingProperties.filter((p) => ids.has(p.propertyId)) : store.operatingProperties;
    if (scope.length === 1 && m === 'avg_market_rent_and_sqft' && typeof main.result.usd === 'number' && typeof main.result.sqft === 'number')
      return done({ ...base, template: 'kpi', props: { value: num(main, 'usd'), unit: '$', secondary: [{ label: 'average square footage', value: num(main, 'sqft'), unit: 'sqft' }], good_direction: gd } });
    if (scope.length === 1) return { spec: { ...clarify('unknown', { ...turn, clarifyingQuestion: `This chart compares buildings, and the question names one (${scope[0].name}), so nothing is charted rather than widening the scope; ask for that building's figures directly.` } as CopilotTurnResult, tid, asked), title: 'One building named' }, evidence: { items: [] } };
    const names = scope.map((p) => p.name);
    const pts = scope.map((p) => {
      const rq = `What is the average market rent at ${p.name}?`, sq = `What is the average square footage at ${p.name}?`;
      const rent = sub(store, rq, parseQueryIntent(rq, store), `${p.propertyId}_rent`, p.name);
      const size = sub(store, sq, parseQueryIntent(sq, store), `${p.propertyId}_sqft`, p.name);
      if (!rent || !size || typeof rent.result.usd !== 'number' || typeof size.result.sqft !== 'number') return null;
      items.push(rent, size); return { label: p.name, x: num(size, 'sqft'), y: num(rent, 'usd') };
    }).filter((x): x is NonNullable<typeof x> => !!x);
    if (pts.length >= 2) {
      // the highest rent per square foot, unique; a tie highlights nothing
      const top = extreme(pts, (p) => p.y.v / p.x.v, 'max').winner?.label;
      return done({ ...base, ...partial(names, pts.map((p) => p.label)), template: 'scatter', props: { points: pts, x: { label: 'Avg sq ft', unit: 'sqft' }, y: { label: 'Avg market rent', unit: '$' }, highlight: top ? [top] : [], highlight_reason: 'highest rent per square foot' } });
    }
  }
  // "by source" / "by building": one bar per group, each its own verified answer; no winner is
  // claimed. A measure with no per-group answer clarifies rather than giving one pooled figure.
  const byDim = breakdownDimension(question);
  if (byDim && ag !== 'argmax' && ag !== 'argmin') {
    const bd = byDim === 'source' ? bySource(store, core, intent, k) : byBuilding(store, core, intent, k);
    if (bd.length < 2) return { spec: { ...clarify('unknown', { ...turn, clarifyingQuestion: `FlowIQ has no per-${byDim} answer for this measure, so the ${byDim} breakdown asked for is not charted and no pooled figure is shown in its place.` } as CopilotTurnResult, tid, asked), title: `No breakdown by ${byDim}` }, evidence: { items: [] } };
    items.push(...bd);
    const want = byDim === 'source' ? [...new Set([...store.paidSources, ...(intent.paidOnly ? [] : store.organicSources)] as string[])] : (namedBuildings(store, core) ?? store.operatingProperties).map((p) => p.name);
    const sorted = [...bd].sort((a, b) => (b.result[k!] as number) - (a.result[k!] as number) || a.label.localeCompare(b.label));
    // the engine's answer is the pooled figure; labelled Overall so no bar is read as having it
    const answer = base.answer === undefined ? undefined : OVERALL + base.answer;
    return done({ ...base, ...(answer ? { answer } : {}), ...partial(want, bd.map((x) => x.label)), template: 'sorted_bar', props: { items: sorted.map((x) => ({ label: x.label, value: num(x, k!) })), unit, sort: 'desc', highlight: [], good_direction: gd } });
  }
  // argmax / argmin / compare: breakdown chart
  if (ag === 'argmax' || ag === 'argmin' || ag === 'compare' || intent.topK) {
    const bd = pre ?? (res.source !== undefined ? bySource(store, core, intent, k) : byBuilding(store, core, intent, k));
    if (bd.length >= 2) {
      items.push(...bd);
      const sorted = [...bd].sort((a, b) => (b.result[k] as number) - (a.result[k] as number));
      // the highlight comes from the plotted series; the engine's named winner must agree with it,
      // or the panel is not charted (a chart never contradicts its own bars)
      const top = seriesWinner(sorted.map((x) => ({ label: x.label, v: x.result[k!] as number })), ag === 'argmin' ? 'min' : 'max');
      const named = String(res.source ?? store.properties.find((p) => p.propertyId === res.property_id)?.name ?? '');
      if ((ag === 'argmax' || ag === 'argmin') && top !== null && named && named !== top)
        return { spec: clarify('unknown', turn, tid, asked, 'error_data'), evidence: { items: [] } };
      // the text must name the chart's winner: an engine answer that names no entity (a pooled
      // total) would sit beside a highlighted bar it never mentions, so nothing is charted
      if ((ag === 'argmax' || ag === 'argmin') && top !== null && !named && !res.unknown)
        return { spec: { ...clarify('unknown', { ...turn, clarifyingQuestion: 'The computed answer is one pooled figure and names no winner, so a ranking chart would claim a winner the answer does not state. Nothing is charted.' } as CopilotTurnResult, tid, asked), title: 'No ranking for this measure' }, evidence: { items: [] } };
      const winner = top;
      const ent = res.source !== undefined ? 'Source' : 'Building';
      if (RANK.test(question) || intent.topK) {
        const top = sorted.slice(0, intent.topK ?? sorted.length);
        return done({ ...base, template: 'ranked_table', props: { columns: [{ key: 'entity', label: ent, align: 'left' }, { key: 'value', label: INSIGHT[m] ?? m, unit, align: 'right' }], rows: top.map((x) => ({ entity: x.label, value: num(x, k!) })), rank_by: 'value', limit: 10, highlight: winner ? [winner] : [] } });
      }
      return done({ ...base, template: 'sorted_bar', props: { items: sorted.map((x) => ({ label: x.label, value: num(x, k!) })), unit, sort: 'desc', highlight: winner ? [winner] : [], good_direction: gd } });
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

/** The first prior value stated in the question (beta0 or alpha0) that `used` does not hold (kept for the TENACITY repro). */
export function statedPrior(input: string, used: ReadonlySet<number> = new Set()): number | null {
  const r = readSettings(input, null, { policy: {} } as PortfolioStore, inLabel);
  return r.bindings.find((b) => b.param.id !== 'cadRate' && !used.has(b.value))?.value ?? null;
}

// a clarify that names no setting: the question has a number we cannot place, or a title we cannot write
const neutral = (turn: CopilotTurnResult, intent: string, question: string, why: string): ChartSpec => ({
  ...clarify('clarify', { ...turn, clarifyingQuestion: why, clarifyOptions: [] } as CopilotTurnResult, intent, question),
  insight: 'Needs a restatement before charting', title: 'Could you restate the question?',
});

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
  // each stated model setting (beta0, alpha0, CAD rate), in any turn, bound to its own parameter
  // with a value and a unit: a clear value that differs from what the computation used gives the
  // card for that setting; a number we cannot place gives a neutral clarify (TENACITY f9a64d0)
  const tid = turn.envelope.proof?.template_id ?? 'guard';
  const settings = readSettings(input, intentOf(turn) ?? parseQueryIntent(coreQuestion(question), store), store, inLabel, (q) => canon(parseQueryIntent(coreQuestion(q), store)),
    (q) => parseQueryIntent(coreQuestion(q), store).measure !== 'unsupported',
    (q) => canon(parseQueryIntent(coreQuestion(q), store)) !== canon(parseQueryIntent('', store)) || resolvePropertiesFromText(store, q, { includeOnboarding: true }).matched.length > 0);
  const done = (spec: ChartSpec): Panel => ({ question: input, spec, evidence: { items: [] }, errors: [], parsePath: turn.parsePath, parseFallbackReason: turn.parseFallbackReason ?? null });
  if (settings.mismatch) {
    const { name, policy } = settings.mismatch.param;
    const t = { ...turn, clarifyingQuestion: `A ${name} stated in the question is not an input this analysis used (it uses the policy ${policy(store)} where a ${name} applies), so nothing is charted. Ask again without that ${name}, or change it in the policy.`, clarifyOptions: [] };
    return done({ ...clarify('unknown', t as CopilotTurnResult, tid, question), insight: `Stated ${name} is not applied`, title: `This ${name} is not supported` });
  }
  if (settings.ambiguous) return done(neutral(turn, tid, question, 'The question states a number that could be read more than one way, so nothing is charted. Ask again with the number stated plainly, or without it.'));
  // shapes answered with another question's number: another currency, two measures, a misspelt building
  // (an answer the engine already declined keeps its own reason, except a misspelt building)
  const r0 = (turn.envelope.result ?? {}) as Record<string, unknown>;
  // a currency other than USD: "billed in CAD" filters the currency column, "in CAD" converts
  // through the currency tool; neither is answered with the USD figure alone
  const ask = r0.refused ? null : currencyAsk(coreQuestion(question));
  if (ask) return currencyPanel(input, question, ask, store, parse, turn);
  if (!r0.refused) {
    const answered = !r0.unknown && !r0.clarification_needed;
    const why = (answered ? twoMeasureGuard(coreQuestion(question), intentOf(turn)) : null) ?? misspeltBuildingGuard(coreQuestion(question), store);
    if (why) {
      const t = { ...turn, clarifyingQuestion: why, clarifyOptions: [] } as CopilotTurnResult;
      return done({ ...clarify('unknown', t, tid, question), title: 'Not answered as asked' });
    }
  }
  const { spec, evidence } = pick({ question, turn, store });
  const errors = specErrors(spec, evidence, store);
  // a spec that fails fidelity is never rendered as a chart
  // a title that would repeat a figure the computation did not use (renewal rate is 68%): the
  // numbers are not at fault, the restatement is, so ask for one instead of an error card
  if (errors.length && errors.every((e) => /^spec\.(?:title|subtitle): text carries a figure/.test(e)))
    return done(neutral(turn, spec.intent, question, 'The question states a figure this analysis did not compute, so it is not repeated as a chart title. Ask again without it.'));
  const shown: ChartSpec = errors.length ? { ...clarify('unknown', turn, spec.intent, question, 'error_data') } : spec;
  return { question: input, spec: shown, evidence, errors, parsePath: turn.parsePath, parseFallbackReason: turn.parseFallbackReason ?? null };
}

/**
 * Full re-check of a panel: the structural and recompute rules in specErrors,
 * then the picker is run again on the question (deterministic parse) and the
 * whole spec must be identical. The caller's evidence is not an input. This binds each
 * breakdown item to the item the picker would build for that question, so a
 * consistent forgery (recipe, result, hash and spec swapped together) fails.
 */
export async function panelErrors(question: string, spec: unknown, store: PortfolioStore): Promise<string[]> {
  if (typeof question !== 'string' || !spec || typeof spec !== 'object') return ['panel needs a question and a spec'];
  const fresh = await askPanel(question, store, null);
  // evidence is never taken from the caller: the fresh evidence is the only evidence, and both
  // the fresh spec and the submitted spec must pass the structural and recompute rules against it
  const errs = [...specErrors(fresh.spec, fresh.evidence, store).map((e) => `fresh spec: ${e}`), ...specErrors(spec as ChartSpec, fresh.evidence, store)];
  if (canon(spec) !== canon(fresh.spec)) errs.push('spec differs from the spec the picker builds for this question');
  return errs;
}

/** The grouping a question asks for ("by source", "for each building"), or null. */
export function breakdownDimension(q: string): 'source' | 'building' | null {
  const m = /\b(?:by|per|for\s+each|each|broken\s+down\s+by|split\s+by)\s+(?:listing\s+|lead\s+|marketing\s+)?(sources?|channels?|buildings?|propert(?:y|ies)|assets?)\b(?!\s+(?:class|type|manager|management))/i.exec(q);
  if (!m) return null;
  return /^(?:source|channel)/i.test(m[1]) ? 'source' : 'building';
}

/**
 * A currency ask. The engine answers the USD question beneath it; then
 * - filter ("billed in CAD"): the spend rows whose currency column is the code, in native
 *   currency, with their posted USD at the policy rate (labelled a fixed policy rate);
 * - convert ("in CAD", "(CAD)", "CAD spend"): one USD figure converted by the currency tool at
 *   the provider's daily rate, shown with its source and as-of date.
 * Any failure (no rate, a stale rate, a non-money or multi-figure panel) is a typed IDK; there
 * is never a fixed-rate or USD fallback.
 */
async function currencyPanel(input: string, question: string, ask: CurrencyAsk, store: PortfolioStore, parse: ParseConfig | null, turn0: CopilotTurnResult): Promise<Panel> {
  let q2 = withoutCurrency(question, ask);
  if (ask.mode === 'filter') q2 = q2.replace(/^(?:the\s+)?(?:invoices?|bills?|rows?)\b/i, 'Total marketing spend');
  const session: FairHousingSession = { refusedEarlier: false };
  const turn = await askFlowIqCopilot(coreQuestion(q2), { mode: 'deterministic', store, parse, session });
  const tid = turn.envelope.proof?.template_id ?? turn0.envelope.proof?.template_id ?? 'guard';
  const idk = (why: string, title: string): Panel => ({ question: input, spec: { ...clarify('unknown', { ...turn, clarifyingQuestion: why, clarifyOptions: [] } as CopilotTurnResult, tid, question), title }, evidence: { items: [] }, errors: [], parsePath: turn.parsePath, parseFallbackReason: turn.parseFallbackReason ?? null });
  const base = pick({ question: q2, turn, store });
  const sp = base.spec;
  const main = base.evidence.items.find((i) => i.key === 'main');
  const usd = (main?.result as Record<string, unknown> | undefined)?.usd;
  if (sp.template !== 'kpi' || sp.props.unit !== '$' || !main || typeof usd !== 'number' || sp.props.value.ref !== 'items.main.result.usd' || specErrors(sp, base.evidence, store).length)
    return idk(`The question names a currency (${ask.surface}), and FlowIQ converts or filters one verified US-dollar figure at a time; this question does not have one, so nothing is charted.`, 'Currency not applied');
  const out = (spec: ChartSpec, items: readonly EvidenceItem[]): Panel => {
    const evidence = { items };
    const errors = specErrors(spec, evidence, store);
    return { question: input, spec: errors.length ? clarify('unknown', turn, spec.intent, question, 'error_data') : spec, evidence, errors, parsePath: turn.parsePath, parseFallbackReason: turn.parseFallbackReason ?? null };
  };
  if (ask.mode === 'filter') {
    const intent = intentOf(turn)!;
    const months = intent.dateWindow.months ?? [];
    const named = resolvePropertiesFromText(store, coreQuestion(q2)).matched;
    const ids = (named.length ? named : store.operatingProperties).map((p) => p.propertyId);
    const sources = intent.mentionedSources ?? [];
    const r = billedRows(store, ask.code, months, ids, sources);
    if (r.rows === 0) return idk(`No posted spend rows in this window are billed in ${ask.code} (the currency column holds ${[...new Set(store.spend.map((x) => x.currency))].join(' and ')}), so there is nothing to total.`, `Nothing billed in ${ask.code}`);
    const item: EvidenceItem = { key: 'billed', label: `spend billed in ${ask.code}`, template_id: main.template_id, result: r, result_hash: hashOf(r), citations: [], recipe: main.recipe, tool: { kind: 'billed', code: ask.code, months, propertyIds: ids, sources } };
    const { answer: _drop, ...rest } = sp;
    return out({ ...rest, title: `${sp.title}, billed in ${ask.code} only`, insight: `Only spend rows whose currency column is ${ask.code}`, template: 'kpi',
      props: { value: { v: r.native, ref: 'items.billed.result.native' }, unit: ask.code, good_direction: sp.props.good_direction,
        secondary: [{ label: `posted in USD at the data kit's fixed CAD rate (KIT_README), not a market rate`, value: { v: r.usd_posted, ref: 'items.billed.result.usd_posted' }, unit: '$' }, { label: 'spend rows', value: { v: r.rows, ref: 'items.billed.result.rows' }, unit: 'count' }],
        fx: { rate: { v: r.policy_rate, ref: 'items.billed.result.policy_rate' }, quote: ask.code, source: 'FlowIQ data kit (KIT_README)', as_of: null, rate_label: 'fixed kit rate, USD per CAD (KIT_README)' } } }, [main, item]);
  }
  const got = await rateProvider().rate('USD', ask.code, new Date());
  if (!got.ok) return idk(`No usable USD to ${ask.code} rate (${got.source}: ${got.reason.replace('_', ' ')}), so no converted figure is shown. FlowIQ never falls back to a fixed rate or to the US-dollar figure.`, `No ${ask.code} rate available`);
  const q = got.quote;
  // spend with CAD-billed rows was posted to USD at the kit's fixed rate (KIT_README); said so, not undone
  const kit = /\bCAD converted at\b/.test(sp.answer ?? '') ? { kit_rate: store.policy.cadToUsdRate } : {};
  const r = { usd, rate: q.rate, converted: convert(usd, q), base: 'USD', quote: ask.code, source: q.source, as_of: q.asOf, label: rateLabel(q), ...kit, ...(q.fallbackFrom ? { fallback_from: q.fallbackFrom } : {}) };
  const item: EvidenceItem = { key: 'fx', label: `USD to ${ask.code}`, template_id: main.template_id, result: r, result_hash: hashOf(r), citations: [], recipe: main.recipe, tool: { kind: 'fx' } };
  return out({ ...sp, answer: fxAnswer(r), title: `${sp.title}, in ${ask.code}`, insight: `Converted from US dollars by the currency tool`,
    props: { value: { v: r.converted, ref: 'items.fx.result.converted' }, unit: ask.code, good_direction: sp.props.good_direction,
      secondary: [{ label: 'computed in USD', value: sp.props.value, unit: '$' }, { label: `${ask.code} per USD`, value: { v: q.rate, ref: 'items.fx.result.rate' }, unit: 'rate' }],
      fx: { rate: { v: q.rate, ref: 'items.fx.result.rate' }, quote: ask.code, source: q.source, as_of: q.asOf, rate_label: r.label } } }, [...base.evidence.items, item]);
}
