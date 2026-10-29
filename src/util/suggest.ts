/**
 * "Did you mean" for commands, flags, MCP tools and arguments. A typo
 * should name the fix, not just the mistake.
 */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * The closest candidate within a third of the input's length (at least 2
 * edits), or undefined when nothing is close enough to be a typo.
 */
export function closest(input: string, candidates: readonly string[]): string | undefined {
  const needle = input.toLowerCase();
  const limit = Math.max(2, Math.floor(needle.length / 3));
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const d = editDistance(needle, candidate.toLowerCase());
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return bestDistance <= limit ? best : undefined;
}

/** `' (did you mean "ask"?)'` or an empty string. */
export function didYouMean(input: string, candidates: readonly string[]): string {
  const hit = closest(input, candidates);
  return hit ? ` (did you mean "${hit}"?)` : '';
}
