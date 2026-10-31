// VERDICT-GENUI-r9 R9-1, R9-2, R9-4 through the dashboard path (askPanel), plus the T2 set of 21
// operational questions that name a protected-class word and must never refuse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { askPanel } from '../src/genui/picker.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const p = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/person-attribute-probes-r10.json'), 'utf8')) as Record<string, string[]>;
const t2 = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/t2-operational-21.json'), 'utf8')).questions as string[];
const store = loadPortfolioStore();
const mode = (s: any) => (s.template === 'clarify_card' ? s.props?.mode : 'answer');
const collect = async (qs: string[], bad: (s: any) => boolean) => {
  const out: string[] = [];
  for (const q of qs) { const s = (await askPanel(q, store)).spec as any; if (bad(s)) out.push(`${q} -> ${s.template}/${mode(s)}/${s.title}`); }
  return out;
};
const refuses = (s: any) => mode(s) === 'refuse' && /^Refused:/.test(String(s.props?.restatement));

test('R9-1: a protected-class match refuses even inside a staff or "from/among residents" sentence', async () => {
  assert.deepEqual(await collect(p.scoped_trait_refuse, (s) => !refuses(s)), []);
  assert.deepEqual(await collect(p.scoped_plain_ok, (s) => mode(s) === 'refuse'), []);
});
test('R9-2: age, religious dress and diet, and mental-health traits refuse', async () => {
  assert.deepEqual(await collect(p.trait_refuse, (s) => !refuses(s)), []);
});
test('R9-4: a computed answer shown without a chart is not labelled "Not in the connected data"', async () => {
  assert.deepEqual(await collect(p.uncharted_answer, (s) => s.title === 'Not in the connected data' && /\d+ signed leases/.test(String(s.props?.restatement))), []);
});
test('T2: none of the 21 operational questions refuses', async () => {
  assert.equal(t2.length, 21);
  assert.deepEqual(await collect(t2, (s) => mode(s) === 'refuse'), []);
});
