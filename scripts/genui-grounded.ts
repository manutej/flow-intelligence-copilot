/**
 * Grounded GenUI check: panel headline numbers and named winners against computed truth.
 * Each fact in a facts file (default: the v4-answerable dev split) is turned into a question
 * by a fixed per-measure template written from the fact's fields (measure, scope, period,
 * filters), never from an expected answer. The panel's headline (the KPI value, the delta of
 * a kpi_delta, or the highlighted winner of a breakdown) is compared with the fact's value,
 * accepting either definition variant (defA or defB) within the fact's tolerance plus the
 * display rounding. A clarify card is an IDK. A fact whose measure has no template is counted
 * as not asked, never as correct.
 * Usage: node --no-warnings scripts/genui-grounded.ts [facts.jsonl] [--tsv out.tsv] [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { askPanel } from '../src/genui/picker.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';
import type { ChartSpec } from '../src/genui/spec.ts';

const DEFAULT = '/home/box/flowiq-scenarios/v4-answerable/dev/facts_dev.jsonl';
const args = process.argv.slice(2);
const file = args.find((a) => a.endsWith('.jsonl')) ?? DEFAULT;
if (/(^|\/)sealed(\/|$)/.test(file)) { console.error('refusing a sealed split'); process.exit(2); }
const tsvAt = args.includes('--tsv') ? args[args.indexOf('--tsv') + 1] : null;

export interface Fact {
  fact_id: string; measure: string; scope: string; scope_name: string; period: string; filters: Record<string, string | number>;
  value: number | string; unit: string; tolerance: number; kind: 'number' | 'entity'; accept_names: string[] | null;
  value_variants?: Record<string, number | string> | null; tolerance_variants?: Record<string, number> | null;
}

const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const when = (p: string) => /^\d{4}-\d{2}$/.test(p) ? ` in ${MONTH[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}` : /^\d{4}Q\d$/.test(p) ? ` in Q${p.slice(5)} ${p.slice(0, 4)}` : '';
const at = (f: Fact) => f.scope === 'portfolio' ? ' across the portfolio' : ` at ${f.scope_name}`;
const beds = (f: Fact) => f.filters.bedrooms === undefined ? '' : f.filters.bedrooms === 0 ? 'studio ' : `${f.filters.bedrooms}-bedroom `;
const src = (f: Fact) => typeof f.filters.source === 'string' ? ` from ${f.filters.source}` : '';
const prior = (p: string) => /^\d{4}-\d{2}$/.test(p) ? ' compared to the prior period' : '';
const NOUN: Record<string, string> = { avg_lease_rent: 'average lease rent', avg_market_rent: 'average market rent', cost_per_lead: 'cost per lead', lead_to_lease_rate: 'lead to lease conversion rate',
  leads: 'leads', leases_started: 'leases started', market_rent_psf: 'market rent per square foot', occupancy_rate: 'occupancy', renewal_rate: 'renewal rate', spend_usd: 'marketing spend', tours: 'tours', vacant_units: 'vacant units' };

/** The question for a fact, or null when the measure has no template. */
export function questionFor(f: Fact): string | null {
  const P = when(f.period), A = at(f), B = beds(f), S = src(f);
  const lt = f.filters.lease_type ? `${f.filters.lease_type} ` : '';
  const rank = f.measure.match(/^rank_(max|min)_(.+?)(_source)?$/);
  if (rank) {
    const [, dir, m, bySrc] = rank; const n = NOUN[m]; if (!n) return null;
    const hi = dir === 'max' ? (/_units$|^leads$|^tours$|^leases_started$/.test(m) ? 'most' : 'highest') : (/_units$|^leads$|^tours$|^leases_started$/.test(m) ? 'fewest' : 'lowest');
    return `Which ${bySrc ? 'listing source' : 'building'} had the ${hi} ${B}${n}${P}?`;
  }
  switch (f.measure) {
    case 'leads': return `How many leads${S} did${A.replace(' at ', ' ').replace(' across the portfolio', ' the portfolio')} get${P}?`;
    case 'tours': return `How many tours${S}${A}${P}?`;
    case 'applications': return `How many applications${S}${A}${P}?`;
    case 'leads_leased': return `How many leads${S}${A} leased${P}?`;
    case 'spend_usd': return `What was total marketing spend${S}${A}${P}?`;
    case 'cost_per_lead': return `What was the cost per lead${S}${A}${P}?`;
    case 'lead_to_lease_rate': return `What was the lead to lease conversion rate${A}${P}?`;
    case 'occupancy_rate': return `What is the occupancy of ${B}units${A}?`;
    case 'vacant_units': return `How many ${B}vacant units${A}?`;
    case 'notice_units': return `How many ${B}units are on notice${A}?`;
    case 'unit_count': return `How many ${B}units${A}?`;
    case 'avg_market_rent': return `What is the average market rent for ${B}units${A}?`;
    case 'avg_sqft': return `What is the average square footage of ${B}units${A}?`;
    case 'market_rent_psf': return `What is the market rent per square foot for ${B}units${A}?`;
    case 'renewal_rate': return `What is the renewal rate${A}?`;
    case 'renewal_status_count': return `How many leases${A} have renewal status ${String(f.filters.renewal_status).replace('_', ' ')}?`;
    case 'leases_started': return `How many ${lt}leases started${A}${P}?`;
    case 'avg_lease_rent': return `What is the average monthly rent on ${lt}leases starting${A}${P}?`;
    case 'total_concessions': return `What were total concessions on ${lt}leases starting${A}${P}?`;
    case 'pct_leases_with_concession': return `What share of ${lt}leases starting${A}${P} had a concession?`;
    case 'leads_mom_change': case 'leads_mom_pct': return `How many leads did${A.replace(' at ', ' ').replace(' across the portfolio', ' the portfolio')} get${P}${prior(f.period)}?`;
    case 'spend_usd_mom_change': case 'spend_usd_mom_pct': return `What was total marketing spend${A}${P}${prior(f.period)}?`;
    case 'cost_per_lead_mom_change': case 'cost_per_lead_mom_pct': return `What was the cost per lead${A}${P}${prior(f.period)}?`;
    case 'leases_started_mom_change': case 'leases_started_mom_pct': return `How many leases started${A}${P}${prior(f.period)}?`;
    default: return null;
  }
}

