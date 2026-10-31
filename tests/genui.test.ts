import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { askPanel, intentGate, coreQuestion } from '../src/genui/picker.ts';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { hashOf } from '../src/agent/envelope.ts';
import { specErrors, type ChartSpec } from '../src/genui/spec.ts';

process.env.GENUI_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'genui-test-'));
const store = loadPortfolioStore();
const labels = fs.readFileSync('tests/fixtures/genui-templates-extra.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('genui: every extra fixture picks its labelled template with zero fidelity errors', async () => {
  for (const l of labels) {
    const p = await askPanel(l.text, store);
    assert.equal(p.spec.template, l.expected_template, l.id);
    assert.deepEqual(specErrors(p.spec, p.evidence, store), [], l.id);
  }
});

test('genui: the validator rejects a forged number, a bare number and a figure in prose', async () => {
  const p = await askPanel(labels.find((l) => l.expected_template === 'kpi').text, store);
  const s = JSON.parse(JSON.stringify(p.spec)) as ChartSpec & { props: { value: { v: number } } };
  s.props.value.v += 1;
  assert.ok(specErrors(s, p.evidence, store).length > 0);
  const bare = JSON.parse(JSON.stringify(p.spec)); bare.props.value = 5;
  assert.ok(specErrors(bare, p.evidence, store).length > 0);
  const prose = JSON.parse(JSON.stringify(p.spec)); prose.subtitle = 'up 12.5% on last month';
  assert.ok(specErrors(prose, p.evidence, store).length > 0);
});

test('genui G1: a x10 tamper of spec and evidence with a fresh hash is rejected by recompute', async () => {
  for (const l of labels.filter((x) => x.expected_template !== 'clarify_card')) {
    const p = await askPanel(l.text, store);
    const s = JSON.stringify(p.spec); const m = s.match(/"v":(-?[\d.]+),"ref":"([^"]+)"/)!;
    const [, key, , ...pth] = m[2].split('.');
    const ev = structuredClone(p.evidence) as any; const it = ev.items.find((i: any) => i.key === key);
    let o = it.result; for (const q of pth.slice(0, -1)) o = o[q];
    o[pth.at(-1)!] = Number(m[1]) * 10 + 1; it.result_hash = hashOf(it.result);
    const forged = JSON.parse(s.replace(m[0], `"v":${Number(m[1]) * 10 + 1},"ref":"${m[2]}"`));
    assert.ok(specErrors(forged, ev, store).some((e) => /recomputed/.test(e)), l.id);
  }
});

test('genui G1: without a store nothing is trusted', async () => {
  const p = await askPanel(labels[0].text, store);
  assert.ok(specErrors(p.spec, p.evidence).length > 0);
});

test('genui G2: a plain integer in chart text is rejected; years, quarters and ids are labels', async () => {
  const p = await askPanel(labels.find((l) => l.expected_template === 'kpi').text, store);
  for (const bad of ['Only 3 units are vacant here', 'seven', '12 of them']) {
    const sp = JSON.parse(JSON.stringify(p.spec)); sp.insight = bad;
    if (/\d/.test(bad)) assert.ok(specErrors(sp, p.evidence, store).length > 0, bad);
  }
  const ok = JSON.parse(JSON.stringify(p.spec)); ok.insight = 'Q3 2026 at P05';
  assert.deepEqual(specErrors(ok, p.evidence, store), []);
});

test('genui G3: an intent that differs from the lexicon reading in any field goes to clarify', async () => {
  const q = 'What was total marketing spend in Q2 2026?';
  const t = await askFlowIqCopilot(coreQuestion(q), { mode: 'deterministic', store, parse: null });
  assert.equal(intentGate(t, coreQuestion(q), store), null);
  const other = await askFlowIqCopilot('What was total marketing spend in Q3 2026?', { mode: 'deterministic', store, parse: null });
  const swapped = { ...t, envelope: { ...t.envelope, query: { ...t.envelope.query, intent: other.envelope.query!.intent } } } as typeof t;
  assert.equal(intentGate(swapped, coreQuestion(q), store)?.template, 'clarify_card');
});

test('genui: an ambiguous question gets a clarify card, never a chart', async () => {
  const p = await askPanel('How are we doing?', store);
  assert.equal(p.spec.template, 'clarify_card');
});

test('genui action center: approve only marks a draft, undo restores it, and nothing is sent', async () => {
  const { createServer } = await import('../src/genui/server.ts');
  const srv = createServer().listen(0, '127.0.0.1');
  await new Promise<void>((r) => srv.once('listening', () => r()));
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  const token = (await (await fetch(base + '/')).text()).match(/name="genui-csrf" content="([^"]+)"/)![1];
  const j = async (u: string, body?: unknown) => (await fetch(base + u, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', origin: base, 'x-genui-csrf': token }, body: JSON.stringify(body) })).json();
  try {
    const rec = labels.find((l) => l.expected_template === 'recommendation_card');
    const ask = await j('/api/ask', { question: rec.text });
    await j('/api/panels', ask);
    const d = await j('/api/actions', { panel_id: ask.id });
    const id = d.id;
    assert.ok(d.cites.length > 0 && d.cites.every((c: { source: { template_id: string } }) => c.source.template_id === ask.id));
    assert.equal((await j('/api/actions', { panel_id: 'nope' })).error !== undefined, true);
    assert.match(id, /^D-[0-9a-f]{8}$/);
    assert.equal(d.state, 'pending_approval');
    const ap = await j(`/api/actions/${id}/intent`, { kind: 'set_state', to: 'approved' });
    assert.equal(ap.state, 'approved');
    const again = await j(`/api/actions/${id}/intent`, { kind: 'set_state', to: 'rejected' });
    assert.notEqual(again.state, 'rejected');
    const un = await j(`/api/actions/${id}/intent`, { kind: 'undo' });
    assert.equal(un.state, 'pending_approval');
  } finally { srv.close(); }
});
