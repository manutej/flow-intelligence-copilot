// TENACITY 2fd5c2a paraphrase probes, written 2026-10-31 before the fix was looked at or run.
// They include the verdict's own paraphrases (findings 1, 3) and new ones in other shapes, so
// the currency and two-measure guards are measured on wording they were not written from.
// Also the MEDs (5: breakdown text, 6: rankings name their winner) and LOWs (alias, did-you-mean).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { askPanel } from '../src/genui/picker.ts';
import type { ChartSpec } from '../src/genui/spec.ts';
import { setRateProvider, type RateProvider } from '../src/fx/provider.ts';

const store = loadPortfolioStore();
const text = (s: ChartSpec) => JSON.stringify(s);

// any currency other than USD, anywhere in a spend question
const CURRENCY = [
  'How much CAD spend did we have in Q2 2026?',
  'Total marketing spend in Q2 2026 (CAD)?',
  'What was total marketing spend billed in CAD at Fulton Yards in Q2 2026?',
  'What was spend in Canadian dollars at Kedzie Works in April 2026?',
  'Canadian-dollar marketing spend at Wabash Point in Q2 2026?',
  'Spend in C$ at Fulton Yards in Q2 2026?',
  'Marketing spend at Fulton Yards in Q2 2026 in EUR?',
  'Show me Q2 2026 marketing spend in €.',
  'Q2 2026 marketing spend, GBP please.',
  'How much did we spend in MXN in April 2026?',
  'CAD marketing spend at The Clarendon in Q2 2026?',
  'What was marketing spend at Halsted & Lake in Q2 2026, in CHF?',
  'Spend at Kedzie Works in Q2 2026 expressed in ¥?',
];
const CURRENCY_OK = [
  'What was total marketing spend in USD at Fulton Yards in Q2 2026?',
  'What was total marketing spend at Fulton Yards in Q2 2026 in $?',
  'What was total marketing spend at Fulton Yards in Q2 2026?',
];
// Manu's ruling (2026-10-31 10:56): "in CAD" converts and "billed in CAD" filters the currency
// column; a failed rate lookup is a typed IDK. These cases were written as clarifies before the
// ruling and updated to it; the paraphrases themselves are unchanged. The rate comes from a fake
// provider (no network): CAD and EUR answer, any other code fails.
const today = new Date().toISOString().slice(0, 10);
const RATES: Record<string, number> = { CAD: 1.3962, EUR: 0.9187 };
const fake: RateProvider = { name: 'Fake', rate: async (base, quote) => RATES[quote]
  ? { ok: true, quote: { base, quote, rate: RATES[quote], source: 'Fake Bank', asOf: today, basis: 'daily' } }
  : { ok: false, reason: 'lookup_failed', detail: 'no such pair in the fake', source: 'Fake Bank' } };
const kpi = (s: ChartSpec) => s as Extract<ChartSpec, { template: 'kpi' }>;
test('currency paraphrases never answer with the bare USD figure', async () => {
  setRateProvider(fake);
  try {
    for (const q of CURRENCY) {
      const p = await askPanel(q, store);
      assert.deepEqual(p.errors, [], q);
      if (p.spec.template === 'kpi') {
        const k = kpi(p.spec);
        assert.notEqual(k.props.unit, '$', q);
        assert.ok(k.props.fx, q);
        if (k.props.fx!.as_of) {
          // converted by the tool: value = USD x rate, the USD figure and the rate shown beside it
          const usd = k.props.secondary![0].value.v;
          assert.equal(k.props.value.v, Math.round(usd * RATES[k.props.unit!] * 100) / 100, q);
          assert.match(k.props.fx!.rate_label, /^Fake Bank, daily rate as of \d{4}-\d{2}-\d{2}$/, q);
        }
      } else {
        assert.equal(p.spec.template, 'clarify_card', q);
        assert.match(text(p.spec), /No usable USD to [A-Z]{3} rate|Nothing billed in|converts or filters one/, q);
      }
    }
    // the shapes, one each
    const conv = kpi((await askPanel('How much CAD spend did we have in Q2 2026?', store)).spec);
    assert.equal(conv.props.unit, 'CAD'); assert.equal(conv.props.fx!.source, 'Fake Bank');
    const eur = kpi((await askPanel('Marketing spend at Fulton Yards in Q2 2026 in EUR?', store)).spec);
    assert.equal(eur.props.unit, 'EUR');
    assert.match(text((await askPanel('Q2 2026 marketing spend, GBP please.', store)).spec), /No usable USD to GBP rate \(Fake Bank: lookup failed\).*never falls back/);
    assert.match(text((await askPanel('What was total marketing spend billed in CAD at Fulton Yards in Q2 2026?', store)).spec), /Nothing billed in CAD/);
    const billed = kpi((await askPanel('What was total marketing spend billed in CAD at Kedzie Works in Q2 2026?', store)).spec);
    assert.equal(billed.props.value.v, 2250); assert.equal(billed.props.unit, 'CAD'); assert.equal(billed.props.fx!.as_of, null);
    // USD or no currency is never converted; "in $" still restates (the bare "$" in the title
    // trips the figure rule), which is a separate, known limitation
    for (const q of CURRENCY_OK) {
      const sp = (await askPanel(q, store)).spec;
      if (q.endsWith('in $?')) { assert.equal(sp.template, 'clarify_card', q); continue; }
      assert.equal(kpi(sp).props.unit, '$', q);
    }
  } finally { setRateProvider(null); }
});

