/**
 * Tool router (FIQ-TOOLS-1): questions the planner has no measure for but a
 * calc tool does, plus the §4 declines. Runs after the Fair Housing refusal
 * and the unknown-data guard, before the planner. Returns null to fall
 * through.
 */
import type { CitationId, PortfolioStore } from '../data/schema.ts';
import { resolvePropertiesFromText } from '../domain/resolver.ts';
import { revenue } from './revenue.ts';

export interface RoutedAnswer { readonly answer: string; readonly result: Record<string, unknown>; readonly citations: readonly CitationId[]; readonly tool: string }

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Filters the revenue tool cannot apply; such a question falls through to the planner. */
const REVENUE_FILTER_RE = /\d|\bbed|\bbath|\bfloor|\bsq|\bclass\b|\bview\b|\bq[1-4]\b|\bquarter|\bmonth\b(?!ly)|\bin\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\bby\s+(?:building|property|source)|\bnoi\b|\bnet\b|\bcollect|\bdelinquen/i;

export function routeToolQuestion(question: string, store: PortfolioStore): RoutedAnswer | null {
  const q = question.normalize('NFKC');
  const rr = /\brent\s+roll\b|\b(?:monthly\s+)?revenue\b|\bgross\s+rent\b/i.test(q);
  const ltv = /\bloss\s+to\s+vacancy\b|\bvacancy\s+loss\b|\bwhat\s+(?:does\s+)?vacancy\s+cost/i.test(q);
  const eff = /\beffective\s+rent\b/i.test(q);
  if (!(rr || ltv || eff) || REVENUE_FILTER_RE.test(q)) return null;
  const named = resolvePropertiesFromText(store, q).matched;
  if (named.length > 1) return null;
  const pid = named[0]?.propertyId;
  const t = revenue(store, pid ? { property_id: pid } : {});
  if (t.unknown || !t.value) return null;
  const v = t.value;
  const where = named[0] ? `At ${named[0].name} (${named[0].propertyId})` : 'Across the operating portfolio';
  const parts: string[] = [];
  const result: Record<string, unknown> = {};
  if (rr) { parts.push(`the rent roll is ${usd(v.rent_roll_monthly)} a month (in-place rent on occupied and notice units)`); result.rent_roll_usd = v.rent_roll_monthly; }
  if (eff) { parts.push(`effective rent after concessions is ${usd(v.effective_rent_monthly)} a month (concessions spread over each lease term)`); result.effective_rent_usd = v.effective_rent_monthly; }
  if (ltv) { parts.push(`loss to vacancy is ${usd(v.loss_to_vacancy_monthly)} a month (market rent of vacant units)`); result.loss_to_vacancy_usd = v.loss_to_vacancy_monthly; }
  if (pid) result.property_id = pid;
  return { answer: `${where}, ${parts.join("; ")}, as of ${store.policy.asOfDate}.`, result, citations: t.citations, tool: 'revenue' };
}
