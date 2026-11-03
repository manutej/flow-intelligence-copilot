// FLOWIQ-SITE-006: a plain hero for multifamily operators: no evaluator
// jargon, three example questions that submit, one 'Ask a question' CTA to
// #ask, and the technical content still on the page under 'How it's built'.
// The click-through check needs playwright-core + Chrome and skips without them.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
// @ts-ignore -- plain JS handler, no type declarations
import askHandler from "../api/ask.js";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const PAGES = ["public/index.html", "scripts/dashboard-template.html", "ui/flowiq-visual-studio.html"];

function heroOf(html: string): string {
  const i = html.indexOf('<section id="hero"');
  assert.ok(i >= 0, "plain hero present");
  return html.slice(i, html.indexOf("</section>", i));
}
const text = (h: string) => h.replace(/<[^>]+>/g, " ");

for (const f of PAGES) {
  test(`hero copy (${f})`, () => {
    const html = fs.readFileSync(path.join(repoRoot, f), "utf-8");
    const hero = text(heroOf(html));
    for (const banned of [/\bMCP\b/i, /\bTemporal\b/i, /\bBayesian\b/i, /primary\s+keys?/i, /\b[A-Z]+-\d{2,}\b/, /Ormus/i, /FLOW-\d+/]) {
      assert.doesNotMatch(hero, banned, `${f}: ${banned}`);
    }
    assert.match(hero, /multifamily operators/i);
    assert.equal((heroOf(html).match(/class="hero-example"/g) ?? []).length, 3);
    assert.match(heroOf(html), /<a href="#ask"[^>]*>Ask a question<\/a>/);
    assert.equal((heroOf(html).match(/class="[^"]*hero-cta/g) ?? []).length, 1, "one CTA");
    assert.match(html, /<div class="copilot-box" id="ask">/, "#ask is the command bar");
    // Technical content is still reachable, below the hero.
    const built = html.indexOf('id="how-its-built"');
    assert.ok(built > html.indexOf('<section id="hero"'));
    for (const id of ['class="hero-band"', "kpi-strip", 'id="official-validator"']) assert.ok(html.indexOf(id, built) > built, id);
  });
}

async function loadPlaywright(): Promise<any | null> {
  for (const c of [process.env.PLAYWRIGHT_CORE_PATH, "playwright-core", "/tmp/pw/node_modules/playwright-core/index.mjs"].filter(Boolean) as string[]) {
    try { const m = await import(c.startsWith("/") ? pathToFileURL(c).href : c); return m.chromium ?? m.default?.chromium ?? null; } catch {}
  }
  return null;
}
const chrome = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/chromium"].find((c) => c && fs.existsSync(c));

test("hero example questions submit and render an answer", async () => {
  const chromium = await loadPlaywright();
  if (!chromium || !chrome) { console.log("# skipped: playwright-core or Chrome not available"); return; }
  const html = fs.readFileSync(path.join(repoRoot, "public/index.html"), "utf-8");
  let posts = 0;
  const server = http.createServer(async (req, res) => {
    if (req.url?.startsWith("/api/ask")) { if (req.method === "POST") posts++; await askHandler(req, res); return; }
    res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(html);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as any).port;
  const browser = await chromium.launch({ executablePath: chrome });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => typeof (window as any).runLiveAsk === "function");
    const heroBox = await page.locator("#hero h1").boundingBox();
    assert.ok(heroBox && heroBox.y < 800, "hero on the first screen");
    const examples = page.locator("#hero .hero-example");
    assert.equal(await examples.count(), 3);
    for (let k = 0; k < 3; k++) {
      const q = ((await examples.nth(k).textContent()) ?? "").trim();
      const before = posts;
      await examples.nth(k).click();
      await page.waitForFunction(() => !document.getElementById("ask-loading"), null, { timeout: 30000 });
      await page.waitForTimeout(100);
      assert.equal(posts, before + 1, `one POST for: ${q}`);
      assert.equal(await page.inputValue("#ask-input"), q);
      const card = (await page.textContent("#live-answer-card")) ?? "";
      assert.ok(card.length > 20 && !/I don't know/.test(card), `answer for: ${q}`);
    }
  } finally { await browser.close(); server.close(); }
});
