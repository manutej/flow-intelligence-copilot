// FLOWIQ-SITE-009: the dashboard pages load against the current embedded data
// with zero uncaught script errors (learner/integrity tables removed,
// void-spend reads rawAmount). Browser test: needs playwright-core and a
// Chrome/Chromium binary; skips with a reason when neither is available.
// FLOWIQ-SITE-010: docs/index.html is covered too, including the live
// /api/state path (fulfilled from the real api/state.js handler), and the
// void-spend amount formatter is checked in every page.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const PAGES = ["public/index.html", "scripts/dashboard-template.html", "ui/flowiq-visual-studio.html"];
// The template carries a __INITIAL_STATE_JSON__ placeholder, so only built pages are loaded.
const BUILT = ["public/index.html", "ui/flowiq-visual-studio.html", "docs/index.html"];
const ALL = [...PAGES, "docs/index.html"];

// Live-shaped state: what api/state.js returns for the default query.
async function liveState(): Promise<string> {
  const mod = await import(pathToFileURL(path.join(repoRoot, "api/state.js")).href);
  let body = "";
  const res: any = { statusCode: 200, setHeader() {}, end(b?: string) { if (b) body = b; } };
  await mod.default({ method: "GET", url: "/api/state", headers: {} }, res);
  return body;
}

function extractFn(html: string, name: string): string {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} missing`);
  const end = html.indexOf("\n}\n", start);
  return html.slice(start, end + 2);
}

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
  for (const f of ALL) {
    const html = fs.readFileSync(path.join(repoRoot, f), "utf-8");
    assert.ok(!html.includes("renderLearnerTables"), `${f} still calls renderLearnerTables`);
    assert.ok(!html.includes("multi-hopRuns"), `${f} has the multi-hopRuns rewrite`);
    if (f === "docs/index.html") continue; // docs keeps its own integrity panels and embedded snapshot
    assert.ok(!html.includes("learnerSummary"), `${f} still embeds learnerSummary`);
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
    // Live path: serve each page over a fake origin and answer /api/state with the real handler.
    const live = await liveState();
    assert.ok(!JSON.parse(live).learnerSummary, "api/state.js no longer sends learnerSummary");
    for (const f of BUILT) {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(e.message));
      const html = fs.readFileSync(path.join(repoRoot, f), "utf-8");
      await page.route(/^https?:/, (r: any) => {
        const u = new URL(r.request().url());
        if (u.hostname !== "flowiq.test") return r.abort();
        if (u.pathname === "/api/state") return r.fulfill({ status: 200, contentType: "application/json", body: live });
        if (u.pathname === "/") return r.fulfill({ status: 200, contentType: "text/html", body: html });
        return r.fulfill({ status: 404, body: "" });
      });
      await page.goto("http://flowiq.test/", { waitUntil: "load" });
      const fetched = page.waitForResponse((r: any) => r.url().includes("/api/state"), { timeout: 5000 });
      await page.evaluate(() => (globalThis as any).onPolicyMutate());
      await fetched;
      await page.waitForTimeout(300);
      assert.deepEqual(errors, [], `${f} threw against live /api/state`);
      await page.close();
    }
  } finally { await browser.close(); }
});

test("void-spend amounts use their own currency and show — when missing", () => {
  for (const f of ["scripts/dashboard-template.html", ...BUILT]) {
    const html = fs.readFileSync(path.join(repoRoot, f), "utf-8");
    const fmt = new Function(`${extractFn(html, "formatVoidAmount")}; return formatVoidAmount;`)() as (v: any) => string;
    assert.equal(fmt({ rawAmount: 1520, currency: "USD" }), "$1520.00 USD", f);
    assert.equal(fmt({ rawAmount: 960, currency: "CAD" }), "960.00 CAD", f);
    assert.equal(fmt({ amountOriginal: 960, currency: "CAD" }), "960.00 CAD", f);
    assert.equal(fmt({ currency: "CAD" }), "\u2014", f);
    assert.equal(fmt({ rawAmount: null, amountOriginal: undefined, currency: "USD" }), "\u2014", f);
    for (const bad of [NaN, "", Infinity, -Infinity, "abc", [], true, false, {}]) {
      assert.equal(fmt({ rawAmount: bad, amountOriginal: 960, currency: "CAD" }), "960.00 CAD", `${f} rawAmount=${String(bad)}`);
      assert.equal(fmt({ rawAmount: bad, currency: "USD" }), "\u2014", `${f} rawAmount=${String(bad)} no fallback`);
      assert.equal(fmt({ rawAmount: bad, amountOriginal: bad, currency: "USD" }), "\u2014", f);
    }
    assert.equal(fmt({ rawAmount: "1520", currency: "USD" }), "$1520.00 USD", f);
    assert.ok(!html.includes('">$" + Number(v.rawAmount'), `${f} still prefixes $ on every void amount`);
  }
});