// two distinct measures, in any arrangement
const TWO = [
  'What is the vacancy rate and renewal rate at Fulton Yards?',
  'What is the vacancy rate and the renewal rate at Fulton Yards?',
  'Give me vacancy rate, renewal rate for Fulton Yards.',
  'What is the occupancy at Fulton Yards along with its renewal rate?',
  'What is the renewal rate at Fulton Yards together with vacancy?',
  "What's the occupancy rate and average market rent at The Clarendon?",
  'How many leads and tours at Kedzie Works in Q2 2026?',
  'Show me both vacancy and renewal rate at Wabash Point.',
  'What was the cost per lead and cost per tour for Zillow in April 2026?',
  'Marketing spend plus leads at Fulton Yards in Q2 2026?',
  'Renewal rate at Fulton Yards, and what about occupancy?',
  'For Halsted & Lake, how many vacant units, and what is the renewal rate?',
];
const ONE = [
  'What is the renewal rate at Fulton Yards?',
  'What is the vacancy rate at Fulton Yards?',
  'What is the occupancy at Halsted & Lake?',
  'How many leads did Fulton Yards get in Q2 2026?',
  'What was the cost per lead from Zillow in April 2026?',
  'What was total marketing spend at Fulton Yards in Q2 2026?',
  'What is the average market rent and square footage at Fulton Yards?',
];
test('two-measure paraphrases clarify; one measure and compound measures answer', async () => {
  for (const q of TWO) {
    const s = (await askPanel(q, store)).spec;
    assert.equal(s.template, 'clarify_card', q);
    // an answer the engine already declined (an IDK) keeps its own reason; an answered one
    // never charts one of the two measures
    if ((s.props as { mode?: string }).mode === 'unknown' && !/two measures/.test(text(s))) assert.match(text(s), /I don't know|Try a question about/, q);
    else assert.match(text(s), /two measures/, q);
  }
  for (const q of ONE) assert.notEqual((await askPanel(q, store)).spec.template, 'clarify_card', q);
});

test('"end ... and ... renewed" is the ending-and-renewed measure, both counts', async () => {
  for (const q of ['How many leases end in Q3 2026 and how many have renewed?', 'How many leases ending in Q3 2026 have renewed, and how many end?']) {
    const s = (await askPanel(q, store)).spec;
    assert.match(s.intent, /ending_and_renewed/, q);
    assert.match(s.answer ?? '', /end in .* and \d+ of them have renewed/, q);
  }
});

test('(5) a breakdown panel never shows an unlabelled pooled figure', async () => {
  for (const q of ['What was the cost per tour per source in Q2 2026?', 'Cost per lead by source at Kedzie Works in Q3?', 'What is the vacancy rate by building?', 'What was total marketing spend for each building in Q2 2026?']) {
    const s = (await askPanel(q, store)).spec;
    assert.equal(s.template, 'sorted_bar', q);
    assert.match(s.answer ?? '', /^Overall/, q);
  }
});

test('(6) rankings name the highlighted building in the text', async () => {
  for (const q of ['Which building had the highest renewal rate?', 'Which building had the lowest renewal rate?', 'Which building had the highest average market rent?', 'Which building had the lowest 2-bedroom average market rent?', 'Which building had the most leases started in September 2026?', 'Which property has the best renewal rate?']) {
    const s = (await askPanel(q, store)).spec as Extract<ChartSpec, { template: 'sorted_bar' }>;
    assert.equal(s.template, 'sorted_bar', q);
    assert.equal(s.props.highlight.length, 1, q);
    assert.ok((s.answer ?? '').includes(s.props.highlight[0]), `${q}: ${s.answer}`);
  }
});

test('LOW: alias misspellings name alias and building; a misspelt full name is caught', async () => {
  assert.match(text((await askPanel('Vacancy rate at Logan Lfots?', store)).spec), /Logan Lofts \(Kedzie Works\)/);
  for (const q of ['Vacancy rate at Marlowe Residenecs?', 'How many leads did Marlowe Resdences get in Q2 2026?'])
    assert.match(text((await askPanel(q, store)).spec), /nearest name is Marlowe Residences/, q);
});
