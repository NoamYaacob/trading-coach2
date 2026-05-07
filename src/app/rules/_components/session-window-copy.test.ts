import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { SESSION_WINDOW_COPY } from "./session-window-copy.ts";

describe("SESSION_WINDOW_COPY", () => {
  test("legend says 'Daily cutoff'", () => {
    assert.match(SESSION_WINDOW_COPY.legend, /Daily cutoff/);
  });

  test("legend says CME time", () => {
    assert.match(SESSION_WINDOW_COPY.legend, /CME time/);
  });

  test("helperText references CME time without exposing America/Chicago to users", () => {
    assert.match(SESSION_WINDOW_COPY.helperText, /CME time/);
    assert.ok(!/America\/Chicago/.test(SESSION_WINDOW_COPY.helperText), "America/Chicago must not appear in user-facing copy");
  });

  test("helperText mentions daylight-saving alignment", () => {
    assert.match(SESSION_WINDOW_COPY.helperText, /daylight.saving/i);
  });

  test("endLabel says 'Stop trading at'", () => {
    assert.match(SESSION_WINDOW_COPY.endLabel, /Stop trading at/);
  });

  test("endLabel mentions CME hour", () => {
    assert.match(SESSION_WINDOW_COPY.endLabel, /CME hour/i);
  });

  test("cutoffBehaviorLabel is 'At cutoff'", () => {
    assert.equal(SESSION_WINDOW_COPY.cutoffBehaviorLabel, "At cutoff");
  });

  test("legend does not mention Israel or local timezone", () => {
    assert.ok(!/israel/i.test(SESSION_WINDOW_COPY.legend));
  });

  test("SESSION_WINDOW_COPY does not expose startLabel (session start removed from product surface)", () => {
    assert.ok(!("startLabel" in SESSION_WINDOW_COPY), "startLabel must not be exported — it was removed with the session-window cleanup");
  });
});
