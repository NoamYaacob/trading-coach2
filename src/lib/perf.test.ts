/**
 * Unit tests for the server-render performance helpers.
 * No DB, no network — runs with `node --test`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { withTimeout, timed } from "./perf.ts";

describe("withTimeout", () => {
  it("resolves with the value when the promise settles before the timeout", async () => {
    const v = await withTimeout(Promise.resolve(42), 1000, "fast");
    assert.equal(v, 42);
  });

  it("rejects when the promise exceeds the timeout", async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve("late"), 100));
    await assert.rejects(
      () => withTimeout(slow, 10, "slow"),
      /timeout: slow exceeded 10ms/,
    );
  });

  it("propagates the original rejection when the promise rejects first", async () => {
    const boom = Promise.reject(new Error("broker 401"));
    await assert.rejects(() => withTimeout(boom, 1000, "err"), /broker 401/);
  });

  it("does not keep the event loop alive after resolving (timer cleared)", async () => {
    // If the timer were not cleared, a 50s timeout would keep the process alive.
    const start = Date.now();
    await withTimeout(Promise.resolve("ok"), 50_000, "cleared");
    assert.ok(Date.now() - start < 1000, "must resolve immediately, not wait on the timer");
  });

  it("caller can fall back safely via .catch (never throws the page)", async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve("x"), 100));
    const result = await withTimeout(slow, 10, "fallback").catch(() => null);
    assert.equal(result, null, "timeout → null fallback, no throw");
  });
});

describe("timed", () => {
  it("returns the wrapped function's value", async () => {
    const v = await timed("trades", "step", "acct1", async () => 7);
    assert.equal(v, 7);
  });

  it("re-throws if the wrapped function throws (still logs)", async () => {
    await assert.rejects(
      () => timed("dashboard", "broker", "acct1", async () => { throw new Error("nope"); }),
      /nope/,
    );
  });
});
