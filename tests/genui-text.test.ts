// TENACITY VERDICT-GENUI-f0f6bdf N2/N3 (repros/genui-text-f0f6bdf.ts) as tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { askPanel } from '../src/genui/picker.ts';
import { specErrors } from '../src/genui/spec.ts';

process.env.GENUI_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'genui-text-'));
const store = loadPortfolioStore();
const p = await askPanel('At Fulton Yards, which listing source had the lowest cost per signed lease in Q3 2026, and what was it?', store);
const errs = (t: string) => { const s = structuredClone(p.spec) as any; s.insight = t; return specErrors(s, p.evidence, store); };

const REJECT = ['three units', 'There are 2025 leads', '1.2k leads', 'a dozen leads', 'twelve-hundred dollars', '2,025 leads', 'the 3rd source', '1st',
  'several hundred', 'zero', 'half', 'ten-fold', '10x', 'one-bedroom units', 'No. 1 source', '#1 source',
  // N2: unicode digits, roman numerals, fractions and quantity words
  'MMXXV leases', '１２ leases', 'Ⅻ leases', '٣ leases', 'x̄ ≈ ½ lease', 'first place', 'a couple of leads', 'a score of leases', 'nil leases', 'XII sources'];
const ACCEPT = ['Q3 2026 results', 'FY 2026', '2026-09-30', 'Sept 2026',
  // N3: bare years in a temporal context
  'In 2026, leases rose', 'Leases rose in 2026.', 'up since 2025', 'since 2025', '2026 YTD', 'during 2026', 'through 2026'];

test('N2: unicode digits, roman numerals, fractions and quantity words are figures', () => {
  for (const t of REJECT) assert.ok(errs(t).length > 0, `accepted: ${t}`);
});
test('N3: a bare year in a temporal context is a label, not a figure', () => {
  for (const t of ACCEPT) assert.deepEqual(errs(t), [], t);
});

// TENACITY VERDICT-GENUI-60e142a L1/L2 (non-blocking notes) as tests.
test('L1: a temporal year is exempt only at a clause end or before punctuation', () => {
  for (const t of ['during 2025 units sold', 'in 2026 units', 'in 1999 leases']) assert.ok(errs(t).length > 0, `accepted: ${t}`);
  for (const t of ['Leases rose in 2026.', 'since 2025', 'In 2026, leases rose', 'through 2026; then fell']) assert.deepEqual(errs(t), [], t);
});
test('L2: zero-width, accents, CJK, Cyrillic, any-case roman, currency signs and quantity words', () => {
  for (const t of ['t\u200bwelve leases', 'tw\u00adelve leases', 'twelvé leases', '三 leases', '十二 leases', 'Три лизинга', 'mmxxv leases', 'MmXxV leases',
    '¥ spend', '₹ spend', '٪ rate', 'dozens of leads', 'a pair of sources']) assert.ok(errs(t).length > 0, `accepted: ${t}`);
  for (const t of ['a mix of sources', 'Leads did improve', 'civil and mild']) assert.deepEqual(errs(t), [], t);
});

// TENACITY VERDICT-GENUI-7672cd4 M2: the server's own specs must pass the detector.
test('M2: intent ids are not text, and whole numeric tokens from the question (with $ % #) echo in titles', async () => {
  for (const q of ['What was H1 spend versus Q3 spend for Facebook Ads at class B buildings?',
    'At The Clarendon (P04) with prior beta0=$3250, in decisions.csv outcome learning, which channel ranks #1 with the lowest posterior CPSL, and what is its posterior CPSL in USD']) {
    const a = await askPanel(q, store);
    assert.deepEqual(a.errors, [], q); assert.notEqual(a.spec.state, 'error_data', q);
  }
  // the question states the policy prior ($3250), so it still charts; a different prior now
  // clarifies (59be53f HIGH), which is why this used $1800 before
  // the echo is the whole token only: a bare figure the question wrote with $ is still a figure
  const q = 'At The Clarendon (P04) with prior beta0=$3250, in decisions.csv outcome learning, which channel ranks #1 with the lowest posterior CPSL, and what is its posterior CPSL in USD';
  const a = await askPanel(q, store);
  const t = (title: string) => { const s = structuredClone(a.spec) as any; s.title = title; return specErrors(s, a.evidence, store); };
  assert.deepEqual(t('Prior $3250, ranked #1'), []);
  for (const bad of ['Prior 3250 leases', 'Prior $32500', 'Prior $3250.5', 'Prior 3250%', '#2 channel']) assert.ok(t(bad).length > 0, `accepted: ${bad}`);
});

// TENACITY VERDICT-GENUI-59be53f HIGH: a prior the user states is not applied by the learner
// (it always uses the policy beta0), so the panel must not chart policy-prior numbers under it.
test('HIGH: a stated prior that differs from the policy beta0 gives a clarify, never a chart', async () => {
  const policy = store.policy.priorSpendUsdBeta0;
  const base = (pr: string) => `At The Clarendon (P04) with ${pr}, in decisions.csv outcome learning, which channel ranks #1 with the lowest posterior CPSL, and what is its posterior CPSL in USD?`;
  for (const pr of ['prior beta0=$1800', 'prior beta0=$2026', 'a prior of 1800 dollars', 'beta0 of $1.8k', 'β0 = 1,800 USD']) {
    const a = await askPanel(base(pr), store);
    assert.equal(a.spec.template, 'clarify_card', pr); assert.deepEqual(a.errors, [], pr);
    assert.match(JSON.stringify(a.spec.props), new RegExp(`\\$${policy}`), pr);
  }
  const same = await askPanel(base(`prior beta0=$${policy}`), store);
  assert.notEqual(same.spec.template, 'clarify_card');
  const plain = await askPanel('At The Clarendon (P04), in decisions.csv outcome learning, which channel ranks #1 with the lowest posterior CPSL, and what is its posterior CPSL in USD?', store);
  assert.notEqual(plain.spec.template, 'clarify_card');
});
