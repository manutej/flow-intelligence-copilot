/**
 * The unique extreme of a set of rows, in the direction asked. Rows whose value is not a
 * finite number take no part. When two or more rows share the extreme value there is no
 * winner (`winner` is null) and `tied` lists them all; callers name the tie, never a row
 * picked by input order.
 */
export interface Extreme<T> { readonly winner: T | null; readonly tied: readonly T[]; readonly best: number | null; readonly ranked: readonly T[] }
export function extreme<T>(rows: readonly T[], value: (r: T) => number | null | undefined, want: 'max' | 'min'): Extreme<T> {
  const ok = rows.filter((r) => { const v = value(r); return typeof v === 'number' && Number.isFinite(v); });
  const ranked = [...ok].sort((a, b) => (want === 'max' ? value(b)! - value(a)! : value(a)! - value(b)!));
  if (!ranked.length) return { winner: null, tied: [], best: null, ranked };
  const best = value(ranked[0])!;
  const tied = ranked.filter((r) => value(r) === best);
  return { winner: tied.length === 1 ? tied[0] : null, tied, best, ranked };
}
