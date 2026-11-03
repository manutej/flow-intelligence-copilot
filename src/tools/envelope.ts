/**
 * Shared contract for FlowIQ calculation tools (FIQ-TOOLS-1 spec §1).
 * Every tool returns a ToolEnvelope; period.label is built only from the
 * window the tool actually summed (L-56).
 */
import type { CitationId } from '../data/schema.ts';

export type PeriodPreset = 'apr_sep_2026' | 'q2_2026' | 'q3_2026' | 'ytd' | 'month';
export type PeriodInput =
  | { readonly preset: PeriodPreset; readonly month?: string }
  | { readonly start_date: string; readonly end_date: string };

export interface PeriodOut {
  readonly label: string;
  readonly start: string;
  readonly end: string;
  readonly partial: boolean;
  readonly basis: string;
}

export interface FxOut {
  readonly applied: boolean;
  readonly rate: number;
  readonly rate_date: string | null;
  readonly source: string;
}

export interface ToolEnvelope<V> {
  readonly value: V | null;
  readonly period: PeriodOut | null;
  readonly fx: FxOut | null;
  readonly dedup: Readonly<Record<string, unknown>> | null;
  readonly unknown: boolean;
  readonly unknown_reason: string | null;
  readonly citations: readonly CitationId[];
}

/** The data window of the CRM and spend exports. */
export const DATA_START = '2026-04-01';
export const DATA_END = '2026-09-30';

/** Money is rounded half-up at output only, robust to float error. */
export function roundHalfUp(x: number, decimals = 2): number {
  const sign = x < 0 ? -1 : 1;
  const shifted = Number(`${Math.abs(x)}e${decimals}`);
  return sign * Number(`${Math.round(shifted)}e-${decimals}`);
}

export function periodLabel(start: string, end: string): string {
  return `${start} to ${end}`;
}

export function unknownEnvelope<V>(reason: string, period: PeriodOut | null = null): ToolEnvelope<V> {
  return { value: null, period, fx: null, dedup: null, unknown: true, unknown_reason: reason, citations: [] };
}
