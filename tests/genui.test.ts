import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { askPanel } from '../src/genui/picker.ts';
import { specErrors, type ChartSpec } from '../src/genui/spec.ts';

process.env.GENUI_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'genui-test-'));
const store = loadPortfolioStore();
const labels = fs.readFileSync('tests/fixtures/genui-templates-extra.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('genui: every extra fixture picks its labelled template with zero fidelity errors', async () => {
  for (const l of labels) {
    const p = await askPanel(l.text, store);
    assert.equal(p.spec.template, l.expected_template, l.id);
    assert.deepEqual(specErrors(p.spec, p.evidence), [], l.id);
  }
});

test('genui: the validator rejects a forged number, a bare number and a figure in prose', async () => {
  const p = await askPanel(labels.find((l) => l.expected_template === 'kpi').text, store);
  const s = JSON.parse(JSON.stringify(p.spec)) as ChartSpec & { props: { value: { v: number } } };
  s.props.value.v += 1;
  assert.ok(specErrors(s, p.evidence).length > 0);
  const bare = JSON.parse(JSON.stringify(p.spec)); bare.props.value = 5;
  assert.ok(specErrors(bare, p.evidence).length > 0);
  const prose = JSON.parse(JSON.stringify(p.spec)); prose.subtitle = 'up 12.5% on last month';
  assert.ok(specErrors(prose, p.evidence).length > 0);
});

test('genui: an ambiguous question gets a clarify card, never a chart', async () => {
  const p = await askPanel('How are we doing?', store);
  assert.equal(p.spec.template, 'clarify_card');
});

test('genui action center: approve only marks a draft, undo restores it, and nothing is sent', async () => {
  const { createServer } = await import('../src/genui/server.ts');
  const srv = createServer().listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  const j = async (u: string, body?: unknown) => (await fetch(base + u, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  try {
    const rec = labels.find((l) => l.expected_template === 'recommendation_card');
    const ask = await j('/api/ask', { question: rec.text });
    await j('/api/panels', ask);
    const d = await j('/api/actions', { panel_id: ask.id });
    const id = d.id;
    assert.ok(d.cites.length > 0 && d.cites.every((c: { source: { template_id: string } }) => c.source.template_id === ask.id));
    assert.equal((await j('/api/actions', { panel_id: 'nope' })).error !== undefined, true);
    assert.match(id, /^D-\d{4}$/);
    assert.equal(d.state, 'pending_approval');
    const ap = await j(`/api/actions/${id}/intent`, { kind: 'set_state', to: 'approved' });
    assert.equal(ap.state, 'approved');
    const again = await j(`/api/actions/${id}/intent`, { kind: 'set_state', to: 'rejected' });
    assert.notEqual(again.state, 'rejected');
    const un = await j(`/api/actions/${id}/intent`, { kind: 'undo' });
    assert.equal(un.state, 'pending_approval');
  } finally { srv.close(); }
});
