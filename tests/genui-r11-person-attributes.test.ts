// VERDICT-GENUI-r10 R10-1, R10-2 through the dashboard path (askPanel): a class word that modifies
// a staff noun or a data measure describes a thing and asks a clarifying question instead of
// refusing; the trait itself still refuses; age ranges in general forms refuse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { askPanel } from '../src/genui/picker.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const p = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/person-attribute-probes-r11.json'), 'utf8')) as Record<string, string[]>;
const store = loadPortfolioStore();
const mode = (s: any) => (s.template === 'clarify_card' ? s.props?.mode : 'answer');
const collect = async (qs: string[], bad: (s: any) => boolean) => {
  const out: string[] = [];
  for (const q of qs) { const s = (await askPanel(q, store)).spec as any; if (bad(s)) out.push(`${q} -> ${s.template}/${mode(s)}/${s.title}`); }
  return out;
};
const refuses = (s: any) => mode(s) === 'refuse' && /^Refused:/.test(String(s.props?.restatement));

test('R10-1: a class word modifying a staff noun or a measure clarifies, never refuses', async () => {
  assert.deepEqual(await collect(p.modifier_clarify, (s) => mode(s) !== 'clarify'), []);
});
test('R10-1: the same words as traits of people still refuse', async () => {
  assert.deepEqual(await collect(p.trait_still_refuses, (s) => !refuses(s)), []);
});
test('R10-2: age ranges by decade, "N or older" and "aged N and over" refuse', async () => {
  assert.deepEqual(await collect(p.age_general, (s) => !refuses(s)), []);
});
