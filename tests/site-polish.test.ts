// FLOWIQ-SITE-008: video label, favicon, Vault Drawer explanation, and the
// off-site MCP setup link marked external.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const read = (f: string) => fs.readFileSync(path.join(repoRoot, f), 'utf-8');
const PAGES = ['public/index.html', 'scripts/dashboard-template.html', 'ui/flowiq-visual-studio.html'];

test('favicon.ico exists as a real ICO and is linked', () => {
  const ico = fs.readFileSync(path.join(repoRoot, 'public/favicon.ico'), 'latin1');
  assert.deepEqual([0, 1, 2, 3].map((k) => ico.charCodeAt(k)), [0, 0, 1, 0], 'ICO header');
  for (const f of PAGES) assert.match(read(f), /<link rel="icon" href="\/favicon.ico"/, f);
});

test('video label matches the recording length (1:26)', () => {
  // ffprobe public/demo-walkthrough.mp4 -> duration 86.800000 s (2026-10-31).
  const seconds = 86.8;
  const label = `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  for (const f of ['public/index.html', 'ui/flowiq-visual-studio.html', 'public/field-notebook.html']) {
    const html = read(f);
    assert.doesNotMatch(html, /Watch 90s/, f);
    assert.ok(html.includes(`Watch ${label} Screen Recording`), `${f} says ${label}`);
  }
});

test('Vault Drawer button has a visible explanation', () => {
  for (const f of PAGES) {
    const html = read(f);
    const m = html.match(/Vault Drawer<\/button><span id="vault-hint"[^>]*>([^<]{20,})<\/span>/);
    assert.ok(m, f);
    assert.match(html, /onclick="toggleHarnessDrawer\(\)" title="[^"]{20,}" aria-describedby="vault-hint"/, f);
  }
});

test('MCP setup link is marked external and opens a new tab', () => {
  for (const f of ['public/index.html', 'scripts/dashboard-template.html']) {
    const m = read(f).match(/<a href="https:\/\/github\.com\/[^"]*MCP_SETUP\.md"([^>]*)>([^<]*)<\/a>\s*<span[^>]*>\(opens GitHub\)<\/span>/);
    assert.ok(m, f);
    assert.match(m[1], /target="_blank"/);
    assert.match(m[1], /rel="noopener noreferrer"/);
    assert.match(m[2], /↗/);
  }
});
