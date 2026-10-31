// TENACITY VERDICT-GENUI-f0f6bdf N4 (id collision) and N5 (approve/undo re-validate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'genui-drafts-'));
process.env.GENUI_STORE = STORE;
const REC = fs.readFileSync('tests/fixtures/genui-templates-extra.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((l) => l.expected_template === 'recommendation_card').text;
const ACTIONS = path.join(STORE, 'actions.json'), PANELS = path.join(STORE, 'panels.json');

async function boot() {
  const { createServer } = await import('../src/genui/server.ts');
  const srv = createServer().listen(0, '127.0.0.1');
  await new Promise<void>((r) => srv.once('listening', () => r()));
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  const token = (await (await fetch(base + '/')).text()).match(/name="genui-csrf" content="([^"]+)"/)![1];
  const post = (u: string, b: unknown) => fetch(base + u, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, 'x-genui-csrf': token }, body: JSON.stringify(b) });
  return { srv, post };
}

test('N4: draft ids are 12 hex, and an id hit with a different spec is a 409, not the other draft', async () => {
  const { srv, post } = await boot();
  try {
    const p = await (await post('/api/ask', { question: REC })).json();
    assert.equal((await post('/api/panels', p)).status, 200);
    const d = await (await post('/api/actions', { panel_id: p.id })).json();
    assert.match(d.id, /^D-[0-9a-f]{12}$/);
    // simulate a collision: the stored draft under this id was made from another spec
    const all = JSON.parse(fs.readFileSync(ACTIONS, 'utf8'));
    all[0].spec_sha256 = '0'.repeat(64); all[0].draft_text = 'some other draft';
    fs.writeFileSync(ACTIONS, JSON.stringify(all));
    const r = await post('/api/actions', { panel_id: p.id });
    assert.equal(r.status, 409);
  } finally { srv.close(); fs.rmSync(ACTIONS, { force: true }); fs.rmSync(PANELS, { force: true }); }
});

test('N5: approve re-validates the source panel', async () => {
  const { srv, post } = await boot();
  try {
    const p = await (await post('/api/ask', { question: REC })).json();
    await post('/api/panels', p);
    const d = await (await post('/api/actions', { panel_id: p.id })).json();
    assert.equal((await post(`/api/actions/${d.id}/intent`, { kind: 'set_state', to: 'approved' })).status, 200);
    // the saved panel goes stale (or is tampered with on disk): approve must refuse. Undo of an
    // approval only withdraws it, so since TENACITY M1 it is allowed without re-validation.
    const panels = JSON.parse(fs.readFileSync(PANELS, 'utf8'));
    panels[0].spec.props.impacts[0].value.v = 9999; fs.writeFileSync(PANELS, JSON.stringify(panels));
    assert.equal((await post(`/api/actions/${d.id}/intent`, { kind: 'undo' })).status, 200);
    assert.equal((await post(`/api/actions/${d.id}/intent`, { kind: 'set_state', to: 'approved' })).status, 409);
    panels[0].spec.props.impacts[0].value.v = p.spec.props.impacts[0].value.v; fs.writeFileSync(PANELS, JSON.stringify(panels));
    assert.equal((await post(`/api/actions/${d.id}/intent`, { kind: 'set_state', to: 'approved' })).status, 200);
    assert.equal((await post(`/api/actions/${d.id}/intent`, { kind: 'undo' })).status, 200);
    fs.writeFileSync(PANELS, '[]');
    assert.equal((await post(`/api/actions/${d.id}/intent`, { kind: 'set_state', to: 'approved' })).status, 409);
  } finally { srv.close(); }
});

test('L4: a stale draft is flagged stale and can still be rejected (and that reject undone)', async () => {
  const { srv, post } = await boot();
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  try {
    fs.writeFileSync(PANELS, '[]'); fs.writeFileSync(ACTIONS, '[]');
    const p = await (await post('/api/ask', { question: REC })).json();
    await post('/api/panels', p);
    const d = await (await post('/api/actions', { panel_id: p.id })).json();
    const ac = async () => (await (await fetch(base + '/api/action-center')).json()).drafts.find((x: any) => x.id === d.id);
    assert.equal((await ac()).stale, false);
    const panels = JSON.parse(fs.readFileSync(PANELS, 'utf8'));
    panels[0].spec.props.impacts[0].value.v = 9999; fs.writeFileSync(PANELS, JSON.stringify(panels));
    assert.equal((await ac()).stale, true);
    assert.equal((await post(`/api/actions/${d.id}/intent`, { kind: 'set_state', to: 'approved' })).status, 409);
    const r = await post(`/api/actions/${d.id}/intent`, { kind: 'set_state', to: 'rejected' });
    assert.equal(r.status, 200); assert.equal((await r.json()).state, 'rejected');
    const u = await post(`/api/actions/${d.id}/intent`, { kind: 'undo' });
    assert.equal(u.status, 200); assert.equal((await u.json()).state, 'pending_approval');
    assert.equal((await ac()).stale, true);
    assert.equal((await post(`/api/actions/${d.id}/intent`, { kind: 'set_state', to: 'approved' })).status, 409);
    const html = await (await fetch(base + '/')).text();
    assert.match(html, /stale:'⚠ STALE/);
  } finally { srv.close(); }
});

test('M1: an approved draft that goes stale can be withdrawn by undo and is shown stale', async () => {
  const { srv, post } = await boot();
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  try {
    fs.writeFileSync(PANELS, '[]'); fs.writeFileSync(ACTIONS, '[]');
    const p = await (await post('/api/ask', { question: REC })).json();
    await post('/api/panels', p);
    const d = await (await post('/api/actions', { panel_id: p.id })).json();
    assert.equal((await post(`/api/actions/${d.id}/intent`, { kind: 'set_state', to: 'approved' })).status, 200);
    const panels = JSON.parse(fs.readFileSync(PANELS, 'utf8'));
    panels[0].spec.props.impacts[0].value.v = 9999; fs.writeFileSync(PANELS, JSON.stringify(panels));
    const ac = async () => (await (await fetch(base + '/api/action-center')).json()).drafts.find((x: any) => x.id === d.id);
    assert.equal((await ac()).stale, true);
    const u = await post(`/api/actions/${d.id}/intent`, { kind: 'undo' });
    assert.equal(u.status, 200); assert.equal((await u.json()).state, 'pending_approval');
    assert.equal((await post(`/api/actions/${d.id}/intent`, { kind: 'set_state', to: 'approved' })).status, 409);
    assert.equal((await post(`/api/actions/${d.id}/intent`, { kind: 'set_state', to: 'rejected' })).status, 200);
    const html = await (await fetch(base + '/')).text();
    assert.match(html, /d\.state==='approved'\)\?'stale'/);
  } finally { srv.close(); }
});
