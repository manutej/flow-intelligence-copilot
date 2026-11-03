/**
 * Live CAD rate for chat (M-3). The chat endpoint asks for today's rate
 * (frankfurter, ECB) and uses it, dated. When no live rate is available the
 * answer says so and names the pinned dated rate it used instead, rather
 * than falling back silently. An explicit what-if rate always wins.
 */
import { getLiveCadRate } from '../tools/fx-rate.ts';
import { PINNED_CAD_RATE } from '../config/fx-pinned.ts';
import type { PortfolioPolicyConfig } from '../config/rules.ts';

export type LiveCadStatus = 'live' | 'unavailable' | 'override' | 'fixed';

export async function liveCadOverrides(overrides: Partial<PortfolioPolicyConfig>): Promise<{ overrides: Partial<PortfolioPolicyConfig>; status: LiveCadStatus }> {
  if (overrides.cadToUsdRate !== undefined || process.env.FLOW_CAD_RATE) return { overrides, status: 'override' };
  const r = await getLiveCadRate();
  if (!r) return { overrides, status: 'unavailable' };
  return { overrides: { ...overrides, cadToUsdRate: r.rate, cadRateDate: r.rate_date, cadRateSource: `${r.source}, live` }, status: 'live' };
}

export const NO_LIVE_RATE_NOTE = `No live CAD rate was available, so CAD amounts use 1 CAD = ${PINNED_CAD_RATE.rate} USD (${PINNED_CAD_RATE.source}, ${PINNED_CAD_RATE.rate_date}).`;

/** Adds the no-live-rate note to an answer that converted CAD. */
export function noteCadStatus(answer: string, status: LiveCadStatus): string {
  return status === 'unavailable' && /\bCAD\b/.test(answer) && !answer.includes(NO_LIVE_RATE_NOTE) ? `${answer} ${NO_LIVE_RATE_NOTE}` : answer;
}
