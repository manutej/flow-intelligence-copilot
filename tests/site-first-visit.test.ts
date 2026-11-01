// FLOWIQ-SITE-007: first-visit orientation questions get a capability answer
// built from the data, and a /help page is linked from the hero.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { renderHelpPage } from '../scripts/build-help.ts';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const store = loadPortfolioStore();
const DATA_FILES = ['data/pms/properties.csv', 'data/pms/units.csv', 'data/pms/leases.csv', 'data/crm/leads.csv', 'data/ils/spend.csv', 'data/ops/decisions.csv'];

for (const q of ['what data do you have?', 'what can you do?', 'how current is this data?', 'what buildings are in here?', 'hi, I just signed up - where do I start?', 'is this my data or a demo?']) {
  test(`capability answer: ${q}`, async () => {
    const r = await askFlowIqCopilot(q, { store, parse: null });
    const a = r.envelope.answer;
    assert.equal((r.envelope.result as Record<string, unknown>).capability, true);
    for (const p of store.operatingProperties) assert.ok(a.includes(p.name), p.name);
    assert.match(a, /1,100 units/);
    assert.ok(a.includes(store.policy.asOfDate));
    for (const f of DATA_FILES) assert.ok(a.includes(f), f);
  });
}

test('every named data source is a real export file (no invented sources)', async () => {
  const r = await askFlowIqCopilot('what data do you have?', { store, parse: null });
  const named = r.envelope.answer.match(/data\/[\w/.-]+\.csv/g) ?? [];
  assert.ok(named.length >= DATA_FILES.length);
  for (const f of named) assert.ok(fs.existsSync(path.join(repoRoot, f)), f);
});

test('as-of date tracks the data, not a literal', async () => {
  const shifted = loadPortfolioStore(undefined, { asOfDate: '2026-12-15' });
  const r = await askFlowIqCopilot('how current is this data?', { store: shifted, parse: null });
  assert.match(r.envelope.answer, /2026-12-15/);
});

test('example questions in the capability answer actually answer', async () => {
  const { EXAMPLE_QUESTIONS } = await import('../src/agent/copilot.ts');
  for (const q of EXAMPLE_QUESTIONS) {
    const r = await askFlowIqCopilot(q, { store, parse: null });
    const res = r.envelope.result as Record<string, unknown>;
    assert.ok(res.unknown !== true && res.refused !== true, q);
  }
});

test('/help exists, is current, and is linked from the hero; AGENTS.md is not linked', () => {
  const help = fs.readFileSync(path.join(repoRoot, 'public/help.html'), 'utf-8');
  assert.equal(help, renderHelpPage(store), 'public/help.html is current (run scripts/build-help.ts)');
  const vercel = JSON.parse(fs.readFileSync(path.join(repoRoot, 'vercel.json'), 'utf-8'));
  assert.ok(vercel.rewrites.some((r: { source: string }) => r.source === '/help'));
  for (const f of ['public/index.html', 'scripts/dashboard-template.html']) {
    const html = fs.readFileSync(path.join(repoRoot, f), 'utf-8');
    const hero = html.slice(html.indexOf('class="hero-title"'), html.indexOf('class="hero-title"') + 1500);
    assert.match(hero, /href="\/help"/, f);
    assert.doesNotMatch(html, /href="\/AGENTS\.md"/, f);
  }
});
