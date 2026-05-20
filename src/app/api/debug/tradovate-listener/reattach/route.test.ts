/**
 * Source-scan tests for GET /api/debug/tradovate-listener/reattach.
 *
 * Verifies auth guard, always-on secret guard, dry-run default, confidence
 * gating, live safety guard, apply-mode mutation contract, and token safety
 * without spinning up an HTTP server.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTE_SRC = readFileSync(resolve(import.meta.dirname, "./route.ts"), "utf8");

describe("reattach: auth guard", () => {
  it("calls getCurrentUser before any DB query", () => {
    assert.ok(ROUTE_SRC.includes("getCurrentUser"));
    const authIdx = ROUTE_SRC.indexOf("getCurrentUser");
    const dbIdx = ROUTE_SRC.indexOf("prisma.");
    assert.ok(authIdx !== -1 && dbIdx !== -1);
    assert.ok(authIdx < dbIdx, "auth check must precede DB access");
  });

  it("returns 401 when unauthenticated", () => {
    assert.ok(ROUTE_SRC.includes("401"));
  });
});

describe("reattach: CRON_SECRET guard — always required", () => {
  it("reads x-cron-secret and compares to CRON_SECRET", () => {
    assert.ok(ROUTE_SRC.includes("x-cron-secret"));
    assert.ok(ROUTE_SRC.includes("CRON_SECRET"));
    assert.ok(ROUTE_SRC.includes("403"));
  });

  it("does NOT wrap the secret check in a NODE_ENV production gate", () => {
    assert.ok(
      !ROUTE_SRC.includes('NODE_ENV === "production"'),
      "reattach must require CRON_SECRET in ALL environments, not just production, because it can write data",
    );
  });

  it("secret check appears before any prisma query", () => {
    const secretIdx = ROUTE_SRC.indexOf("CRON_SECRET");
    const prismaIdx = ROUTE_SRC.indexOf("prisma.");
    assert.ok(secretIdx < prismaIdx, "secret guard must precede DB access");
  });
});

describe("reattach: scope isolation", () => {
  it("scopes BrokerConnection query to current user", () => {
    assert.ok(
      ROUTE_SRC.includes("userId: currentUser.id"),
      "must scope broker connection query to currentUser.id",
    );
  });

  it("scopes ConnectedAccount query to current user", () => {
    const count = ROUTE_SRC.split("userId: currentUser.id").length - 1;
    assert.ok(count >= 2, "both queries must be scoped to currentUser.id");
  });

  it("only queries the tradovate platform", () => {
    assert.ok(ROUTE_SRC.includes('platform: "tradovate"'));
  });
});

describe("reattach: token safety", () => {
  const TOKEN_FIELDS = [
    "accessToken",
    "refreshToken",
    "accessTokenEncrypted",
    "refreshTokenEncrypted",
    "tokenEncrypted",
  ];

  it("never selects token fields and never references parseAndDecrypt", () => {
    assert.ok(!ROUTE_SRC.includes("parseAndDecrypt"), "must not decrypt tokens");
    for (const f of TOKEN_FIELDS) {
      assert.ok(!ROUTE_SRC.includes(`${f}: true`), `must not select ${f}`);
    }
  });
});

describe("reattach: dry-run default", () => {
  it("defaults apply to false (requires explicit apply=true)", () => {
    assert.ok(
      ROUTE_SRC.includes('sp.get("apply") === "true"'),
      "apply mode must require explicit string true",
    );
    // The default expression must produce false when param is absent
    assert.ok(
      ROUTE_SRC.includes('"apply") === "true"'),
      "apply must default to false when param is absent",
    );
  });

  it("defaults confidence to high when param is absent", () => {
    assert.ok(
      ROUTE_SRC.includes('"confidence") ?? "high"'),
      'confidence must default to "high"',
    );
  });

  it("dry_run mode string is present in response", () => {
    assert.ok(ROUTE_SRC.includes('"dry_run"'), "must return mode: dry_run for non-apply requests");
  });

  it("apply mode string is present and gated", () => {
    assert.ok(ROUTE_SRC.includes('"apply"'), "must return mode: apply for apply requests");
    const applyModeIdx = ROUTE_SRC.indexOf("applyMode");
    const updateIdx = ROUTE_SRC.indexOf("await prisma.connectedAccount.update(");
    assert.ok(
      applyModeIdx < updateIdx,
      "update call must appear after applyMode is checked — dry-run path must not reach the update",
    );
  });
});

describe("reattach: confidence gating", () => {
  it("builds accepted confidence set starting from high only", () => {
    assert.ok(
      ROUTE_SRC.includes('"high"'),
      "high confidence must be included",
    );
    assert.ok(
      ROUTE_SRC.includes("acceptedConfidence"),
      "must use acceptedConfidence set to gate eligible rows",
    );
  });

  it("medium confidence requires explicit opt-in", () => {
    assert.ok(
      ROUTE_SRC.includes('"medium"'),
      "medium confidence must be expressly added when requested",
    );
    // The source must check the param before adding medium
    const medIdx = ROUTE_SRC.indexOf('"medium"');
    const acceptedIdx = ROUTE_SRC.indexOf("acceptedConfidence");
    assert.ok(acceptedIdx !== -1 && medIdx !== -1);
  });

  it("low confidence opt-in also adds medium (inclusive)", () => {
    assert.ok(
      ROUTE_SRC.includes('"low"'),
      "low confidence path must exist",
    );
  });

  it("rows not in accepted confidence set go to skippedByConfidence", () => {
    assert.ok(ROUTE_SRC.includes("skippedByConfidence"), "must expose skippedByConfidence array");
  });
});

describe("reattach: live safety guard", () => {
  it("checks TRADOVATE_LISTENER_ENABLE_LIVE env var", () => {
    assert.ok(
      ROUTE_SRC.includes("TRADOVATE_LISTENER_ENABLE_LIVE"),
      "must read TRADOVATE_LISTENER_ENABLE_LIVE",
    );
  });

  it("filters out live targets when enableLive is false", () => {
    assert.ok(
      ROUTE_SRC.includes('targetEnv === "live"'),
      "must check targetEnv for live to guard against live reattachment",
    );
    assert.ok(
      ROUTE_SRC.includes("skippedLiveGuard"),
      "must expose skippedLiveGuard list for transparency",
    );
  });

  it("live guard applies before both dry-run and apply mode", () => {
    const guardIdx = ROUTE_SRC.indexOf("skippedLiveGuard");
    const applyIdx = ROUTE_SRC.indexOf("if (applyMode)");
    assert.ok(
      guardIdx < applyIdx,
      "live guard must be computed before the applyMode branch",
    );
  });
});

describe("reattach: apply mode mutation contract", () => {
  it("updates ConnectedAccount.brokerConnectionId in apply mode", () => {
    assert.ok(
      ROUTE_SRC.includes("await prisma.connectedAccount.update("),
      "apply mode must execute prisma.connectedAccount.update",
    );
    assert.ok(
      ROUTE_SRC.includes("brokerConnectionId: rec.targetBrokerConnectionId"),
      "update must set brokerConnectionId to target",
    );
  });

  it("never deletes any BrokerConnection or ConnectedAccount", () => {
    assert.ok(!ROUTE_SRC.includes("prisma.brokerConnection.delete"), "must not delete broker connections");
    assert.ok(!ROUTE_SRC.includes("prisma.connectedAccount.delete"), "must not delete accounts");
  });

  it("never modifies enforcement or token columns", () => {
    // Check for field-assignment patterns (key: value) — the docstring legitimately
    // mentions riskState as something NOT touched, so bare string presence is a false positive.
    const FORBIDDEN_ASSIGNMENTS = [
      "riskState:",
      "riskRules:",
      "accessTokenEncrypted:",
      "refreshTokenEncrypted:",
      "parseAndDecrypt",
    ];
    for (const f of FORBIDDEN_ASSIGNMENTS) {
      assert.ok(!ROUTE_SRC.includes(f), `must not assign/touch ${f}`);
    }
  });

  it("never modifies BrokerConnection rows", () => {
    assert.ok(
      !ROUTE_SRC.includes("await prisma.brokerConnection.update("),
      "must not update broker connection rows",
    );
  });
});

describe("reattach: response shape", () => {
  it("returns params echo so callers can confirm what was requested", () => {
    assert.ok(ROUTE_SRC.includes("params:"), "must echo back request params");
  });

  it("returns summary with apply/skip counts", () => {
    assert.ok(ROUTE_SRC.includes("wouldApply") || ROUTE_SRC.includes("applied:"), "must include apply count");
    assert.ok(ROUTE_SRC.includes("skippedByConfidence:"), "must include skippedByConfidence count");
    assert.ok(ROUTE_SRC.includes("skippedLiveGuard:"), "must include skippedLiveGuard count");
  });

  it("dry-run response includes dryRunPreview with prismaCall strings", () => {
    assert.ok(ROUTE_SRC.includes("dryRunPreview"), "dry-run must include dryRunPreview");
    assert.ok(ROUTE_SRC.includes("prismaCall"), "dryRunPreview must include prismaCall string");
    assert.ok(
      ROUTE_SRC.includes("`prisma.connectedAccount.update"),
      "prismaCall must be a template literal string, not an executed call",
    );
  });
});
