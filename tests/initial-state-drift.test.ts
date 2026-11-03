// FIX-FLOWIQ-BUILD-INPUT (Tau ruling a): the INITIAL_STATE embedded in the
// built pages is a frozen artifact. build-dashboard cannot reproduce it
// (wall-clock timings, a missing .toq swarm trace, later code changes), so
// never rerun it. Changing a page's state needs a reviewed ticket that
// updates the hashes below. Hashes pinned from 223fa68.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const MARKER = "const INITIAL_STATE = ";

export const PINNED_INITIAL_STATE_SHA256: Record<string, string> = {
  "docs/index.html": "a060729fc240a2957bd008a5d56b05bdc75d7fc88f7c1902f0421f9374c22e0e",
  "public/index.html": "bd9a5c36840112ca4c55b1f86718b3347b3be5bf59631d9f0aa5ed7b8d28afd2",
  "ui/flowiq-visual-studio.html": "bd9a5c36840112ca4c55b1f86718b3347b3be5bf59631d9f0aa5ed7b8d28afd2",
};

export function initialStateHash(html: string): string {
  const lines = html.split("\n").filter((l) => l.startsWith(MARKER));
  assert.equal(lines.length, 1, "expected exactly one INITIAL_STATE line");
  return crypto.createHash("sha256").update(lines[0] + "\n").digest("hex");
}

function pagesCarryingState(): string[] {
  const out: string[] = [];
  for (const dir of ["public", "ui", "docs"]) {
    const abs = path.join(repoRoot, dir);
    if (!fs.existsSync(abs)) continue;
    // local fs type shim omits readdirSync
    const readdir = (fs as unknown as { readdirSync(p: string): string[] }).readdirSync;
    for (const f of readdir(abs)) {
      if (!f.endsWith(".html")) continue;
      const html = fs.readFileSync(path.join(abs, f), "utf-8");
      if (html.split("\n").some((l) => l.startsWith(MARKER))) out.push(`${dir}/${f}`);
    }
  }
  return out.sort();
}

test("every page carrying INITIAL_STATE is pinned, and no pinned page is missing", () => {
  assert.deepEqual(pagesCarryingState(), Object.keys(PINNED_INITIAL_STATE_SHA256).sort());
});

for (const [rel, want] of Object.entries(PINNED_INITIAL_STATE_SHA256)) {
  test(`INITIAL_STATE in ${rel} matches the frozen hash`, () => {
    const html = fs.readFileSync(path.join(repoRoot, rel), "utf-8");
    assert.equal(initialStateHash(html), want,
      `${rel} INITIAL_STATE drifted. Do not rerun build-dashboard; see README "Frozen dashboard state".`);
  });
}

test("guard detects a one-byte change", () => {
  const html = fs.readFileSync(path.join(repoRoot, "public/index.html"), "utf-8");
  const i = html.indexOf(MARKER) + MARKER.length + 1;
  const mutated = html.slice(0, i) + (html[i] === "a" ? "b" : "a") + html.slice(i + 1);
  assert.notEqual(initialStateHash(mutated), PINNED_INITIAL_STATE_SHA256["public/index.html"]);
});
