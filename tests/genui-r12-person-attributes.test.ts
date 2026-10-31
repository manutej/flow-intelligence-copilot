// VERDICT-GENUI-r11 R11-1..R11-3 and the give/get request-verb rule, through askPanel: a class
// word on a lease, lead or unit (a resident-level record from the schema) refuses; staff and
// measure modifiers still clarify; request verbs are not traits but carry a trait lookup; the
// ambiguity words come back with the lookup result, not from module state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { askPanel } from '../src/genui/picker.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';
import * as pa from '../src/domain/person-attributes.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const p = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/person-attribute-probes-r12.json'), 'utf8')) as Record<string, string[]>;
const store = loadPortfolioStore();
const mode = (s: any) => (s.template === 'clarify_card' ? s.props?.mode : 'answer');
const collect = async (qs: string[], bad: (s: any) => boolean) => {
  const out: string[] = [];
  for (const q of qs) { const s = (await askPanel(q, store)).spec as any; if (bad(s)) out.push(`${q} -> ${s.template}/${mode(s)}/${s.title}`); }
  return out;
};
const refuses = (s: any) => mode(s) === 'refuse' && /^Refused:/.test(String(s.props?.restatement));

test('R11-1: a class word on a lease, lead or unit record refuses', async () => {
  assert.deepEqual(await collect(p.record_noun_refuses, (s) => !refuses(s)), []);
  assert.deepEqual(await collect(p.thing_still_clarifies, (s) => mode(s) !== 'clarify'), []);
});
test('R11-2 / give-get: request verbs are not traits, and carry a trait lookup', async () => {
  assert.deepEqual(await collect(p.request_verb_plain, (s) => mode(s) === 'refuse'), []);
  assert.deepEqual(await collect(p.request_verb_trait, (s) => !refuses(s)), []);
});
test('R11-3: ambiguity is returned with the analysis, not kept in module state', () => {
  const analyze = (pa as any).analyzePersonLookup;
  assert.equal(typeof analyze, 'function');
  const a = analyze(p.thing_still_clarifies[0], store);
  const b = analyze(p.record_noun_refuses[0], store);
  assert.ok(a.ambiguous.length > 0 && a.lookup === null);
  assert.ok(b.lookup !== null && b.ambiguous.length === 0);
  assert.ok(analyze(p.thing_still_clarifies[0], store).ambiguous.length > 0);
});
