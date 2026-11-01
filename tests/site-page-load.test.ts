// FLOWIQ-SITE-009: the dashboard pages load against the current embedded data
// with zero uncaught script errors (learner/integrity tables removed,
// void-spend reads rawAmount). Browser test: needs playwright-core and a
// Chrome/Chromium binary; skips with a reason when neither is available.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const PAGES = ["public/index.html", "scripts/dashboard-template.html", "ui/flowiq-visual-studio.html"];
// The template carries a __INITIAL_STATE_JSON__ placeholder, so only built pages are loaded.
const BUILT = ["public/index.html", "ui/flowiq-visual-studio.html"];

async function loadChromium(): Promise<any | null> {
  for (const c of [process.env.PLAYWRIGHT_CORE_PATH, "playwright-core", "/tmp/pw/node_modules/playwright-core/index.mjs"].filter(Boolean) as string[]) {
    try {
      const mod = await import(c.startsWith("/") ? pathToFileURL(c).href : c);
      return mod.chromium ?? mod.default?.chromium ?? null;
    } catch {}
  }
  return null;
}
function chromePath(): string | undefined {
  for (const c of [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/chromium"]) if (c && fs.existsSync(c)) return c;
  return undefined;
}

test("no page still references the removed learner/integrity tables", () => {
  for (const f of PAGES) {
    const html = fs.readFileSync(path.join(repoRoot, f), "utf-8");
    for (const id of ["renderLearnerTables", "tbl-learner", "tbl-proposed-decisions", "tbl-integrity-edges", "tbl-sheaf-edges"]) {
      assert.ok(!html.includes(id), `${f} still has ${id}`);
    }
  }
});

(test as any)("dashboard pages load with zero script errors", async (t: any) => {
  const chromium = await loadChromium();
  const exe = chromePath();
  if (!chromium || !exe) { t.skip("playwright-core or Chrome not available"); return; }
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  try {
    for (const f of BUILT) {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(e.message));
      await page.route(/^https?:/, (r: any) => r.abort());
      await page.goto(pathToFileURL(path.join(repoRoot, f)).href, { waitUntil: "load" });
      await page.waitForTimeout(500);
      assert.deepEqual(errors, [], `${f} threw on load`);
      await page.close();
    }
  } finally { await browser.close(); }
});
