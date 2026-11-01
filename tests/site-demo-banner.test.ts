// FLOWIQ-SITE-005: the site says plainly it is a demo, with counts and the
// as-of date taken from the data, a privacy note, and demo-only replies to
// upload / connect asks. The viewport check needs playwright-core + Chrome
// and skips when they are absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { applyDemoBanner, demoBannerHtml, demoStats } from '../scripts/demo-banner.ts';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const store = loadPortfolioStore();

test('banner counts and as-of come from the data', () => {
  const s = demoStats(store);
  assert.equal(s.buildings, store.operatingProperties.length);
  const html = demoBannerHtml(store);
  assert.match(html, new RegExp(`data-demo="buildings">${s.buildings}<`));
  assert.match(html, /Your data isn't uploaded here\./);
  assert.match(html, /id="privacy-note"/);
  assert.match(html, /href="mailto:"[^>]*>Want this on your portfolio\? Contact \(coming soon\)</);
  assert.doesNotMatch(html, /Chicago/);
  const shifted = demoBannerHtml(loadPortfolioStore(undefined, { asOfDate: '2026-12-15' }));
  assert.match(shifted, /Dec 15, 2026/);
});

test('banner is idempotent and sits before the command bar', () => {
  const page = '<body><section id="ask" class="ask-grid"></section></body>';
  const once = applyDemoBanner(page, store);
  assert.equal(applyDemoBanner(once, store), once);
  assert.ok(once.indexOf('id="demo-banner"') < once.indexOf('<section id="ask"'));
  const built = fs.readFileSync(path.join(repoRoot, 'public/index.html'), 'utf-8');
  assert.equal(applyDemoBanner(built, store), built, 'public/index.html banner is current');
});

for (const q of ['can I upload my rent roll?', 'how do I connect my Yardi?', 'Can I add my own buildings?', 'import my AppFolio data', 'here is my portfolio, 3 buildings in Austin - what is my occupancy?', 'what is occupancy at Riverside Lofts (my building)?']) {
  test(`demo-only reply: ${q}`, async () => {
    const r = await askFlowIqCopilot(q, { store, parse: null });
    const res = r.envelope.result as Record<string, unknown>;
    assert.equal(res.demo_only, true);
    assert.match(r.envelope.answer, /This is a demo/);
    assert.doesNotMatch(r.envelope.answer, /\bstep\s*\d|click|go to settings/i);
  });
}

test('unknown building: not found, lists available buildings', async () => {
  const r = await askFlowIqCopilot('what is the occupancy at Lincoln Tower?', { store, parse: null });
  assert.match(r.envelope.answer, /no building called/);
  assert.match(r.envelope.answer, /Kedzie Works/);
});

test('ordinary questions are not caught by the demo-only reply', async () => {
  const r = await askFlowIqCopilot('How many vacant units are at Kedzie Works?', { store, parse: null });
  assert.notEqual((r.envelope.result as Record<string, unknown>).demo_only, true);
});

async function loadPlaywright(): Promise<any | null> {
  for (const c of [process.env.PLAYWRIGHT_CORE_PATH, 'playwright-core', '/tmp/pw/node_modules/playwright-core/index.mjs'].filter(Boolean) as string[]) {
    try { const m = await import(c.startsWith('/') ? pathToFileURL(c).href : c); return m.chromium ?? m.default?.chromium ?? null; } catch {}
  }
  return null;
}
const chrome = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium'].find((c) => c && fs.existsSync(c));

const chromium = await loadPlaywright();
const browserSkip = !chromium || !chrome ? 'playwright-core or Chrome not available' : false;

test('banner is on the first screen at desktop and mobile widths', async () => {
  if (browserSkip) { console.log(`# skipped viewport check: ${browserSkip}`); return; }
  const html = fs.readFileSync(path.join(repoRoot, 'public/index.html'), 'utf-8');
  const server = http.createServer((_q, res) => { res.setHeader('content-type', 'text/html'); res.end(html); });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  const browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] });
  try {
    for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport: vp });
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
      const box = await page.locator('#demo-banner').boundingBox();
      assert.ok(box, `banner rendered at ${vp.width}px`);
      assert.ok(box.y >= 0 && box.y + Math.min(box.height, 40) <= vp.height, `banner on first screen at ${vp.width}px (y=${box.y})`);
      await page.close();
    }
  } finally { await browser.close(); server.close(); }
});
