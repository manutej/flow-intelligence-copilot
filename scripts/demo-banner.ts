// FLOWIQ-SITE-005: a plain "this is a demo" banner above the command bar.
// Counts and the as-of date come from the loaded data, never from literals.
import fs from "node:fs";
import type { PortfolioStore } from "../src/data/schema.ts";

const START = "<!--demo-banner:start-->";
const END = "<!--demo-banner:end-->";
// Contact target is an open build question in FLOWIQ-SITE-005; the repo page is the placeholder.
export const DEMO_CONTACT_HREF = "https://github.com/manutej/flow-intelligence-copilot";

export function demoStats(store: PortfolioStore) {
  const operating = new Set(store.operatingProperties.map((p) => p.propertyId));
  return {
    buildings: store.operatingProperties.length,
    units: store.units.filter((u) => operating.has(u.propertyId)).length,
    asOf: store.policy.asOfDate,
  };
}

export function asOfLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function demoBannerHtml(store: PortfolioStore): string {
  const s = demoStats(store);
  return `${START}
  <div id="demo-banner" role="note" style="margin:0 0 12px;padding:10px 14px;border:1px solid #c9a227;border-radius:8px;background:#fff8e1;color:#3b2f00;font-size:14px;line-height:1.45">
    <strong>Demo portfolio:</strong> <span data-demo="buildings">${s.buildings}</span> Chicago buildings, <span data-demo="units">${s.units.toLocaleString("en-US")}</span> units, data as of <span data-demo="as-of">${asOfLabel(s.asOf)}</span>. Your data isn't uploaded here.
    <a id="demo-contact" href="${DEMO_CONTACT_HREF}" style="color:#5a4300;font-weight:600">Want this on your portfolio? Contact</a>
    <div id="privacy-note" style="font-size:12px;margin-top:4px;opacity:.85">Privacy: questions you type are sent to FlowIQ to answer them over this demo data only; nothing is stored to your account and no personal data is collected.</div>
  </div>
  ${END}`;
}

/** Insert or refresh the banner right before the command bar section. */
export function applyDemoBanner(html: string, store: PortfolioStore): string {
  const block = demoBannerHtml(store);
  const a = html.indexOf(START);
  if (a >= 0) {
    const b = html.indexOf(END, a);
    return html.slice(0, a) + block + html.slice(b + END.length);
  }
  const anchor = html.indexOf('<section id="ask"');
  if (anchor < 0) return html;
  return html.slice(0, anchor) + block + "\n  " + html.slice(anchor);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { loadPortfolioStore } = await import("../src/data/loader.ts");
  const store = loadPortfolioStore();
  for (const f of process.argv.slice(2)) {
    fs.writeFileSync(f, applyDemoBanner(fs.readFileSync(f, "utf-8"), store));
    console.log(`demo banner -> ${f}`);
  }
}
