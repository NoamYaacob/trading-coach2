import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isFutureTradeDate } from "./trade-date-validation.ts";

const NOW = new Date("2026-04-30T14:00:00.000Z");

describe("isFutureTradeDate", () => {
  it("tomorrow is future → blocked", () => {
    assert.equal(isFutureTradeDate(new Date("2026-05-01T10:00:00Z"), NOW), true);
  });

  it("later today is future → blocked", () => {
    assert.equal(isFutureTradeDate(new Date("2026-04-30T18:00:00Z"), NOW), true);
  });

  it("1 minute from now is future → blocked", () => {
    assert.equal(isFutureTradeDate(new Date(NOW.getTime() + 60_000), NOW), true);
  });

  it("1 second from now is future → blocked", () => {
    assert.equal(isFutureTradeDate(new Date(NOW.getTime() + 1_000), NOW), true);
  });

  it("exactly now is allowed (not strictly after)", () => {
    assert.equal(isFutureTradeDate(NOW, NOW), false);
  });

  it("1 minute ago is allowed", () => {
    assert.equal(isFutureTradeDate(new Date(NOW.getTime() - 60_000), NOW), false);
  });

  it("yesterday is allowed", () => {
    assert.equal(isFutureTradeDate(new Date("2026-04-29T14:00:00Z"), NOW), false);
  });

  it("past trade from last week is allowed", () => {
    assert.equal(isFutureTradeDate(new Date("2026-04-22T10:00:00Z"), NOW), false);
  });

  it("tolerance: within tolerance window is allowed", () => {
    const TOLERANCE_MS = 60_000;
    const slightlyFuture = new Date(NOW.getTime() + 30_000); // 30s ahead
    assert.equal(isFutureTradeDate(slightlyFuture, NOW, TOLERANCE_MS), false);
  });

  it("tolerance: beyond tolerance is still blocked", () => {
    const TOLERANCE_MS = 60_000;
    const clearlyFuture = new Date(NOW.getTime() + 90_000); // 90s ahead
    assert.equal(isFutureTradeDate(clearlyFuture, NOW, TOLERANCE_MS), true);
  });
});
