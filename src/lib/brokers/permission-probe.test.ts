import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { classifyProbeOutcome } from "./permission-probe.ts";

describe("classifyProbeOutcome — success", () => {
  it("returns full_access when the call succeeded with empty rules", () => {
    const result = classifyProbeOutcome({ ok: true, rules: [] });
    assert.equal(result.level, "full_access");
    assert.equal(result.httpStatus, 200);
  });

  it("returns full_access when the call succeeded with rules", () => {
    const result = classifyProbeOutcome({
      ok: true,
      // Classifier does not inspect rule contents — any non-error outcome is full_access.
      rules: [{ id: 1 }, { id: 2 }],
    });
    assert.equal(result.level, "full_access");
  });

  it("reason mentions Account Risk Settings on success", () => {
    const result = classifyProbeOutcome({ ok: true, rules: [] });
    assert.ok(result.reason.includes("Account Risk Settings"));
  });
});

describe("classifyProbeOutcome — permission denied", () => {
  it("returns read_only when the error has statusCode 403", () => {
    const result = classifyProbeOutcome({
      ok: false,
      error: { statusCode: 403, message: "forbidden" },
    });
    assert.equal(result.level, "read_only");
    assert.equal(result.httpStatus, 403);
  });

  it("returns read_only when the error has statusCode 401", () => {
    const result = classifyProbeOutcome({
      ok: false,
      error: { statusCode: 401, message: "unauthorized" },
    });
    assert.equal(result.level, "read_only");
    assert.equal(result.httpStatus, 401);
  });

  it("reason mentions permission missing on 403", () => {
    const result = classifyProbeOutcome({
      ok: false,
      error: { statusCode: 403 },
    });
    assert.ok(result.reason.includes("permission missing"));
  });
});

describe("classifyProbeOutcome — inconclusive", () => {
  it("returns unknown for 5xx server errors", () => {
    const result = classifyProbeOutcome({
      ok: false,
      error: { statusCode: 500, message: "server error" },
    });
    assert.equal(result.level, "unknown");
    assert.equal(result.httpStatus, 500);
  });

  it("returns unknown for unexpected 4xx errors (not auth)", () => {
    const result = classifyProbeOutcome({
      ok: false,
      error: { statusCode: 404, message: "not found" },
    });
    assert.equal(result.level, "unknown");
  });

  it("returns unknown for network errors with no statusCode", () => {
    const result = classifyProbeOutcome({
      ok: false,
      error: new Error("ECONNRESET"),
    });
    assert.equal(result.level, "unknown");
    assert.equal(result.httpStatus, null);
  });

  it("returns unknown for non-Error thrown values", () => {
    const result = classifyProbeOutcome({
      ok: false,
      error: "some string thrown",
    });
    assert.equal(result.level, "unknown");
    assert.equal(result.httpStatus, null);
  });

  it("reason for network error indicates non-determinable", () => {
    const result = classifyProbeOutcome({
      ok: false,
      error: new Error("network down"),
    });
    assert.ok(result.reason.includes("not determinable"));
  });
});