export type Headline = { kind: 'idk' } | { kind: 'number'; v: number } | { kind: 'entity'; name: string | null } | { kind: 'none'; template: string };
/** What a panel claims as its answer: the number it leads with, or the winner it names. */
export function headline(spec: ChartSpec, f: Fact): Headline {
  if (spec.template === 'clarify_card') return { kind: 'idk' };
  if (f.kind === 'entity') {
    if (spec.template === 'sorted_bar' || spec.template === 'ranked_table') return { kind: 'entity', name: spec.props.highlight?.[0] ?? null };
    return { kind: 'none', template: spec.template };
  }
  if (spec.template === 'kpi') return { kind: 'number', v: spec.props.value.v };
  if (spec.template === 'kpi_delta') {
    const v = spec.props.value.v, p = spec.props.prior.v;
    if (/_mom_change$/.test(f.measure)) return { kind: 'number', v: v - p };
    if (/_mom_pct$/.test(f.measure)) return { kind: 'number', v: p === 0 ? NaN : ((v - p) / p) * 100 };
    return { kind: 'number', v };
  }
  return { kind: 'none', template: spec.template };
}
const ROUNDING: Record<string, number> = { percent: 0.05, USD: 0.005, 'USD/sqft': 0.005, sqft: 0.05, count: 0 };
/** correct when the headline equals the fact under either definition, within tolerance and display rounding. */
export function grade(h: Headline, f: Fact): 'correct' | 'wrong' | 'idk' | 'no_headline' {
  if (h.kind === 'idk') return 'idk';
  if (h.kind === 'none') return 'no_headline';
  const variants = [f.value, ...Object.values(f.value_variants ?? {})];
  if (h.kind === 'entity') {
    const names = new Set([...(f.accept_names ?? []), ...variants.map(String)].map((x) => x.toLowerCase()));
    return h.name && names.has(h.name.toLowerCase()) ? 'correct' : 'wrong';
  }
  // a mom pct derived from two rounded values carries their rounding; allow it in proportion
  const tol = Math.max(f.tolerance ?? 0, ...Object.values(f.tolerance_variants ?? {})) + (ROUNDING[f.unit] ?? 0) + (/_mom_pct$/.test(f.measure) ? 0.5 : 0) + 1e-9;
  return variants.some((x) => typeof x === 'number' && Math.abs(h.v - x) <= tol) ? 'correct' : 'wrong';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const store = loadPortfolioStore();
  const facts: Fact[] = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const tally = { correct: 0, wrong: 0, idk: 0, no_headline: 0, not_asked: 0 };
  const byMeasure: Record<string, Record<string, number>> = {};
  const rows: string[] = ['fact_id\tmeasure\tquestion\ttemplate\tgot\texpected\tgrade'];
  for (const f of facts) {
    const q = questionFor(f);
    const fam = f.measure.replace(/^rank_(max|min)_/, 'rank_');
    byMeasure[fam] ??= { correct: 0, wrong: 0, idk: 0, no_headline: 0, not_asked: 0 };
    if (!q) { tally.not_asked++; byMeasure[fam].not_asked++; continue; }
    const p = await askPanel(q, store);
    const h = headline(p.spec, f); const g = grade(h, f);
    tally[g]++; byMeasure[fam][g]++;
    rows.push([f.fact_id, f.measure, q, p.spec.template, h.kind === 'number' ? h.v : h.kind === 'entity' ? h.name : h.kind, JSON.stringify(f.value_variants ?? f.value), g].join('\t'));
  }
  if (tsvAt) fs.writeFileSync(tsvAt, rows.join('\n') + '\n');
  const asked = tally.correct + tally.wrong + tally.idk + tally.no_headline;
  if (args.includes('--json')) console.log(JSON.stringify({ file, tally, byMeasure }, null, 2));
  else {
    console.log(`${file}: ${facts.length} facts, ${asked} asked: correct ${tally.correct}, wrong ${tally.wrong}, IDK ${tally.idk}, no headline ${tally.no_headline}; not asked (no template) ${tally.not_asked}`);
    for (const [m, t] of Object.entries(byMeasure).sort()) console.log(`  ${m}: correct ${t.correct}, wrong ${t.wrong}, IDK ${t.idk}, no headline ${t.no_headline}${t.not_asked ? `, not asked ${t.not_asked}` : ''}`);
  }
}
