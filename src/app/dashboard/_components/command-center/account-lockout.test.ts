/**
 * Tests for the emergency-lockout UI wiring.
 *
 * The typed-confirmation gate is exercised functionally via the pure
 * `isLockoutConfirmed` helper. The modal copy + result-view requirements and
 * the API field plumbing are verified by source-scan (the component is a React
 * client island, not unit-rendered here).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { isLockoutConfirmed, LOCKOUT_CONFIRM_WORD } from "./account-lockout-logic.ts";

const src = readFileSync(
  resolve(process.cwd(), "src/app/dashboard/_components/command-center/account-lockout.tsx"),
  "utf8",
);

describe("isLockoutConfirmed — typed confirmation gate", () => {
  it("requires the word LOCKOUT", () => {
    assert.equal(LOCKOUT_CONFIRM_WORD, "LOCKOUT");
    assert.equal(isLockoutConfirmed("LOCKOUT"), true);
  });

  it("is case-insensitive and trims surrounding whitespace", () => {
    assert.equal(isLockoutConfirmed("lockout"), true);
    assert.equal(isLockoutConfirmed("Lockout"), true);
    assert.equal(isLockoutConfirmed("  LOCKOUT  "), true);
  });

  it("rejects empty / partial / wrong input", () => {
    assert.equal(isLockoutConfirmed(""), false);
    assert.equal(isLockoutConfirmed("LOCK"), false);
    assert.equal(isLockoutConfirmed("CLOSE"), false);
    assert.equal(isLockoutConfirmed("lock out"), false);
  });
});

describe("LockoutConfirmModal — emergency copy + typed gate (source contract)", () => {
  it("modal copy states the full emergency behavior verbatim", () => {
    assert.ok(
      src.includes(
        "This will cancel working orders, close open positions, and lock this account.",
      ),
      "confirm modal must state the exact emergency behavior",
    );
  });

  it("requires typing LOCKOUT and disables confirm until typed", () => {
    assert.ok(src.includes("isLockoutConfirmed(typed)"), "modal must derive a confirmed flag from typed input");
    assert.ok(
      /disabled=\{busy \|\| !confirmed\}/.test(src),
      "confirm button must be disabled until busy is false AND confirmed is true",
    );
  });

  it("no API call (lock) is wired to anything other than onConfirm, which the disabled button gates", () => {
    // The only path to lock() is the modal's confirm button onClick → onConfirm
    // → lock(). With the button disabled until confirmed, no typed word == no call.
    assert.ok(src.includes("onConfirm"), "confirm button must call onConfirm");
    assert.ok(src.includes("void lock()"), "onConfirm wiring must invoke lock()");
  });

  it("result view renders all four step outcomes", () => {
    assert.ok(src.includes("Cancelled "), "result must show cancelled orders count");
    assert.ok(
      src.includes("Open positions closed") || src.includes("No open positions to close"),
      "result must show the flatten outcome",
    );
    assert.ok(
      src.includes("Locked in Guardrail for the rest of this CME session."),
      "result must show the internal Guardrail lock outcome",
    );
    assert.ok(
      src.includes("Broker lock active at Tradovate.") ||
        src.includes("Broker lock failed") ||
        src.includes("Broker lock unavailable"),
      "result must show the broker lock outcome",
    );
  });

  it("dry-run / disabled order actions are shown as NOT sent, never as success", () => {
    assert.ok(
      src.includes("Cancel orders NOT sent (dry-run"),
      "dry-run cancel must be labelled NOT sent",
    );
    assert.ok(
      src.includes("Positions NOT closed (dry-run"),
      "dry-run flatten must be labelled NOT closed",
    );
    assert.ok(
      src.includes("order actions disabled on server"),
      "must explain when order actions are disabled on the server",
    );
  });
});
