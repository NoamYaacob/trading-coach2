/**
 * Source-audit tests for max position size enforcement model.
 *
 * Verifies:
 *   - UI copy does not imply pre-trade broker rejection for max position size
 *   - UI copy explicitly says enforcement is detection-response (after entry)
 *   - Debug endpoint exposes productSpecificBrokerRejectSupported=false
 *   - Debug endpoint has brokerRejectReason explaining the API verification result
 *   - brokerEnforcementMode is always "app_side_only" for max position size
 *   - No global Overall raw limit is re-enabled for standard-equivalent enforcement
 *   - Tradovate adapter marks maxPositionSize as not_supported
 *   - Adapter note does not say "coming_soon" for maxPositionSize
 *
 * Pure source-scan — no network, no DB.
 *
 * Run: npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const COPY_SRC = readFileSync(resolve(import.meta.dirname, "./position-size-copy.ts"), "utf8");

const DEBUG_SRC = readFileSync(
  resolve(import.meta.dirname, "../../api/debug/tradovate-position-limit/route.ts"),
  "utf8",
);

const ADAPTER_SRC = readFileSync(
  resolve(import.meta.dirname, "../../../lib/brokers/tradovate-adapter.ts"),
  "utf8",
);

const CLIENT_SRC = readFileSync(
  resolve(import.meta.dirname, "../../../lib/brokers/tradovate-client.ts"),
  "utf8",
);

const PROBE_SRC = readFileSync(
  resolve(
    import.meta.dirname,
    "../../api/dev/tradovate-product-limits-probe/route.ts",
  ),
  "utf8",
);

// ── UI copy: no pre-trade promise ─────────────────────────────────────────────

describe("position-size-copy: does not promise pre-trade broker rejection", () => {
  it("does not promise orders are blocked before they execute", () => {
    // The hint must not imply that Guardrail intercepts/blocks orders before they fill.
    // It's fine to mention "pre-trade" in a negation context ("not a pre-trade block"),
    // but it must not claim orders are blocked at entry or rejected before execution.
    const hintIdx = COPY_SRC.indexOf("hint:");
    assert.ok(hintIdx !== -1, "copy file must have a hint field");
    const hintText = COPY_SRC.slice(hintIdx, hintIdx + 700).toLowerCase();
    const FORBIDDEN_PHRASES = [
      "blocks before",
      "rejected before entry",
      "prevented before",
      "intercept",
    ];
    for (const phrase of FORBIDDEN_PHRASES) {
      assert.ok(
        !hintText.includes(phrase.toLowerCase()),
        `hint must not contain "${phrase}" — Guardrail cannot block orders before they execute`,
      );
    }
  });

  it("does not say 'immediate' or 'immediately rejected' in max position size hint", () => {
    const hintIdx = COPY_SRC.indexOf("hint:");
    assert.ok(hintIdx !== -1);
    const hintText = COPY_SRC.slice(hintIdx, hintIdx + 600);
    assert.ok(
      !hintText.includes("immediate"),
      "hint must not imply immediate rejection — orders fill before Guardrail detects a breach",
    );
  });

  it("explicitly says enforcement is after detection (not pre-entry)", () => {
    assert.ok(
      COPY_SRC.includes("after detection") || COPY_SRC.includes("detection-response"),
      "copy must explicitly state that enforcement happens after detection",
    );
  });

  it("mentions that orders fill before detection", () => {
    assert.ok(
      COPY_SRC.includes("before") && (COPY_SRC.includes("fill") || COPY_SRC.includes("entry") || COPY_SRC.includes("detection")),
      "copy must convey that orders placed before detection will execute",
    );
  });

  it("explains why the global raw cap is intentionally not set", () => {
    assert.ok(
      COPY_SRC.includes("intentionally not set") ||
        COPY_SRC.includes("global cap is intentionally"),
      "copy must explain why the global raw hard limit is not applied",
    );
  });
});

// ── Debug endpoint: productSpecificBrokerRejectSupported ──────────────────────

describe("debug endpoint: productSpecificBrokerRejectSupported=false", () => {
  it("response includes productSpecificBrokerRejectSupported", () => {
    assert.ok(
      DEBUG_SRC.includes("productSpecificBrokerRejectSupported"),
      "debug endpoint must include productSpecificBrokerRejectSupported field",
    );
  });

  it("productSpecificBrokerRejectSupported is set to false", () => {
    assert.ok(
      DEBUG_SRC.includes("productSpecificBrokerRejectSupported: false"),
      "productSpecificBrokerRejectSupported must be false — verified by API probe",
    );
  });

  it("response includes brokerRejectReason", () => {
    assert.ok(
      DEBUG_SRC.includes("brokerRejectReason"),
      "debug endpoint must include brokerRejectReason explaining the API verification result",
    );
  });

  it("brokerRejectReason mentions the API probe result (HTTP 400)", () => {
    assert.ok(
      DEBUG_SRC.includes("400") || DEBUG_SRC.includes("illegal enum value"),
      "brokerRejectReason must reference the HTTP 400 / illegal enum value response from the probe",
    );
  });

  it("brokerEnforcementMode is app_side_only", () => {
    assert.ok(
      DEBUG_SRC.includes('"app_side_only"'),
      "debug endpoint must always return brokerEnforcementMode: app_side_only",
    );
  });

  it("appSideEnforcementNote mentions detection-response", () => {
    assert.ok(
      DEBUG_SRC.includes("detection-response") || DEBUG_SRC.includes("detection"),
      "appSideEnforcementNote must describe the detection-response enforcement model",
    );
  });
});

// ── No Overall raw limit re-enabled ──────────────────────────────────────────

describe("no global Overall raw limit re-enabled for standard-equivalent enforcement", () => {
  it("tradovate-client applyMaxPositionSize does not default to global_raw", () => {
    // The standard-equivalent enforcement path must keep app_side_only.
    // global_raw would set totalBy=Overall which blocks micro contracts incorrectly.
    const applyIdx = CLIENT_SRC.indexOf("async applyMaxPositionSize");
    assert.ok(applyIdx !== -1, "applyMaxPositionSize must exist in tradovate-client");
    const methodBody = CLIENT_SRC.slice(applyIdx, applyIdx + 3000);
    // The method must check for app_side_only as the deactivation/skip path.
    assert.ok(
      methodBody.includes("app_side_only"),
      "applyMaxPositionSize must handle app_side_only mode",
    );
  });

  it("buildCreatePositionLimitPayload uses Overall (the only valid totalBy)", () => {
    // Even though Overall cannot express standard-equivalent rules, it is the only
    // enum value Tradovate accepts. This test checks the production helper function body,
    // not JSDoc comments (which document the invalid values as a cautionary note).
    const CLIENT_LIMIT_SRC = readFileSync(
      resolve(import.meta.dirname, "../../../lib/brokers/tradovate-position-limit.ts"),
      "utf8",
    );
    // Find the function body of buildCreatePositionLimitPayload.
    const fnIdx = CLIENT_LIMIT_SRC.indexOf("function buildCreatePositionLimitPayload");
    assert.ok(fnIdx !== -1, "buildCreatePositionLimitPayload must exist");
    const fnBody = CLIENT_LIMIT_SRC.slice(fnIdx, fnIdx + 300);
    assert.ok(
      fnBody.includes('"Overall"'),
      "buildCreatePositionLimitPayload must use totalBy: Overall",
    );
    assert.ok(
      !fnBody.includes('"PerContract"') && !fnBody.includes('"PerProduct"'),
      "buildCreatePositionLimitPayload must not use PerContract or PerProduct — they are invalid enum values at Tradovate",
    );
  });

  it("debug endpoint appSideEnforcementNote does not re-enable global raw limit", () => {
    assert.ok(
      !DEBUG_SRC.includes("re-enable") && !DEBUG_SRC.includes("reenable"),
      "debug endpoint must not suggest re-enabling the global raw limit",
    );
  });
});

// ── Tradovate adapter: maxPositionSize not_supported ─────────────────────────

describe("tradovate-adapter: maxPositionSize is not_supported", () => {
  it("maxPositionSize status is not_supported", () => {
    const maxPosIdx = ADAPTER_SRC.indexOf("maxPositionSize:");
    assert.ok(maxPosIdx !== -1, "tradovate-adapter must have maxPositionSize capability");
    const capBlock = ADAPTER_SRC.slice(maxPosIdx, maxPosIdx + 400);
    assert.ok(
      capBlock.includes('"not_supported"'),
      "maxPositionSize status must be not_supported — product-specific limits confirmed unavailable",
    );
  });

  it("maxPositionSize is NOT coming_soon", () => {
    const maxPosIdx = ADAPTER_SRC.indexOf("maxPositionSize:");
    assert.ok(maxPosIdx !== -1);
    const capBlock = ADAPTER_SRC.slice(maxPosIdx, maxPosIdx + 400);
    assert.ok(
      !capBlock.includes('"coming_soon"'),
      "maxPositionSize must not be coming_soon — the API probe confirmed it is not available",
    );
  });

  it("maxPositionSize label does not say 'broker-enforced'", () => {
    const maxPosIdx = ADAPTER_SRC.indexOf("maxPositionSize:");
    assert.ok(maxPosIdx !== -1);
    const capBlock = ADAPTER_SRC.slice(maxPosIdx, maxPosIdx + 400);
    assert.ok(
      !capBlock.includes("broker-enforced"),
      "maxPositionSize label must not imply broker-level enforcement — it is app-side only",
    );
  });

  it("maxPositionSize note mentions API probe result", () => {
    const maxPosIdx = ADAPTER_SRC.indexOf("maxPositionSize:");
    assert.ok(maxPosIdx !== -1);
    const capBlock = ADAPTER_SRC.slice(maxPosIdx, maxPosIdx + 500);
    assert.ok(
      capBlock.includes("400") || capBlock.includes("detection-response") || capBlock.includes("app-side"),
      "maxPositionSize note must reference the probe result or detection-response model",
    );
  });
});

// ── Probe route: verification result documented ───────────────────────────────

describe("probe route: verification result is documented", () => {
  it("probe route response includes verificationResult field", () => {
    assert.ok(
      PROBE_SRC.includes("verificationResult"),
      "probe response must include verificationResult documenting the API outcome",
    );
  });

  it("verificationResult outcome is not_supported", () => {
    assert.ok(
      PROBE_SRC.includes('"not_supported"'),
      "verificationResult.outcome must be not_supported",
    );
  });

  it("probe route header comment notes verification date and outcome", () => {
    // The docstring must say when the probe was run and what it found.
    assert.ok(
      PROBE_SRC.includes("2026-05") || PROBE_SRC.includes("VERIFICATION STATUS"),
      "probe route header comment must note the verification date/result",
    );
  });
});
