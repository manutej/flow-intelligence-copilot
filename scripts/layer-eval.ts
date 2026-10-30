// Per-layer eval: one score per layer of the frame, so a gain in one layer
// cannot hide a loss in another.
//   L1 query intent      NL -> typed query; accuracy and wrong-number count
//   L2 fair housing      refusal precision and recall (refuse = positive)
//   L3 evidence          forged envelopes rejected, true envelopes kept
// Usage: node --no-warnings scripts/layer-eval.ts [--json]
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { verifyAnswerEnvelope } from '../src/domain/guards.ts';
import { L1_CASES } from '../tests/fixtures/layers/l1-cases.ts';
import { L2_CASES } from '../tests/fixtures/layers/l2-cases.ts';
import { askedFor, L3_CASES } from '../tests/fixtures/layers/l3-cases.ts';
import { typedQuery } from '../src/agent/recompute.ts';
const noQuery = process.argv.includes('--no-query');

const store = loadPortfolioStore();
const verbose = process.argv.includes('--verbose');
const misses: string[] = [];

function claimedNumber(r: Record<string, unknown>): number | undefined {
  for (const k of ['sqft', 'usd', 'count']) if (typeof r[k] === 'number') return r[k] as number;
  return undefined;
}

let l1Correct = 0;
let l1Wrong = 0;
for (const c of L1_CASES) {
  const t = await askFlowIqCopilot(c.q, { store });
  const r = t.envelope.result as Record<string, unknown>;
  const n = r.unknown ? undefined : claimedNumber(r);
  const want = c.oracle?.(store);
  let ok: boolean;
  if (n === undefined) ok = c.oracle === null || c.unknownOk === true;
  else {
    ok = want !== undefined && Math.abs(n - want) <= 0.051;
    if (!ok) l1Wrong++;
  }
  if (ok) l1Correct++;
  else misses.push(`L1 ${JSON.stringify(c.q)} -> ${n ?? 'unknown'} want ${want ?? 'unknown'}`);
}

let tp = 0, fp = 0, fn = 0, tn = 0;
for (const [k, q] of L2_CASES) {
  if (k === 'O') continue;
  const t = await askFlowIqCopilot(q, { store });
  const refused = (t.envelope.result as Record<string, unknown>).refused === true;
  if (k === 'R') refused ? tp++ : (fn++, misses.push(`L2 miss  ${JSON.stringify(q)}`));
  else refused ? (fp++, misses.push(`L2 false ${JSON.stringify(q)}`)) : tn++;
}

let l3Rejected = 0, l3Forged = 0, l3Kept = 0, l3True = 0;
for (const [k, name, env] of L3_CASES) {
  let valid: boolean;
  try { valid = verifyAnswerEnvelope(noQuery ? env : { ...env, query: env.query ?? typedQuery(askedFor(env.answer), store) }, store).valid; } catch { valid = false; }
  if (k === 'T') { l3True++; if (valid) l3Kept++; else misses.push(`L3 false reject ${name}`); }
  else { l3Forged++; if (!valid) l3Rejected++; else misses.push(`L3 forged ok ${name}`); }
}

const pct = (a: number, b: number) => (b === 0 ? 1 : a / b);
const scores = {
  L1_intent: { accuracy: pct(l1Correct, L1_CASES.length), correct: l1Correct, total: L1_CASES.length, wrong_numbers: l1Wrong },
  L2_fair_housing: { precision: pct(tp, tp + fp), recall: pct(tp, tp + fn), tp, fp, fn, tn },
  L3_provenance: { forgery_rejection: pct(l3Rejected, l3Forged), true_kept: pct(l3Kept, l3True), rejected: l3Rejected, forged: l3Forged, kept: l3Kept, true: l3True },
};
if (process.argv.includes('--json')) console.log(JSON.stringify(scores));
else {
  const f = (x: number) => `${(100 * x).toFixed(1)}%`;
  console.log(`L1 intent     accuracy ${f(scores.L1_intent.accuracy)} (${l1Correct}/${L1_CASES.length}), wrong numbers ${l1Wrong}`);
  console.log(`L2 fair hous. precision ${f(scores.L2_fair_housing.precision)} recall ${f(scores.L2_fair_housing.recall)} (tp ${tp} fp ${fp} fn ${fn} tn ${tn})`);
  console.log(`L3 provenance forgery rejection ${f(scores.L3_provenance.forgery_rejection)} (${l3Rejected}/${l3Forged}), true kept ${l3Kept}/${l3True}`);
  if (verbose) for (const m of misses) console.log('  ' + m);
}

// L2 on probes written after the rules, never tuned against.
const { L2_UNSEEN } = await import('../tests/fixtures/layers/l2-unseen.ts');
let utp = 0, ufp = 0, ufn = 0;
const unseenMiss: string[] = [];
for (const [k, q] of L2_UNSEEN) {
  const t = await askFlowIqCopilot(q, { store });
  const refused = (t.envelope.result as Record<string, unknown>).refused === true;
  if (k === 'R') refused ? utp++ : (ufn++, unseenMiss.push(`miss  ${q}`));
  else if (refused) { ufp++; unseenMiss.push(`false ${q}`); }
}
console.log(`L2 unseen     precision ${(100 * utp / Math.max(1, utp + ufp)).toFixed(1)}% recall ${(100 * utp / Math.max(1, utp + ufn)).toFixed(1)}% (tp ${utp} fp ${ufp} fn ${ufn})`);
if (verbose) for (const m of unseenMiss) console.log('  L2u ' + m);

// L1 on probes written after the coverage rules, never tuned against.
const { L1_UNSEEN } = await import('../tests/fixtures/layers/l1-unseen.ts');
let u1 = 0, u1Wrong = 0;
for (const c of L1_UNSEEN) {
  const t = await askFlowIqCopilot(c.q, { store });
  const r = t.envelope.result as Record<string, unknown>;
  const n = r.unknown ? undefined : claimedNumber(r);
  const want = c.oracle?.(store);
  const ok = n === undefined ? c.oracle === null || c.unknownOk === true : want !== undefined && Math.abs(n - want) <= 0.051;
  if (ok) u1++; else { if (n !== undefined) u1Wrong++; if (verbose) console.log(`  L1u ${JSON.stringify(c.q)} -> ${n ?? 'unknown'} want ${want ?? 'unknown'}`); }
}
console.log(`L1 unseen     accuracy ${(100 * u1 / L1_UNSEEN.length).toFixed(1)}% (${u1}/${L1_UNSEEN.length}), wrong numbers ${u1Wrong}`);
