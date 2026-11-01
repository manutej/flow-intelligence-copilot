// FLOWIQ-SITE-001: the command bar, Enter key and preset chips must POST
// /api/ask, show a loading state, render the answer, and surface errors.
// Browser test: needs playwright-core and a Chrome/Chromium binary. Set
// PLAYWRIGHT_CORE_PATH / CHROME_PATH if they are not on the default paths;
// the test skips (with a reason) when neither is available.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import askHandler from "../api/ask.js";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

async function loadPlaywright(): Promise<any | null> {
  const candidates = [
    process.env.PLAYWRIGHT_CORE_PATH,
    "playwright-core",
    "/tmp/pw/node_modules/playwright-core/index.mjs",
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      const spec = c.startsWith("/") ? pathToFileURL(c).href : c;
      const mod = await import(spec);
      return mod.chromium ?? mod.default?.chromium ?? null;
    } catch {}
  }
  return null;
}

function chromePath(): string | undefined {
  for (const c of [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/chromium"]) {
    if (c && fs.existsSync(c)) return c;
  }
  return undefined;
}

type Mode = "real" | "http500" | "network";
let mode: Mode = "real";
let posts = 0;

function startServer(): Promise<http.Server> {
  const html = fs.readFileSync(path.join(repoRoot, "public/index.html"), "utf-8");
  const server = http.createServer(async (req, res) => {
    if (req.url?.startsWith("/api/ask")) {
      if (req.method === "POST") posts++;
      if (mode === "http500") {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: "boom" }));
        return;
      }
      if (mode === "network") {
        req.socket.destroy();
        return;
      }
      await new Promise((r) => setTimeout(r, 300)); // make the loading state observable
      await askHandler(req, res);
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(html);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

test("command bar wiring (FLOWIQ-SITE-001)", async (t) => {
  const chromium = await loadPlaywright();
  const exe = chromePath();
  if (!chromium || !exe) {
    t.skip("playwright-core or Chrome not available");
    return;
  }
  const server = await startServer();
  const port = (server.address() as any).port;
  const browser = await chromium.launch({ executablePath: exe });
  try {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (e: Error) => pageErrors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => typeof (window as any).runLiveAsk === "function");
    // A syntax error anywhere in the inline script is what killed the bar.
    assert.ok(!pageErrors.some((e) => /SyntaxError|is not defined|initializer/.test(e)), pageErrors.join("; "));
    // The learner and integrity tables are gone. One unrelated load-time error
    // remains in the void-spend table (amountOriginal; fixed on
    // feat/flowiq-site-009), so only errors raised by the bar count here.
    pageErrors.length = 0;

    await t.test("typing a question and pressing Enter sends one POST and renders the answer", async () => {
      mode = "real";
      posts = 0;
      await page.fill("#ask-input", "What is occupancy at each building?");
      const t0 = Date.now();
      await page.press("#ask-input", "Enter");
      await page.waitForSelector("#ask-loading", { timeout: 1000 });
      assert.ok(Date.now() - t0 < 1000, "loading indicator shows promptly");
      await page.waitForSelector("#ask-loading", { state: "detached", timeout: 30000 });
      const text = await page.textContent("#live-answer-card");
      assert.match(text ?? "", /\[LIVE-WEB\]/);
      assert.match(text ?? "", /occup/i);
      assert.equal(posts, 1);
    });

    await t.test("clicking Execute sends exactly one POST", async () => {
      posts = 0;
      await page.click("#ask-btn");
      await page.waitForSelector("#ask-loading", { state: "detached", timeout: 30000 });
      assert.equal(posts, 1);
    });

    await t.test("a preset chip fills the bar and submits", async () => {
      posts = 0;
      await page.fill("#ask-input", "");
      await page.click(".chip-row .chip >> nth=3");
      await page.waitForSelector("#ask-loading", { state: "detached", timeout: 30000 });
      const value = await page.inputValue("#ask-input");
      assert.ok(value.length > 0, "chip filled the input");
      assert.equal(posts, 1);
      assert.match((await page.textContent("#live-answer-card")) ?? "", /\[LIVE-WEB\]/);
    });

    await t.test("a 5xx shows a visible error", async () => {
      mode = "http500";
      await page.click("#ask-btn");
      await page.waitForSelector("#ask-error", { timeout: 10000 });
      assert.match((await page.textContent("#ask-error")) ?? "", /HTTP 500.*boom/);
      assert.equal(await page.isEnabled("#ask-btn"), true);
    });

    await t.test("a network failure shows a visible error", async () => {
      mode = "network";
      await page.click("#ask-btn");
      await page.waitForSelector("#ask-error", { timeout: 10000 });
      assert.match((await page.textContent("#ask-error")) ?? "", /Network error/);
    });

    assert.deepEqual(pageErrors, [], "no uncaught page errors from the command bar");
  } finally {
    await browser.close();
    server.close();
  }
});

test("built dashboard inline scripts parse", async () => {
  const { assertInlineScriptsParse } = await import("../scripts/build-dashboard.ts");
  for (const f of ["public/index.html", "ui/flowiq-visual-studio.html"]) {
    assertInlineScriptsParse(fs.readFileSync(path.join(repoRoot, f), "utf-8"));
  }
  assert.throws(() => assertInlineScriptsParse("<script>const multi-hopRuns = 1;</script>"), /does not parse/);
});
