import { fileURLToPath } from 'node:url';
/**
 * Expectations computed from the pinned, dated CAD fixture (M-3), not
 * hard-coded to one rate. Reads data/ils/spend.csv directly, so it is an
 * oracle independent of the loader. Only P06 Facebook Ads is CAD.
 */
import { readFileSync } from 'node:fs';
import { PINNED_CAD_RATE } from '../../src/config/fx-pinned.ts';

export const FX = PINNED_CAD_RATE;
const rows = readFileSync(fileURLToPath(new URL('../../data/ils/spend.csv', import.meta.url)), 'utf8').trim().split(/\r?\n/).slice(1).map((l) => {
  const [id, month, pid, source, amount, currency, status] = l.trim().split(',');
  return { id, month, pid, source, amount: Number(amount), currency, status };
});

export interface SpendFilter { readonly from?: string; readonly to?: string; readonly pid?: string; readonly sources?: readonly string[] }

/** Posted spend in USD at the fixture rate, rounded to cents (half up). */
export function spendUsd(f: SpendFilter = {}, rate: number = FX.rate): number {
  const t = rows
    .filter((r) => r.status !== 'void' && r.pid !== 'P09' && (!f.from || r.month >= f.from) && (!f.to || r.month <= f.to) && (!f.pid || r.pid === f.pid) && (!f.sources || f.sources.includes(r.source)))
    .reduce((m, r) => m.set(`${r.pid}|${r.source}`, (m.get(`${r.pid}|${r.source}`) ?? 0) + r.amount * (r.currency === 'CAD' ? rate : 1)), new Map<string, number>());
  // Mirrors metrics.ts: each (building, source) pair is rounded to cents, then summed.
  return round2([...t.values()].reduce((a, v) => a + round2(v), 0));
}

export function round2(x: number): number { return Number(`${Math.round(Number(`${x}e2`))}e-2`); }

/** "$12,345.60" as the copilot prints it. */
export function usd(x: number): string { return `$${round2(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

/** A RegExp matching the printed dollar figure. */
export function usdRe(x: number): RegExp { return new RegExp(usd(x).replace(/[$.]/g, (c) => `\\${c}`)); }

export const cpl = (spend: number, leads: number) => round2(spend / leads);
