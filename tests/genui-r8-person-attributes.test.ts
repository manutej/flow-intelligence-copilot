// VERDICT-GENUI-r7 R7-1..R7-3: a person lookup filtered on an attribute that is not a real
// column or data value refuses (when a protected category names it) or answers IDK, through the
// dashboard path (askPanel) and the server (/api/ask), not only the classifier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { askPanel } from '../src/genui/picker.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const probes = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/person-attribute-probes-r8.json'), 'utf8')) as Record<'refuse' | 'idk' | 'not_refused' | 'voucher', string[]>;
const r7 = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/fh-identification-probes-r7.json'), 'utf8')) as { refuse: string[]; answer: string[] };
const store = loadPortfolioStore();

type Outcome = 'refuse' | 'idk-attr' | 'help' | 'answer';
const outcomeOf = (spec: any): Outcome => {
  if (spec?.template !== 'clarify_card') return 'answer';
  if (spec.props?.mode === 'refuse') return 'refuse';
  if (spec.props?.mode === 'unknown' && /holds no record of/.test(String(spec.props?.restatement))) return 'idk-attr';
  return 'help';
};
const panel = async (q: string) => outcomeOf((await askPanel(q, store)).spec);
const misses = async (qs: string[], ok: (o: Outcome) => boolean) => {
  const out: string[] = [];
  for (const q of qs) { const o = await panel(q); if (!ok(o)) out.push(`${q} -> ${o}`); }
  return out;
};

test('R7-1: trait lookups refuse on the dashboard path', async () => {
  assert.deepEqual(await misses(probes.refuse, (o) => o === 'refuse'), []);
});
test('R7-3: lookups on an attribute no export records answer IDK, naming it', async () => {
  assert.deepEqual(await misses(probes.idk, (o) => o === 'idk-attr' || o === 'refuse'), []);
});
test('T2: real-column lookups and operational questions are not refused', async () => {
  assert.deepEqual(await misses(probes.not_refused, (o) => o !== 'refuse'), []);
});
test('T4: voucher questions still refuse on the dashboard path', async () => {
  assert.deepEqual(await misses(probes.voucher, (o) => o === 'refuse'), []);
});
test('R7-2: the r7 fixture through askPanel: lookups never get the help card or an answer; descriptive uses are not refused', async () => {
  assert.deepEqual(await misses(r7.refuse, (o) => o === 'refuse' || o === 'idk-attr'), []);
  assert.deepEqual(await misses(r7.answer, (o) => o !== 'refuse'), []);
});
test('R7-2: /api/ask returns the same refusal and IDK as askPanel', async () => {
  const { createServer } = await import('../src/genui/server.ts');
  const srv = createServer().listen(0, '127.0.0.1');
  await new Promise<void>((r) => srv.once('listening', () => r()));
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  try {
    const token = (await (await fetch(base + '/')).text()).match(/name="genui-csrf" content="([^"]+)"/)![1];
    const ask = async (question: string) => outcomeOf((await (await fetch(base + '/api/ask', { method: 'POST', headers: { 'content-type': 'application/json', origin: base, 'x-genui-csrf': token }, body: JSON.stringify({ question }) })).json()).spec);
    const bad: string[] = [];
    for (const q of probes.refuse.slice(0, 6)) if ((await ask(q)) !== 'refuse') bad.push(q);
    for (const q of probes.idk.slice(0, 3)) if (!['idk-attr', 'refuse'].includes(await ask(q))) bad.push(q);
    for (const q of probes.not_refused.slice(0, 3)) if ((await ask(q)) === 'refuse') bad.push(q);
    assert.deepEqual(bad, []);
  } finally { srv.close(); }
});
