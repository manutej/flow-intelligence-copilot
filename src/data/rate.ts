/**
 * n/d as a percent with one decimal, rounding halves up. Uses integer
 * arithmetic so float error can't turn 28.75 into 28.7 (23/80).
 * Expects non-negative integer counts; returns 0 when d is 0.
 */
export function ratePercent1(n: number, d: number): number {
  if (d === 0) return 0;
  return Math.floor((2000 * n + d) / (2 * d)) / 10;
}
