import test from "node:test";
import assert from "node:assert/strict";
import { parseAsOfYearMonth, parseExplicitDateWindow } from "../src/agent/intent.ts";

test("as-of month 0 or 13 is rejected, not rolled over", () => {
  for (const bad of ["2026-00-01", "2026-13-01", "2026-1-01", "garbage"]) {
    assert.throws(() => parseAsOfYearMonth(bad), /month must be 01-12/, bad);
  }
});

test("valid as-of months parse, and December's next month is January", () => {
  assert.deepEqual(parseAsOfYearMonth("2026-01-15"), [2026, 1]);
  assert.deepEqual(parseAsOfYearMonth("2026-12-01"), [2026, 12]);
});

test("'next month' with an out-of-range as-of month throws a clear error", () => {
  assert.throws(() => (parseExplicitDateWindow as any)("leases ending next month", "2026-13-01"), /month must be 01-12/);
});
