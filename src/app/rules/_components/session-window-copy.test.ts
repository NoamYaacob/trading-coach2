import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { SESSION_WINDOW_COPY } from "./session-window-copy.ts";

describe("SESSION_WINDOW_COPY", () => {
  test("legend says CME time", () => {
    assert.match(SESSION_WINDOW_COPY.legend, /CME time/);
  });

  test("helperText references America/Chicago", () => {
    assert.match(SESSION_WINDOW_COPY.helperText, /America\/Chicago/);
  });

  test("helperText mentions daylight-saving alignment", () => {
    assert.match(SESSION_WINDOW_COPY.helperText, /daylight.saving/i);
  });

  test("startLabel mentions CME hour", () => {
    assert.match(SESSION_WINDOW_COPY.startLabel, /CME hour/i);
  });

  test("endLabel mentions CME hour", () => {
    assert.match(SESSION_WINDOW_COPY.endLabel, /CME hour/i);
  });

  test("legend does not mention Israel or local timezone", () => {
    assert.ok(!/israel/i.test(SESSION_WINDOW_COPY.legend));
  });
});
