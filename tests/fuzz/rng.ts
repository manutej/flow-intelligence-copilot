/** Seeded PRNG (mulberry32) so a failing fuzz case replays from its seed. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  // Invented words start with a consonant pair no English word uses.
  const word = () =>
    'zq' + Array.from({ length: int(4, 9) }, (_, i) => (i % 2 ? 'aeiou' : 'bcdfghklmnprstvz')[int(0, i % 2 ? 4 : 15)]).join('');
  return { next, pick, int, word };
}

export const SEEDS = Array.from({ length: Number(process.env.FUZZ_SEEDS ?? 40) }, (_, i) => Number(process.env.FUZZ_SEED0 ?? 1) + i);
