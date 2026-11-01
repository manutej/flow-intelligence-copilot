import test from "node:test";
import assert from "node:assert/strict";
import { ratePercent1 } from "../src/data/rate.ts";

test("23/80 rounds half up to 28.8", () => {
  assert.equal(ratePercent1(23, 80), 28.8);
  assert.equal(ratePercent1(0, 0), 0);
});

test("sweep: matches exact rational half-up rounding for d<=400", () => {
  for (let d = 1; d <= 400; d++) {
    for (let n = 0; n <= d; n++) {
      // exact: tenths = floor(1000n/d + 1/2) computed with BigInt
      const tenths = (BigInt(2000 * n) + BigInt(d)) / BigInt(2 * d);
      assert.equal(ratePercent1(n, d), Number(tenths) / 10, `${n}/${d}`);
    }
  }
});
