import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { checkRateLimit } from "./rate-limit.ts";

// Use random keys so test runs don't share state via the module-level store.
function key(label: string): string {
  return `test:${label}:${Math.random()}`;
}

describe("checkRateLimit", () => {
  it("allows requests within the limit", () => {
    const k = key("within");
    for (let i = 0; i < 5; i++) {
      assert.equal(checkRateLimit(k, 5, 60_000).ok, true, `request ${i + 1} should pass`);
    }
  });

  it("rejects the request that exceeds the limit", () => {
    const k = key("exceed");
    for (let i = 0; i < 3; i++) checkRateLimit(k, 3, 60_000);
    const result = checkRateLimit(k, 3, 60_000);
    assert.equal(result.ok, false);
  });

  it("includes a positive retryAfterSeconds on rejection", () => {
    const k = key("retry");
    checkRateLimit(k, 1, 60_000);
    const result = checkRateLimit(k, 1, 60_000);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.retryAfterSeconds >= 1, "retryAfterSeconds must be ≥ 1");
      assert.ok(result.retryAfterSeconds <= 60, "retryAfterSeconds must be ≤ window");
    }
  });

  it("tracks different keys independently", () => {
    const k1 = key("ind-a");
    const k2 = key("ind-b");
    for (let i = 0; i < 3; i++) checkRateLimit(k1, 3, 60_000);
    assert.equal(checkRateLimit(k1, 3, 60_000).ok, false, "k1 should be exhausted");
    assert.equal(checkRateLimit(k2, 3, 60_000).ok, true, "k2 should be unaffected");
  });

  it("respects a limit of 1", () => {
    const k = key("limit1");
    assert.equal(checkRateLimit(k, 1, 60_000).ok, true);
    assert.equal(checkRateLimit(k, 1, 60_000).ok, false);
  });

  it("expired window entries do not count", () => {
    const k = key("expired");
    // Saturate the limit with timestamps far in the past by manipulating via
    // a zero-ms window — any past timestamp is outside a 0ms window.
    // Instead, use a 1ms window and wait for it to expire.
    checkRateLimit(k, 1, 1);
    // After 2ms the single timestamp is outside the 1ms window.
    const start = Date.now();
    while (Date.now() - start < 5) {/* busy-wait 5 ms */}
    assert.equal(checkRateLimit(k, 1, 1).ok, true, "window expired — should allow again");
  });
});
