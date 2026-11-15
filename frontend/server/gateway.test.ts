import { test } from "vitest";
import assert from "node:assert/strict";
import {
  allowedOperatorPath,
  rangeSelection,
  safeObjectKey,
} from "./gateway.ts";
test("operator proxy accepts only exact known backend operations", () => {
  assert(allowedOperatorPath("POST", "/api/v1/analysis/flood"));
  assert(!allowedOperatorPath("POST", "/api/v1/catalog/nisar/search"));
  assert(!allowedOperatorPath("POST", "https://untrusted.invalid/download"));
  assert(!allowedOperatorPath("DELETE", "/api/v1/results/anything"));
});
test("artifact keys reject traversal and arbitrary URLs", () => {
  assert.equal(
    safeObjectKey("processed/synthetic/before_power.tif"),
    "processed/synthetic/before_power.tif",
  );
  for (const key of [
    "../.env",
    "/etc/passwd",
    "a/../../key",
    "https://untrusted.invalid/a",
    "a\\b",
  ])
    assert.throws(() => safeObjectKey(key));
});
test("COG range selection is bounded and rejects invalid/multiple ranges", () => {
  assert.deepEqual(rangeSelection("bytes=0-127", 1000), {
    start: 0,
    end: 127,
    partial: true,
  });
  assert.throws(() => rangeSelection("bytes=2000-3000", 1000));
  assert.throws(() => rangeSelection("bytes=0-2,5-8", 1000));
});
