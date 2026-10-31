// VERDICT-GENUI-r8 R8-1..R8-4 through the dashboard path (askPanel): periods are not attributes,
// dates, filler verbs and unit synonyms are known words, every unrecorded trait refuses with the
// refusal wording, and rent tenants pay is never answered with market rent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { askPanel } from '../src/genui/picker.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { personAttributeLookup } from '../src/domain/person-attributes.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const p = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/person-attribute-probes-r9.json'), 'utf8')) as Record<string, string[]>;
const store = loadPortfolioStore();
const spec = async (q: string) => (await askPanel(q, store)).spec as any;
const mode = (s: any) => (s.template === 'clarify_card' ? s.props?.mode : 'answer');
const collect = async (qs: string[], bad: (s: any) => boolean) => {
  const out: string[] = [];
  for (const q of qs) { const s = await spec(q); if (bad(s)) out.push(`${q} -> ${s.template}/${mode(s)}`); }
  return out;
};

test('R8-2: period tokens (Q3, H1, 2br) are never read as attributes', () => {
  assert.deepEqual(p.periods.filter((q) => personAttributeLookup(q, store) !== null), []);
});
test('R8-1: lookups answered at f7f01f3 are answered again', async () => {
  assert.deepEqual(await collect(p.restored_kpi, (s) => s.template !== 'kpi'), []);
  assert.deepEqual(await collect(p.restored_not_idk, (s) => mode(s) === 'refuse' || /holds no record of/.test(String(s.props?.restatement))), []);
});
test('R8-3: traits outside the category regexes refuse with the refusal wording', async () => {
  assert.deepEqual(await collect(p.refuse_wording, (s) => mode(s) !== 'refuse' || !/^Refused:/.test(String(s.props?.restatement))), []);
});
test('R8-4: rent tenants pay is not answered with market rent; market rent still is', async () => {
  assert.deepEqual(await collect(p.paid_rent, (s) => s.template !== 'clarify_card' && /market rent/i.test(JSON.stringify(s))), []);
  assert.deepEqual(await collect(p.market_rent, (s) => s.template !== 'kpi'), []);
});
