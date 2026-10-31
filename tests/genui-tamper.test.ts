// TENACITY VERDICT-GENUI-58cc925 probes (repros/genui-probe-58cc925.ts) as tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPortfolioStore } from '../src/data/loader.ts';
import * as pickerMod from '../src/genui/picker.ts';
const { askPanel } = pickerMod;
import * as specMod from '../src/genui/spec.ts';
import { hashOf } from '../src/agent/envelope.ts';
import { executeCompositionalPlan } from '../src/agent/planner.ts';
import { DATE_WINDOWS } from '../src/config/rules.ts';

process.env.GENUI_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'genui-tamper-'));
const store = loadPortfolioStore();
const Q03 = 'At Fulton Yards, which listing source had the lowest cost per signed lease in Q3 2026, and what was it?';
const KPI = 'How many vacant units are at Fulton Yards?';
const REC = fs.readFileSync('tests/fixtures/genui-templates-extra.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((l) => l.expected_template === 'recommendation_card').text;
const panelErrors = (pickerMod as any).panelErrors as ((q: string, s: unknown, st: unknown) => Promise<string[]>) | undefined;

test('N1: a breakdown item forged consistently (recipe, result, hash, spec) is rejected', async () => {
  const a = await askPanel(Q03, store);
  const sub: any = a.evidence.items.find((i: any) => i.key !== 'main' && i.recipe?.intent?.dateWindow);
  assert.ok(sub, 'Q03 has a breakdown item');
  const alt = { ...sub.recipe.intent, dateWindow: (DATE_WINDOWS as any)[sub.recipe.intent.dateWindow.key === 'Q3_2026' ? 'Q2_2026' : 'Q3_2026'] };
  const env = executeCompositionalPlan({ id: sub.key, type: 'adhoc', question: sub.recipe.question } as never, store, { intent: alt }).envelope;
  const k = Object.keys(sub.result).find((x) => typeof sub.result[x] === 'number' && typeof (env.result as any)[x] === 'number' && (env.result as any)[x] !== sub.result[x])!;
  assert.ok(k, 'the other window gives a different value');
  const ev: any = structuredClone(a.evidence); const it = ev.items.find((i: any) => i.key === sub.key);
  it.result = env.result; it.result_hash = hashOf(env.result); it.recipe = { question: sub.recipe.question, intent: alt };
  const ref = `"ref":"items.${sub.key}.result.${k}"`;
  const spec = JSON.parse(JSON.stringify(a.spec).replaceAll(`"v":${sub.result[k]},${ref}`, `"v":${(env.result as any)[k]},${ref}`));
  assert.ok(panelErrors, 'panelErrors exists');
  assert.ok((await panelErrors!(Q03, spec, store)).length > 0);
  assert.deepEqual(await panelErrors!(Q03, a.spec, store), []);
});

test('N3: numbers in words, year-shaped counts and figures in unit are rejected; real periods pass', async () => {
  const p = await askPanel(KPI, store);
  const tryText = (t: string) => { const s = structuredClone(p.spec) as any; s.insight = t; return specMod.specErrors(s, p.evidence, store); };
  assert.ok(tryText('Only three units are vacant, about twelve hundred dollars each').length > 0);
  assert.ok(tryText('There are 2025 leads here').length > 0);
  assert.deepEqual(tryText('Vacancy in September 2026'), []);
  assert.deepEqual(tryText('Leasing in Q3 2026 vs H1 2026, 2026-04 to 2026-09'), []);
  const u = structuredClone(p.spec) as any; u.props.unit = 'leases (up 40% to 9,000)';
  assert.ok(specMod.specErrors(u, p.evidence, store).length > 0);
});

async function boot() {
  const { createServer } = await import('../src/genui/server.ts');
  const srv = createServer().listen(0, '127.0.0.1');
  await new Promise<void>((r) => srv.once('listening', () => r()));
  const port = (srv.address() as { port: number }).port; const base = `http://127.0.0.1:${port}`;
  const html = await (await fetch(base + '/')).text();
  const token = html.match(/name="genui-csrf" content="([^"]+)"/)?.[1] ?? '';
  const post = (u: string, body: unknown, h: Record<string, string> = {}) => fetch(base + u, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, 'x-genui-csrf': token, ...h }, body: JSON.stringify(body) });
  return { srv, base, token, post };
}

test('N2: POSTs need JSON, a same Origin and the CSRF token', async () => {
  const { srv, post } = await boot();
  try {
    const q = { question: KPI };
    assert.equal((await post('/api/ask', q, { 'content-type': 'text/plain' })).status, 415);
    assert.equal((await post('/api/ask', q, { origin: 'http://evil.example' })).status, 403);
    assert.equal((await post('/api/ask', q, { 'x-genui-csrf': 'wrong' })).status, 403);
    assert.equal((await post('/api/ask', q)).status, 200);
  } finally { srv.close(); }
});

test('N2: a forged panel cannot be saved or drafted; N8: drafts are idempotent and spec-hash keyed', async () => {
  const { srv, post } = await boot();
  try {
    const p = await (await post('/api/ask', { question: REC })).json();
    const forged = structuredClone(p); forged.id = 'forged'; forged.spec.props.impacts[0].value.v = 9999;
    assert.equal((await post('/api/panels', forged)).status, 422);
    assert.equal((await post('/api/actions', { panel_id: 'forged' })).status, 400);
    assert.equal((await post('/api/panels', p)).status, 200);
    const d1 = await (await post('/api/actions', { panel_id: p.id })).json();
    const d2 = await (await post('/api/actions', { panel_id: p.id })).json();
    assert.match(d1.id, /^D-[0-9a-f]{12}$/);
    assert.equal(d2.id, d1.id);
    assert.equal(d1.cites[0].value, p.spec.props.impacts[0].value.v);
  } finally { srv.close(); }
});

test('panelErrors takes no caller evidence and checks specs against fresh evidence only', async () => {
  assert.equal(panelErrors!.length, 3);
  const a = await askPanel(Q03, store);
  assert.deepEqual(await panelErrors!(Q03, a.spec, store), []);
  const s = structuredClone(a.spec) as any; s.insight = 'Only 3 units are vacant here';
  const errs = await panelErrors!(Q03, s, store);
  assert.ok(errs.some((e) => !/differs/.test(e)), 'structural text rule runs, not only the spec diff');
});
