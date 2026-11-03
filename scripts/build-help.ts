// FLOWIQ-SITE-007: a short /help page for first-time users, built from the
// loaded data (buildings, unit count, as-of date, data domains).
import fs from "node:fs";
import path from "node:path";
import type { PortfolioStore } from "../src/data/schema.ts";
import { dataDomains, EXAMPLE_QUESTIONS } from "../src/agent/copilot.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function renderHelpPage(store: PortfolioStore): string {
  const operating = new Set(store.operatingProperties.map((p) => p.propertyId));
  const units = store.units.filter((u) => operating.has(u.propertyId)).length;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FlowIQ help: what it can answer</title>
<style>body{font:16px/1.55 system-ui,sans-serif;max-width:720px;margin:32px auto;padding:0 16px;color:#1d1d1f}h1{font-size:26px}h2{font-size:18px;margin-top:28px}code{background:#f3f3f3;padding:1px 4px;border-radius:4px}</style>
</head><body>
<p><a href="/">&larr; Back to FlowIQ</a></p>
<h1>What FlowIQ can answer</h1>
<p>This is a <strong>demo portfolio</strong>, not your data. Type a question in the command bar and FlowIQ answers it from the exports below, citing the rows behind every figure. If the data can't answer a question, it says so.</p>
<h2>The data</h2>
<p>${store.operatingProperties.length} operating buildings, ${units.toLocaleString("en-US")} units, data as of <strong>${esc(store.policy.asOfDate)}</strong>.</p>
<ul id="help-buildings">${store.operatingProperties.map((p) => `<li>${esc(p.name)} <code>${esc(p.propertyId)}</code></li>`).join("")}</ul>
<h2>Data domains</h2>
<ul id="help-domains">${dataDomains(store).map((d) => `<li>${esc(d)}</li>`).join("")}</ul>
<h2>Example questions</h2>
<ul id="help-examples">${EXAMPLE_QUESTIONS.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>
<h2>What it can't do</h2>
<p>You can't upload a rent roll, connect a property management system, or add your own buildings on this site.</p>
</body></html>
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { loadPortfolioStore } = await import("../src/data/loader.ts");
  const out = path.resolve(new URL("../public/help.html", import.meta.url).pathname);
  fs.writeFileSync(out, renderHelpPage(loadPortfolioStore()));
  console.log(`help page -> ${out}`);
}
