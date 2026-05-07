import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { isTradovateOrderActionsEnabled } from "./order-actions-flag.ts";

describe("isTradovateOrderActionsEnabled", () => {
  let savedEnv: string | undefined;

  before(() => {
    savedEnv = process.env.ENABLE_TRADOVATE_ORDER_ACTIONS;
  });

  after(() => {
    if (savedEnv === undefined) {
      delete process.env.ENABLE_TRADOVATE_ORDER_ACTIONS;
    } else {
      process.env.ENABLE_TRADOVATE_ORDER_ACTIONS = savedEnv;
    }
  });

  it("returns false when env var is not set", () => {
    delete process.env.ENABLE_TRADOVATE_ORDER_ACTIONS;
    assert.equal(isTradovateOrderActionsEnabled(), false);
  });

  it("returns false when env var is empty string", () => {
    process.env.ENABLE_TRADOVATE_ORDER_ACTIONS = "";
    assert.equal(isTradovateOrderActionsEnabled(), false);
  });

  it("returns false when env var is '1'", () => {
    process.env.ENABLE_TRADOVATE_ORDER_ACTIONS = "1";
    assert.equal(isTradovateOrderActionsEnabled(), false);
  });

  it("returns false when env var is 'yes'", () => {
    process.env.ENABLE_TRADOVATE_ORDER_ACTIONS = "yes";
    assert.equal(isTradovateOrderActionsEnabled(), false);
  });

  it("returns false when env var is 'TRUE' (wrong case)", () => {
    process.env.ENABLE_TRADOVATE_ORDER_ACTIONS = "TRUE";
    assert.equal(isTradovateOrderActionsEnabled(), false);
  });

  it("returns false when env var is 'True' (wrong case)", () => {
    process.env.ENABLE_TRADOVATE_ORDER_ACTIONS = "True";
    assert.equal(isTradovateOrderActionsEnabled(), false);
  });

  it("returns true only when env var is exactly 'true'", () => {
    process.env.ENABLE_TRADOVATE_ORDER_ACTIONS = "true";
    assert.equal(isTradovateOrderActionsEnabled(), true);
  });

  it("defaults to false — safe when env is misconfigured", () => {
    delete process.env.ENABLE_TRADOVATE_ORDER_ACTIONS;
    assert.equal(
      isTradovateOrderActionsEnabled(),
      false,
      "missing env must never enable live order actions",
    );
  });
});
