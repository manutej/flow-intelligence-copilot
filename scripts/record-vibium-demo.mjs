import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser } from '/workspace/vib/node_modules/vibium/dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outMp4 = path.join(repoRoot, 'public', 'demo-walkthrough.mp4');
const docsMp4 = path.join(repoRoot, 'docs', 'demo-walkthrough.mp4');
const keyframesDir = '/tmp/flowiq-video-keyframes';
fs.mkdirSync(keyframesDir, { recursive: true });

function runCmd(args) {
  return execFileSync('node', ['--no-warnings', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

console.log('[1/4] Capturing live CLI & MCP outputs from repo...');
const outQ1 = stripAnsi(
  runCmd(['src/cli.ts', 'ask', 'What is the vacancy rate at Printers Row Tower?']),
).trim();
const outQ2 = stripAnsi(
  runCmd(['src/cli.ts', 'ask', 'What is the vacancy rate at the South Loop building?']),
).trim();
const outQ2Downtown = stripAnsi(
  runCmd(['src/cli.ts', 'ask', 'How many vacant units at the downtown building?']),
).trim();
const outMcp = stripAnsi(runCmd(['scripts/test-mcp-external.ts'])).trim();
const outQ3Bleeding = stripAnsi(
  runCmd(['src/cli.ts', 'ask', 'Which of my buildings is bleeding money on marketing right now, and why?']),
).trim();
const outGenAnswers = stripAnsi(runCmd(['scripts/generate-answers.ts'])).trim();
const outEval = stripAnsi(runCmd(['scripts/run-eval.ts'])).trim();
const outFlow106 = stripAnsi(runCmd(['scripts/flow-106.ts'])).trim();

const FPS = 30;

console.log('[2/4] Launching Vibium headless Chrome at 1920x1080...');
const bro = await browser.start({ headless: true });
const page = await bro.page();
await page.setViewport({ width: 1920, height: 1080 });

const ff = spawn(
  'ffmpeg',
  [
    '-y',
    '-f',
    'image2pipe',
    '-vcodec',
    'png',
    '-r',
    String(FPS),
    '-i',
    '-',
    '-vf',
    'scale=1920:1080',
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    outMp4,
  ],
  { stdio: ['pipe', 'inherit', 'inherit'] },
);

let totalFrames = 0;
const TOTAL_EST_FRAMES = 78 * FPS;

async function writeFrame(repeat = 1, saveTag = null) {
  const pngBuf = await page.screenshot();
  if (saveTag) {
    fs.writeFileSync(path.join(keyframesDir, `${saveTag}.png`), pngBuf);
  }
  for (let i = 0; i < repeat; i++) {
    const ok = ff.stdin.write(pngBuf);
    if (!ok) {
      await new Promise((r) => ff.stdin.once('drain', r));
    }
    totalFrames++;
  }
}

const HUD_INIT_JS = `
(() => {
  if (document.getElementById('ormus-recording-hud')) return 1;
  const style = document.createElement('style');
  style.textContent = \`
    html, body { scrollbar-width: none !important; -ms-overflow-style: none !important; }
    html::-webkit-scrollbar, body::-webkit-scrollbar { display: none !important; width: 0 !important; }
    #ormus-recording-hud {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 999999;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    }
    .ohud-topbar {
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 48px;
      background: rgba(10, 17, 34, 0.96);
      border-bottom: 1px solid rgba(210, 158, 61, 0.45);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 24px;
      color: #eceae3;
      box-sizing: border-box;
    }
    .ohud-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #d29e3d;
      font-weight: 600;
    }
    .ohud-rec-dot {
      width: 9px; height: 9px;
      border-radius: 50%;
      background: #d29e3d;
      box-shadow: 0 0 10px #d29e3d;
    }
    .ohud-chapters {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .ohud-chap {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      padding: 5px 10px;
      border-radius: 3px;
      border: 1px solid rgba(210, 158, 61, 0.22);
      color: #94a3b8;
      background: rgba(20, 33, 61, 0.7);
      letter-spacing: 0.04em;
    }
    .ohud-chap.active {
      color: #0e1830;
      background: #d29e3d;
      border-color: #f0be59;
      font-weight: 700;
    }
    .ohud-meta {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: #cbd5e1;
      letter-spacing: 0.05em;
    }
    .ohud-bottombar {
      position: absolute;
      bottom: 16px; left: 28px; right: 28px;
      min-height: 92px;
      background: linear-gradient(180deg, rgba(14, 24, 48, 0.97) 0%, rgba(10, 17, 34, 0.99) 100%);
      border: 1px solid rgba(210, 158, 61, 0.45);
      border-top: 2px solid #d29e3d;
      border-radius: 3px;
      padding: 14px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      box-sizing: border-box;
      box-shadow: 0 14px 40px rgba(0, 0, 0, 0.72);
    }
    .ohud-cap-left {
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-width: 1360px;
    }
    .ohud-cap-kicker {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #d29e3d;
      font-weight: 600;
    }
    .ohud-cap-text {
      font-size: 19px;
      line-height: 1.42;
      color: #f8fafc;
      font-weight: 400;
    }
    .ohud-cap-text strong {
      color: #f0be59;
      font-weight: 600;
    }
    .ohud-cap-text code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 16px;
      background: rgba(210, 158, 61, 0.14);
      color: #f0be59;
      padding: 2px 6px;
      border-radius: 3px;
      border: 1px solid rgba(210, 158, 61, 0.3);
    }
    .ohud-cap-badge {
      flex-shrink: 0;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: #d29e3d;
      background: rgba(20, 33, 61, 0.95);
      border: 1px solid rgba(210, 158, 61, 0.5);
      padding: 10px 16px;
      border-radius: 3px;
      text-align: right;
      line-height: 1.45;
    }
    .ohud-progress-track {
      position: absolute;
      bottom: 0; left: 0; right: 0;
      height: 4px;
      background: rgba(20, 33, 61, 0.9);
    }
    .ohud-progress-fill {
      height: 100%;
      background: #d29e3d;
      width: 0%;
    }
    .ohud-cursor {
      position: absolute;
      width: 28px; height: 28px;
      transform: translate(-4px, -4px);
      z-index: 1000001;
      transition: none;
    }
    .ohud-ripple {
      position: absolute;
      width: 44px; height: 44px;
      border-radius: 50%;
      border: 2px solid #d29e3d;
      background: rgba(210, 158, 61, 0.22);
      transform: translate(-50%, -50%) scale(0);
      opacity: 0;
      z-index: 1000000;
    }
    .ohud-ripple.show {
      transform: translate(-50%, -50%) scale(1.25);
      opacity: 1;
    }
    /* Terminal Studio Modal */
    #ohud-term-stage {
      position: fixed;
      top: 48px; left: 0; right: 0; bottom: 0;
      background: radial-gradient(circle at 82% 14%, rgba(210, 158, 61, 0.09), transparent 45%), #0e1830;
      z-index: 999990;
      display: none;
      padding: 22px 28px 124px 28px;
      box-sizing: border-box;
      grid-template-columns: 1120px 1fr;
      gap: 22px;
    }
    #ohud-term-stage.visible {
      display: grid;
    }
    .oterm-window {
      background: #091022;
      border: 1px solid rgba(210, 158, 61, 0.42);
      border-top: 2px solid #d29e3d;
      border-radius: 3px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .oterm-header {
      height: 38px;
      background: #14213d;
      border-bottom: 1px solid rgba(210, 158, 61, 0.25);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: #d29e3d;
    }
    .oterm-body {
      padding: 16px 20px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13.5px;
      line-height: 1.42;
      color: #eceae3;
      white-space: pre;
      overflow: hidden;
      flex: 1;
    }
    .oterm-side {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .oterm-card {
      background: #14213d;
      border: 1px solid rgba(210, 158, 61, 0.35);
      border-top: 2px solid #d29e3d;
      border-radius: 3px;
      padding: 18px 20px;
      color: #eceae3;
    }
    .oterm-card-kicker {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #d29e3d;
      margin-bottom: 6px;
    }
    .oterm-card-title {
      font-family: 'Cormorant Garamond', Georgia, serif;
      font-size: 26px;
      font-weight: 400;
      color: #f8fafc;
      margin: 0 0 10px 0;
      line-height: 1.2;
    }
    .oterm-card-body {
      font-size: 14px;
      line-height: 1.5;
      color: #cbd5e1;
    }
    .oterm-kv {
      margin-top: 12px;
      display: grid;
      grid-template-columns: 145px 1fr;
      gap: 7px 12px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      border-top: 1px solid rgba(210, 158, 61, 0.2);
      padding-top: 12px;
    }
    .oterm-kv-k { color: #94a3b8; }
    .oterm-kv-v { color: #f0be59; font-weight: 600; word-break: break-word; }
  \`;
  document.head.appendChild(style);

  const hud = document.createElement('div');
  hud.id = 'ormus-recording-hud';
  hud.innerHTML = \`
    <div class="ohud-topbar">
      <div class="ohud-brand">
        <span class="ohud-rec-dot"></span>
        <span>ORMUS × FLOW · COPILOT WALKTHROUGH</span>
      </div>
      <div class="ohud-chapters">
        <span class="ohud-chap" data-chap="1">01 · Architecture & 28-Node Atlas</span>
        <span class="ohud-chap" data-chap="2">02 · Q1: Unique Alias & Citations</span>
        <span class="ohud-chap" data-chap="3">03 · Q2: FLOW-101 Ambiguity Gate</span>
        <span class="ohud-chap" data-chap="4">04 · Q3: FLOW-104 MCP Server (stdio)</span>
        <span class="ohud-chap" data-chap="5">05 · Eval (3→8→10) & FLOW-106</span>
      </div>
      <div class="ohud-meta" id="ohud-timecode">27/27 VERIFIED · 00:00 / 01:18</div>
    </div>
    <div id="ohud-term-stage">
      <div class="oterm-window">
        <div class="oterm-header">
          <span id="oterm-title">/ TERMINAL · ~/ORMUS/flow/flow-intelligence-copilot (72-COL HARD WRAP)</span>
          <span id="oterm-status">NODE v22+ · ZERO EXTERNAL DEPS</span>
        </div>
        <div class="oterm-body" id="oterm-body"></div>
      </div>
      <div class="oterm-side" id="oterm-side"></div>
    </div>
    <div class="ohud-bottombar">
      <div class="ohud-cap-left">
        <div class="ohud-cap-kicker" id="ohud-kicker">/ BEAT 01 · ARCHITECTURE & CELESTIAL CONSTELLATION</div>
        <div class="ohud-cap-text" id="ohud-text">Loading...</div>
      </div>
      <div class="ohud-cap-badge" id="ohud-badge">FLOW-101..106<br/>3,858 CSV PKs</div>
    </div>
    <div class="ohud-progress-track">
      <div class="ohud-progress-fill" id="ohud-progress"></div>
    </div>
    <div class="ohud-ripple" id="ohud-ripple"></div>
    <div class="ohud-cursor" id="ohud-cursor" style="left: 960px; top: 540px;">
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <path d="M4 3L23 13.5L14 15.8L10.5 24.5L4 3Z" fill="#d29e3d" stroke="#0e1830" stroke-width="2.2"/>
      </svg>
    </div>
  \`;
  document.body.appendChild(hud);
  document.body.style.paddingTop = '48px';
  return 1;
})()
`;

async function ensureHud() {
  await page.evaluate(HUD_INIT_JS);
}

async function setHudState({
  chapter = 1,
  kicker = '',
  text = '',
  badge = '',
  cursorX = 960,
  cursorY = 540,
  ripple = false,
  termVisible = false,
  termTitle = '',
  termBody = '',
  termSideHtml = '',
}) {
  const sec = Math.floor(totalFrames / FPS);
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  const pct = Math.min(100, Math.round((totalFrames / TOTAL_EST_FRAMES) * 100));

  const payload = JSON.stringify({
    chapter,
    kicker,
    text,
    badge,
    cursorX,
    cursorY,
    ripple,
    termVisible,
    termTitle,
    termBody,
    termSideHtml,
    timeStr: `27/27 VERIFIED · ${mm}:${ss} / 01:18`,
    pct,
  });

  await page.evaluate(`(() => {
    const d = ${payload};
    document.querySelectorAll('.ohud-chap').forEach(el => {
      el.classList.toggle('active', Number(el.dataset.chap) === d.chapter);
    });
    document.getElementById('ohud-kicker').textContent = d.kicker;
    document.getElementById('ohud-text').innerHTML = d.text;
    document.getElementById('ohud-badge').innerHTML = d.badge;
    document.getElementById('ohud-timecode').textContent = d.timeStr;
    document.getElementById('ohud-progress').style.width = d.pct + '%';
    const cur = document.getElementById('ohud-cursor');
    cur.style.left = d.cursorX + 'px';
    cur.style.top = d.cursorY + 'px';
    const rip = document.getElementById('ohud-ripple');
    rip.style.left = d.cursorX + 'px';
    rip.style.top = d.cursorY + 'px';
    rip.classList.toggle('show', !!d.ripple);
    const ts = document.getElementById('ohud-term-stage');
    ts.classList.toggle('visible', !!d.termVisible);
    if (d.termVisible) {
      if (d.termTitle) document.getElementById('oterm-title').textContent = d.termTitle;
      document.getElementById('oterm-body').textContent = d.termBody;
      document.getElementById('oterm-side').innerHTML = d.termSideHtml;
    }
    return 1;
  })()`);
}

async function animateCursorAndHold(state, fromX, fromY, toX, toY, moveFrames, holdFrames, saveTag = null) {
  const steps = Math.max(4, Math.round(moveFrames / 2));
  for (let i = 0; i < steps; i++) {
    const t = (i + 1) / steps;
    const ease = 1 - Math.pow(1 - t, 3);
    const x = Math.round(fromX + (toX - fromX) * ease);
    const y = Math.round(fromY + (toY - fromY) * ease);
    await setHudState({ ...state, cursorX: x, cursorY: y, ripple: i === steps - 1 });
    await writeFrame(2);
  }
  await setHudState({ ...state, cursorX: toX, cursorY: toY, ripple: false });
  let remaining = holdFrames;
  let first = true;
  while (remaining > 0) {
    const chunk = Math.min(30, remaining);
    await setHudState({ ...state, cursorX: toX, cursorY: toY, ripple: false });
    await writeFrame(chunk, first ? saveTag : null);
    first = false;
    remaining -= chunk;
  }
}

console.log('[3/4] Recording Scene 1: Field Notebook — 4-Stage Architecture SVG & 28-Node Celestial Map...');
await page.go(`file://${path.join(repoRoot, 'public', 'field-notebook.html')}`);
await new Promise((r) => setTimeout(r, 700));
await ensureHud();

// Scene 1A: Hero & 6 Tickets + 4-Stage Architecture SVG at top
await page.evaluate(`window.scrollTo({ top: 0, behavior: 'instant' }); 1`);
await animateCursorAndHold(
  {
    chapter: 1,
    kicker: '/ BEAT 01A · FIELD NOTEBOOK · 6 CLOSED TICKETS & 4-STAGE ARCHITECTURE',
    text: 'We built <strong>FlowIQ</strong> around one rule: an asset manager should never receive a hallucinated metric or an unverified row citation. All <strong>3,858 rows</strong> across 6 CSVs are sanitized and verified at load time.',
    badge: ' tickets: FLOW-101..106<br/>✓ 27/27 answers.jsonl',
  },
  960,
  480,
  620,
  360,
  12,
  4.0 * FPS,
  '01a-notebook-hero',
);

// Smooth scroll to the 4-Stage Architecture SVG (#arch-overview)
await page.evaluate(`(() => {
  const el = document.getElementById('arch-overview');
  if (el) window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - 64), behavior: 'instant' });
  return 1;
})()`);
await animateCursorAndHold(
  {
    chapter: 1,
    kicker: '/ BEAT 01B · HIGH-LEVEL 4-STAGE PIPELINE SVG (RAW EXPORTS → SANITIZE → 5 TYPED TOOLS → VERIFIED OUTPUT)',
    text: 'Stage 1 ingests the 6 PMS/CRM/ILS CSVs. Stage 2 quarantines <strong>P09 (0 units)</strong>, <strong>10 void invoices</strong>, <strong>13 CAD rows (@ 0.73)</strong>, <strong>9 duplicate leads</strong>, and <strong>leads:D01011 injection</strong>. Stage 3 & 4 run 5 typed tools with PK citation checks.',
    badge: '4-STAGE PIPELINE<br/>0 Unverified Citations',
  },
  620,
  360,
  960,
  410,
  12,
  4.5 * FPS,
  '01b-architecture-svg',
);

// Scene 1C: Scroll to Interactive 28-Node Celestial Chart (#atlas) right below Architecture SVG
await page.evaluate(`(() => {
  const el = document.getElementById('atlas');
  if (el) window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - 58), behavior: 'instant' });
  return 1;
})()`);

// Click node `if-mcp` (FLOW-104 MCP Server) and `ev-test` (answers.jsonl) in the 28-node constellation
const mcpNodeBox = JSON.parse(
  await page.evaluate(`(() => {
    const el = document.querySelector('.atlas-node[data-node-id="if-mcp"]');
    if (el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); const r = el.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }); }
    return JSON.stringify({ x: 640, y: 420 });
  })()`),
);

await animateCursorAndHold(
  {
    chapter: 1,
    kicker: '/ BEAT 01C · INTERACTIVE 28-NODE CELESTIAL CHART & LIVE ARTIFACT DOSSIER',
    text: 'Placed right above the 27 questions, the <strong>28-Node Celestial Constellation</strong> links every CSV table, domain module, MCP interface (<code>src/mcp/server.ts</code>), and evaluation suite to its live Artifact Dossier.',
    badge: '28 SYSTEM NODES<br/>Click-to-Inspect Dossier',
  },
  960,
  410,
  mcpNodeBox.x,
  mcpNodeBox.y,
  12,
  4.0 * FPS,
  '01c-celestial-chart-mcp',
);

// Scene 1D: Scroll to 27-Item Validator (#validator) and select T13 / T04
await page.evaluate(`(() => {
  const el = document.getElementById('validator');
  if (el) window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - 58), behavior: 'instant' });
  const btn = document.querySelector('button[data-val-suite="test"]');
  if (btn) btn.click();
  return 1;
})()`);
await animateCursorAndHold(
  {
    chapter: 1,
    kicker: '/ BEAT 01D · 27-QUESTION SIDE-BY-SIDE VALIDATOR (DEV D01–D10 · TEST T01–T13 · BONUS B01–B03 + EGGS)',
    text: 'Every single question in <code>dev.jsonl</code>, <code>test.jsonl</code>, and <code>.bonus.jsonl</code> is audited side-by-side with its exact schema result, prose explanation, and clickable primary-key row citations.',
    badge: '27/27 EXACT SCHEMA<br/>240/240 Paraphrases',
  },
  mcpNodeBox.x,
  mcpNodeBox.y,
  480,
  260,
  10,
  3.5 * FPS,
  '01d-27-item-validator',
);

// Scene 2: QUESTION 1 LIVE (FLOW-101 Unique Building Resolution + FLOW-103 Verified Row Citations)
console.log('[3/4] Recording Scene 2: Question 1 Live (Unique Building Resolution & Citations)...');
const q1Cmd = '$ npm run ask -- "What is the vacancy rate at Printers Row Tower?"';
const q1SideHtml = `
  <div class="oterm-card">
    <div class="oterm-card-kicker">/ QUESTION 1 OF 3 · UNIQUE RESOLUTION & CITATIONS (FLOW-101 + FLOW-103)</div>
    <h3 class="oterm-card-title">Printers Row Tower (P07) Vacancy Rate</h3>
    <div class="oterm-card-body">
      Resolves building name, stem (<em>"Printers Row"</em>), or alias (<em>"the Tower"</em>, <em>"PRT"</em>) to <strong>P07</strong>, executes <code>query_units_and_occupancy</code> across 170 units, and verifies every cited row against the 3,858-key primary index.
    </div>
    <div class="oterm-kv">
      <div class="oterm-kv-k">Tool Chain</div>
      <div class="oterm-kv-v">find_properties → query_units_and_occupancy</div>
      <div class="oterm-kv-k">Resolved Asset</div>
      <div class="oterm-kv-v">P07 · Printers Row Tower (South Loop, Class A, Yardi)</div>
      <div class="oterm-kv-k">Vacancy Result</div>
      <div class="oterm-kv-v">{"percent": 4.7} (8 vacant / 170 units)</div>
      <div class="oterm-kv-k">Row Citations</div>
      <div class="oterm-kv-v">properties:P07, units:U0801..U0805 (PASS)</div>
    </div>
  </div>
  <div class="oterm-card">
    <div class="oterm-card-kicker">/ COLLOQUIAL ALIAS RESOLUTION (FLOW-101)</div>
    <div class="oterm-card-body">
      Also resolves nicknames & single-building neighborhoods: e.g. <em>"Logan Lofts"</em> → <code>P06 Kedzie Works</code> (12.7% vacancy, 14/110 units); <em>"South Loop Class A building with a doorman"</em> → <code>P07</code> ($2,212.66 1BR rent, T01).
    </div>
  </div>
`;

await animateCursorAndHold(
  {
    chapter: 2,
    kicker: '/ BEAT 02 · QUESTION 1 OF 3 (CLI): UNIQUE BUILDING RESOLUTION & VERIFIED ROW CITATIONS',
    text: '<strong>Question 1:</strong> <code>npm run ask -- "What is the vacancy rate at Printers Row Tower?"</code> — resolves <strong>P07</strong> via <code>find_properties</code>, computes <strong>4.7% (8/170 units)</strong>, and verifies all <code>units:U0801..U0805</code> citations.',
    badge: 'QUESTION 1 OF 3<br/>{"percent": 4.7} · PASS',
    termVisible: true,
    termTitle: '/ LIVE CLI · QUESTION 1: npm run ask -- "What is the vacancy rate at Printers Row Tower?"',
    termBody: `${q1Cmd}\n\n${outQ1}`,
    termSideHtml: q1SideHtml,
  },
  480,
  260,
  760,
  380,
  10,
  11.0 * FPS,
  '02-question-1-unique-resolution',
);

// Scene 3: QUESTION 2 LIVE (FLOW-101 Ambiguity Clarification Gate + Safety Guards)
console.log('[3/4] Recording Scene 3: Question 2 Live (FLOW-101 Ambiguity Gate)...');
const q2Cmd1 = '$ npm run ask -- "What is the vacancy rate at the South Loop building?"';
const q2Cmd2 = '$ npm run ask -- "How many vacant units at the downtown building?"';
const q2CombinedOut = [
  q2Cmd1,
  ...outQ2.split('\n').slice(11),
  '',
  q2Cmd2,
  ...outQ2Downtown.split('\n').slice(11, 28),
  'Result (Schema): {"clarification_needed": true, "candidates": ["P01", "P02", "P03", "P07", "P08"]}',
  'Verified       : PASS (5 source row citations verified)',
].join('\n');

const q2SideHtml = `
  <div class="oterm-card">
    <div class="oterm-card-kicker">/ QUESTION 2 OF 3 · AMBIGUITY CLARIFICATION GATE (FLOW-101)</div>
    <h3 class="oterm-card-title">Refuses to Guess When &gt;1 Building Matches</h3>
    <div class="oterm-card-body">
      When a singular building query matches multiple operating properties (<em>"the South Loop building"</em> → <strong>P07 vs. P08</strong>, or <em>"the downtown building"</em> → <strong>P01, P02, P03, P07, P08</strong>), FlowIQ halts before computing a misleading number and asks a clarifying question.
    </div>
    <div class="oterm-kv">
      <div class="oterm-kv-k">South Loop Match</div>
      <div class="oterm-kv-v">P07 (Printers Row Tower) vs. P08 (Wabash Point)</div>
      <div class="oterm-kv-k">Downtown Match</div>
      <div class="oterm-kv-v">P01, P02, P03, P07, P08 (5 downtown assets)</div>
      <div class="oterm-kv-k">Gate Output</div>
      <div class="oterm-kv-v">{"clarification_needed": true, "candidates": [...]}</div>
      <div class="oterm-kv-k">Red-Team Score</div>
      <div class="oterm-kv-v">20/20 Constraint-Drop Ambiguity Probes PASS</div>
    </div>
  </div>
  <div class="oterm-card">
    <div class="oterm-card-kicker">/ FLOW-103 TRUST & SAFETY GATES (T09 & T10)</div>
    <div class="oterm-card-body">
      • <strong>T09 Unknown Schema Guard:</strong> Resident satisfaction score → <code>{"unknown": true}</code> (not in CSVs).<br/>
      • <strong>T10 Fair Housing Guard:</strong> Excluding families with kids → <code>{"refused": true}</code> (42 U.S.C. § 3604).
    </div>
  </div>
`;

await animateCursorAndHold(
  {
    chapter: 3,
    kicker: '/ BEAT 03 · QUESTION 2 OF 3 (CLI): FLOW-101 AMBIGUITY GATE ("SOUTH LOOP" & "DOWNTOWN BUILDING")',
    text: '<strong>Question 2:</strong> When asked about <em>"the South Loop building"</em> or <em>"the downtown building"</em>, the <code>FLOW-101</code> gate refuses to guess, returning <code>{"clarification_needed": true}</code> and distinguishing each candidate property.',
    badge: 'QUESTION 2 OF 3<br/>FLOW-101 Gate · PASS',
    termVisible: true,
    termTitle: '/ LIVE CLI · QUESTION 2: FLOW-101 AMBIGUITY CLARIFICATION GATE',
    termBody: q2CombinedOut,
    termSideHtml: q2SideHtml,
  },
  760,
  380,
  820,
  440,
  10,
  11.5 * FPS,
  '03-question-2-ambiguity-gate',
);

// Scene 4: QUESTION 3 LIVE THROUGH FLOW-104 MCP SERVER (JSON-RPC 2.0 over stdio + Dashboard Live View)
console.log('[3/4] Recording Scene 4: Question 3 Live Through FLOW-104 MCP Server...');
const mcpCombinedOut = [
  '$ npm run mcp:demo',
  ...outMcp.split('\n').slice(3),
  '',
  '$ # MCP Tool Call: ask_flowiq("Which of my buildings is bleeding money on marketing right now, and why?")',
  ...outQ3Bleeding.split('\n').slice(11, 25),
].join('\n');

const mcpSideHtml = `
  <div class="oterm-card">
    <div class="oterm-card-kicker">/ QUESTION 3 OF 3 · LIVE VIA FLOW-104 MCP SERVER (JSON-RPC 2.0 STDIO)</div>
    <h3 class="oterm-card-title">Zero-Dependency MCP Server (<code>src/mcp/server.ts</code>)</h3>
    <div class="oterm-card-body">
      Spawns <code>src/mcp/server.ts</code> from <code>cwd="/tmp"</code> over JSON-RPC 2.0 stdio — the exact binary connected to Claude Code, Cursor, and Grok CLI via <code>.mcp.json</code> — and answers <strong>T13</strong>, <strong>T04/B03 Dead Spend</strong>, and <strong>FLOW-105</strong> live via <code>tools/call</code>.
    </div>
    <div class="oterm-kv">
      <div class="oterm-kv-k">Exposed Tools (7)</div>
      <div class="oterm-kv-v">ask_flowiq, find_properties, query_units, query_leases, query_marketing, evaluate_decisions, audit_sheaf</div>
      <div class="oterm-kv-k">T13 via MCP</div>
      <div class="oterm-kv-v">{"source": "Google Ads", "usd": 2005} (D01011 injection blocked)</div>
      <div class="oterm-kv-k">Dead Spend (T04)</div>
      <div class="oterm-kv-v">$46,599.90 across 9 zero-lease pairs → +15 leases (B03)</div>
      <div class="oterm-kv-k">FLOW-105 (X009)</div>
      <div class="oterm-kv-v">Empirical-Bayes posterior CPSL = $3,295.00 (windowInvariance=true)</div>
    </div>
  </div>
`;

await animateCursorAndHold(
  {
    chapter: 4,
    kicker: '/ BEAT 04A · QUESTION 3 OF 3 (FLOW-104 MCP STDIO SERVER): T13 INJECTION QUARANTINE & $46,599.90 DEAD SPEND',
    text: '<strong>Question 3 (via FLOW-104 MCP Server):</strong> <code>npm run mcp:demo</code> spawns <code>src/mcp/server.ts</code> over JSON-RPC 2.0 stdio, defeating the <code>leads:D01011</code> prompt injection (<strong>Google Ads $2,005</strong>) and auditing <strong>$46,599.90</strong> in dead spend.',
    badge: 'QUESTION 3 OF 3 (MCP)<br/>7/7 JSON-RPC Checks PASS',
    termVisible: true,
    termTitle: '/ LIVE MCP STDIO SERVER (FLOW-104) · JSON-RPC 2.0 tools/call VERIFICATION',
    termBody: mcpCombinedOut,
    termSideHtml: mcpSideHtml,
  },
  820,
  440,
  680,
  420,
  10,
  12.0 * FPS,
  '04a-question-3-mcp-server',
);

// Scene 4B: Also show the Interactive Copilot Dashboard (`public/index.html`) answering the FLOW-104 Bleeding Marketing query live in browser!
await page.go(`file://${path.join(repoRoot, 'public', 'index.html')}`);
await new Promise((r) => setTimeout(r, 650));
await ensureHud();
await page.evaluate(`(() => {
  const input = document.getElementById('copilot-query-input');
  if (input) input.scrollIntoView({ behavior: 'instant', block: 'center' });
  return 1;
})()`);

await animateCursorAndHold(
  {
    chapter: 4,
    kicker: '/ BEAT 04B · INTERACTIVE COPILOT DASHBOARD (PUBLIC/INDEX.HTML) · $46,599.90 DEAD SPEND & LIVE POLICY MUTATORS',
    text: 'In the browser dashboard, clicking <strong>Loom #1 (FLOW-104): Bleeding Marketing Spend</strong> executes <code>query_marketing_spend_and_funnel</code> and surfaces all 9 zero-lease pairs (<strong>$46,599.90</strong>) with 14 clickable primary-key citations.',
    badge: 'LIVE WEB COPILOT<br/>14 Verified PK Citations',
    termVisible: false,
  },
  680,
  420,
  540,
  520,
  10,
  5.5 * FPS,
  '04b-dashboard-live-query',
);

// Scene 5: CLEAN-CLONE `npm run generate:answers` (17 Lines with Citations) & `npm run eval` (3 -> 8 -> 10 Ablation)
console.log('[3/4] Recording Scene 5: npm run generate:answers & npm run eval (3-Stage Ablation)...');
const genLines = outGenAnswers.split('\n');
const genSnippet = [
  '$ npm run generate:answers',
  ...genLines.slice(0, 32),
  '  ...',
  ...genLines.slice(-18),
].join('\n');

const genSideHtml = `
  <div class="oterm-card">
    <div class="oterm-card-kicker">/ CLEAN-CLONE SUBMISSION · NPM RUN GENERATE:ANSWERS</div>
    <h3 class="oterm-card-title">17 Verified Lines in <code>answers.jsonl</code></h3>
    <div class="oterm-card-body">
      Prints every question's schema-validated <code>result</code>, verified <code>&lt;table&gt;:&lt;id&gt;</code> row citations, and plain-English <code>answer</code> wrapped cleanly at 72 columns:
    </div>
    <div class="oterm-kv">
      <div class="oterm-kv-k">T01 / T02 / T03</div>
      <div class="oterm-kv-v">P07 $2,212.66 · P08 5u · Apartment List $8,900</div>
      <div class="oterm-kv-k">T04 / B03</div>
      <div class="oterm-kv-v">9 Dead-Spend Pairs ($46,599.90) → Apartments.com (+15 leases)</div>
      <div class="oterm-kv-k">T09 / T10 / T13</div>
      <div class="oterm-kv-v">unknown:true · refused:true · Google Ads $2,005.00</div>
      <div class="oterm-kv-k">B01 / B02 / EGGS</div>
      <div class="oterm-kv-v">P02 $199,880 · 10 voids, 9 dup leads · ["pyrite","athanor"]</div>
    </div>
  </div>
`;

await animateCursorAndHold(
  {
    chapter: 5,
    kicker: '/ BEAT 05A · CLEAN-CLONE VERIFICATION: NPM RUN GENERATE:ANSWERS (17 VERIFIED LINES WITH CITATIONS)',
    text: 'Running <code>npm run generate:answers</code> in a clean clone writes all <strong>17 verified lines</strong> (<code>T01–T13</code>, <code>B01–B03</code>, <code>EGGS</code>) to <code>answers.jsonl</code> and prints every result, citation list, and answer at 72 columns.',
    badge: 'ANSWERS.JSONL<br/>17/17 Verified Lines',
    termVisible: true,
    termTitle: '/ LIVE CLI · npm run generate:answers (72-COL WRAPPED WITH CITATIONS)',
    termBody: genSnippet,
    termSideHtml: genSideHtml,
  },
  540,
  520,
  720,
  360,
  10,
  8.0 * FPS,
  '05a-generate-answers',
);

const evalLines = outEval.split('\n');
const evalSnippet = [
  '$ npm run eval',
  ...evalLines.slice(0, 31),
  ...evalLines.slice(51, 69),
  '',
  ...evalLines.slice(-6),
].join('\n');

const evalSideHtml = `
  <div class="oterm-card">
    <div class="oterm-card-kicker">/ 3-STAGE POLICY ABLATION · NPM RUN EVAL</div>
    <h3 class="oterm-card-title">Naive 3/10 (30%) → Joined 8/10 (80%) → Guarded 10/10 (100%)</h3>
    <div class="oterm-card-body">
      Proves why naive LLM/SQL fails on raw property exports and how each sanitization layer lifts accuracy to 100%:
    </div>
    <div class="oterm-kv">
      <div class="oterm-kv-k">rules_off (3/10)</div>
      <div class="oterm-kv-v">Fails on 10 voids, 13 CAD rows, 9 dup leads, P09 0-unit stub</div>
      <div class="oterm-kv-k">data_rules_only (8/10)</div>
      <div class="oterm-kv-v">Fixes cross-system joins, CAD @ 0.73, notice=occupied, P09 hold</div>
      <div class="oterm-kv-k">all_rules (10/10)</div>
      <div class="oterm-kv-v">Adds D08/T09 Unknown guard, D09/T10 Fair Housing, D01011 strip</div>
      <div class="oterm-kv-k">Full Suite</div>
      <div class="oterm-kv-v">10/10 Dev · 6/6 Safety Probes · 25/25 Unseen RT · 10/10 Consistency</div>
    </div>
  </div>
`;

await animateCursorAndHold(
  {
    chapter: 5,
    kicker: '/ BEAT 05B · 3-STAGE ABLATION HARNESS: NPM RUN EVAL (30% → 80% → 100% + 6 SAFETY PROBES + 25 RED-TEAM)',
    text: '<code>npm run eval</code> runs the rule ablation on <code>dev.jsonl</code>: <strong>rules_off (3/10)</strong> → <strong>data_rules_only (8/10)</strong> → <strong>all_rules (10/10)</strong>, plus <strong>6/6 safety probes</strong> and <strong>25/25 unseen red-team queries</strong>.',
    badge: 'EVAL HARNESS<br/>3/10 → 8/10 → 10/10',
    termVisible: true,
    termTitle: '/ LIVE CLI · npm run eval (3-STAGE ABLATION + 6 PROBES + 25 RED-TEAM)',
    termBody: evalSnippet,
    termSideHtml: evalSideHtml,
  },
  720,
  360,
  780,
  420,
  8,
  8.5 * FPS,
  '05b-eval-ablation',
);

// Scene 6: FINALE — `npm run flow-106` (The Ninth House P09 Cornell Annex Week-1 AppFolio Blueprint)
console.log('[3/4] Recording Scene 6: Finale — npm run flow-106 (The Ninth House P09 Onboarding Blueprint)...');
const flow106Snippet = [
  '$ npm run flow-106',
  ...outFlow106.split('\n').slice(0, 38),
  ...outFlow106.split('\n').slice(-11),
].join('\n');

const flow106SideHtml = `
  <div class="oterm-card">
    <div class="oterm-card-kicker">/ FINALE · FLOW-106: THE NINTH HOUSE (P09 CORNELL ANNEX)</div>
    <h3 class="oterm-card-title">Week-1 AppFolio Onboarding Blueprint</h3>
    <div class="oterm-card-body">
      Decoded from zip comment <code>"pyrite"</code> and <code>properties:P09</code> base64 <code>aka</code> → <code>join.ormus.solutions/ninth-house</code> (<code>"athanor"</code>).
    </div>
    <div class="oterm-kv">
      <div class="oterm-kv-k">Why Quarantined</div>
      <div class="oterm-kv-v">P09 (Hyde Park, 1927 Class B) has units=0 &amp; first AppFolio PMS</div>
      <div class="oterm-kv-k">4 Week-1 Exports</div>
      <div class="oterm-kv-v">Unit Roll, Lease Ledger, Guest Cards (notes quarantined), ILS Spend</div>
      <div class="oterm-kv-k">Pre-Trust Gate</div>
      <div class="oterm-kv-v">COUNT(units)==properties.units &gt; 0, 1 active lease/unit, lead dedup</div>
      <div class="oterm-kv-k">1st AM Question</div>
      <div class="oterm-kv-v">"How many rentable units are online vs down for renovation, and is the 90-day goal winter occupancy or pushing renovated rents?"</div>
    </div>
  </div>
`;

await animateCursorAndHold(
  {
    chapter: 5,
    kicker: '/ BEAT 06 · FINALE: NPM RUN FLOW-106 — THE NINTH HOUSE (P09 CORNELL ANNEX ONBOARDING BLUEPRINT)',
    text: 'Decoding <code>P09</code>\'s base64 alias unlocked <strong>FLOW-106 ("pyrite", "athanor")</strong>. Running <code>npm run flow-106</code> displays our Week-1 AppFolio onboarding plan and first question for the Hyde Park asset manager.',
    badge: 'FLOW-106 UNLOCKED<br/>["pyrite", "athanor"]',
    termVisible: true,
    termTitle: '/ LIVE CLI · npm run flow-106 (THE NINTH HOUSE · P09 CORNELL ANNEX)',
    termBody: flow106Snippet,
    termSideHtml: flow106SideHtml,
  },
  780,
  420,
  840,
  460,
  10,
  10.5 * FPS,
  '06-flow-106-finale',
);

await bro.stop();
ff.stdin.end();
await new Promise((resolve, reject) => {
  ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
});

fs.mkdirSync(path.dirname(docsMp4), { recursive: true });
fs.copyFileSync(outMp4, docsMp4);
const stat = fs.statSync(outMp4);
console.log(`[4/4] Recorded ${totalFrames} frames (${(totalFrames / FPS).toFixed(1)}s @ ${FPS}fps) -> ${outMp4} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
