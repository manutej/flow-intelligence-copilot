// TENACITY VERDICT-GENUI-31c0507 as tests: the kit-rate note follows the CAD-billed row count,
// the offline guard covers http(s), sockets and DNS, and the joiner and vacancy paraphrases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { setRateProvider, type RateProvider } from '../src/fx/provider.ts';
import { askPanel } from '../src/genui/picker.ts';

process.env.GENUI_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'genui-r6-'));
const store = loadPortfolioStore();
const today = new Date().toISOString().slice(0, 10);
const fake: RateProvider = { name: 'Fake', rate: async (base, quote) => ({ ok: true, quote: { base, quote, rate: 1.4, source: 'Fake daily', asOf: today, basis: 'daily' } }) };
const answerOf = async (q: string) => { setRateProvider(fake); try { const p = await askPanel(q, store); return { p, a: String((p.spec as { answer?: string }).answer ?? '') }; } finally { setRateProvider(null); } };

test('MED: the kit-rate note appears only where CAD-billed rows exist', async () => {
  // spend.csv: Fulton Yards (P03) has no CAD rows in Q2 2026; Kedzie Works (P06) has three
  const none = await answerOf('Marketing spend in CAD at Fulton Yards in Q2 2026');
  assert.equal(none.p.spec.template, 'kpi');
  assert.doesNotMatch(none.a, /KIT_README|CAD-billed/);
  const some = await answerOf('Marketing spend in CAD at Kedzie Works in Q2 2026');
  assert.match(some.a, /CAD-billed rows .* 0\.73 USD \(KIT_README\)/);
  assert.doesNotMatch((await answerOf('Average market rent in CAD at Kedzie Works')).a, /KIT_README/, 'rent has no spend rows');
});

// node's own modules, loaded untyped (the repo carries no @types/node)
type Loose = Record<string, (...a: unknown[]) => { on(e: string, f: () => void): void; destroy(): void }>;
const builtin = (name: string) => import(`node:${name}`) as Promise<{ default: Loose }>;

test('LOW: http(s), sockets and DNS are blocked too, loopback is not', async () => {
  const [https, net, dns] = await Promise.all(['https', 'net', 'dns'].map(async (n) => (await builtin(n)).default));
  for (const f of [() => https.get('https://www.bankofcanada.ca/'), () => net.connect(443, 'api.frankfurter.app'), () => dns.lookup('example.com', () => undefined)])
    assert.throws(f, /network is disabled in tests/);
  const s = net.connect(9, '127.0.0.1'); s.on('error', () => {}); s.destroy();
});

test('LOW: "along with", "its" and "unit size" join two measures like "and"', async () => {
  for (const q of ["What is Kedzie Works' average market rent along with its average square footage?", 'What is the mean rent and unit size at Halsted & Lake?']) {
    const p = await askPanel(q, store);
    assert.equal(p.spec.template, 'kpi', q);
    const props = p.spec.template === 'kpi' ? p.spec.props : null;
    assert.equal(props?.secondary?.[0]?.label, 'average square footage', q);
  }
  assert.equal((await askPanel('What is the occupancy along with the renewal rate at Fulton Yards?', store)).spec.template, 'clarify_card');
});

test('LOW: "highest vacancy" reads as "highest vacancy rate"', async () => {
  const a = await askPanel('Which building has the highest vacancy?', store);
  const b = await askPanel('Which building has the highest vacancy rate?', store);
  assert.equal(a.spec.template, 'sorted_bar');
  assert.deepEqual(a.spec.template === 'sorted_bar' && a.spec.props.highlight, b.spec.template === 'sorted_bar' && b.spec.props.highlight);
});
