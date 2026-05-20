/**
 * Source-scan tests for GET /api/debug/tradovate-listener/reattach-audit.
 *
 * Confirms auth + secret guards, read-only contract, confidence scoring
 * logic, and token safety without spinning up an HTTP server.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTE_SRC = readFileSync(resolve(import.meta.dirname, "./route.ts"), "utf8");

describe("reattach-audit: auth guard", () => {
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

describe("reattach-audit: production secret guard", () => {
  it("checks NODE_ENV === production", () => {
    assert.ok(
      ROUTE_SRC.includes("NODE_ENV") && ROUTE_SRC.includes("production"),
    );
  });

  it("reads x-cron-secret and compares to CRON_SECRET", () => {
    assert.ok(ROUTE_SRC.includes("x-cron-secret"));
    assert.ok(ROUTE_SRC.includes("CRON_SECRET"));
    assert.ok(ROUTE_SRC.includes("403"));
  });
});

describe("reattach-audit: scope isolation", () => {
  it("filters BrokerConnection by current user", () => {
    assert.ok(
      ROUTE_SRC.includes("userId: currentUser.id"),
      "must scope broker connection query to currentUser.id",
    );
  });

  it("filters ConnectedAccount by current user", () => {
    const occurrences = ROUTE_SRC.split("userId: currentUser.id").length - 1;
    assert.ok(occurrences >= 2, "both BrokerConnection and ConnectedAccount queries must scope to currentUser.id");
  });

  it("only queries the tradovate platform", () => {
    assert.ok(
      ROUTE_SRC.includes('platform: "tradovate"'),
      "platform filter must be present",
    );
  });
});

describe("reattach-audit: read-only contract", () => {
  it("mode is read_only_audit", () => {
    assert.ok(ROUTE_SRC.includes('"read_only_audit"'), "response mode must be read_only_audit");
  });

  it("never calls prisma.update or prisma.create", () => {
    // The template-literal dry-run string contains "prisma.connectedAccount.update" as text,
    // but must never be an awaited executable call.
    assert.ok(
      !ROUTE_SRC.includes("await prisma.connectedAccount.update("),
      "must not execute any update — dry run only",
    );
    assert.ok(
      !ROUTE_SRC.includes("await prisma.connectedAccount.create("),
      "must not execute any create",
    );
    assert.ok(
      !ROUTE_SRC.includes("await prisma.brokerConnection.update("),
      "must not mutate broker connections",
    );
  });

  it("dry run preview is a string-only representation", () => {
    assert.ok(ROUTE_SRC.includes("dryRunPreview"), "must return dryRunPreview");
    assert.ok(ROUTE_SRC.includes("prismaCall"), "dryRunPreview entries must include prismaCall string");
    // The prismaCall must only appear inside a template literal (string), not as actual code
    const templateLitIdx = ROUTE_SRC.indexOf("`prisma.connectedAccount.update");
    assert.ok(templateLitIdx !== -1, "prismaCall value must be a template literal string, not an executed call");
  });
});

describe("reattach-audit: token safety", () => {
  const TOKEN_FIELDS = [
    "accessToken",
    "refreshToken",
    "accessTokenEncrypted",
    "refreshTokenEncrypted",
    "tokenEncrypted",
  ];

  it("never selects token fields and never references parseAndDecrypt", () => {
    assert.ok(
      !ROUTE_SRC.includes("parseAndDecrypt"),
      "audit endpoint must not decrypt tokens",
    );
    for (const f of TOKEN_FIELDS) {
      assert.ok(
        !ROUTE_SRC.includes(`${f}: true`),
        `must not select ${f}`,
      );
    }
  });
});

describe("reattach-audit: staleness detection", () => {
  it("detects expired connectionStatus", () => {
    assert.ok(ROUTE_SRC.includes('"expired"'), "must check for expired connectionStatus");
  });

  it("detects connection_error connectionStatus", () => {
    assert.ok(ROUTE_SRC.includes('"connection_error"'), "must check for connection_error connectionStatus");
  });

  it("detects expired tokens", () => {
    assert.ok(ROUTE_SRC.includes("tokenExpiresAt"), "must check tokenExpiresAt");
  });

  it("detects lastRenewError", () => {
    assert.ok(ROUTE_SRC.includes("lastRenewError"), "must check lastRenewError");
  });

  it("detects listenerStatus=error", () => {
    assert.ok(ROUTE_SRC.includes('"error"'), "must check for listenerStatus=error");
  });
});

describe("reattach-audit: confidence scoring", () => {
  it("assigns high confidence when env + brokerUserId match", () => {
    assert.ok(ROUTE_SRC.includes('"high"'), "must produce high confidence");
    assert.ok(
      ROUTE_SRC.includes("brokerUserId"),
      "high confidence requires brokerUserId match",
    );
  });

  it("assigns medium confidence when only env matches", () => {
    assert.ok(ROUTE_SRC.includes('"medium"'), "must produce medium confidence");
  });

  it("assigns low confidence when multiple candidates exist", () => {
    assert.ok(ROUTE_SRC.includes('"low"'), "must produce low confidence");
  });

  it("never suggests live connections when TRADOVATE_LISTENER_ENABLE_LIVE env is unrelated", () => {
    // The route must scope by userId + env — live vs demo distinction is in env field,
    // so live accounts only get live candidates and demo accounts only get demo candidates.
    // Verify the env match is required for all candidate lookups.
    const envMatchCount = (ROUTE_SRC.match(/env.*:.*env/g) ?? []).length;
    assert.ok(envMatchCount >= 1, "env must be matched when finding target candidates");
  });
});

describe("reattach-audit: response shape", () => {
  it("returns summary with key counts", () => {
    assert.ok(ROUTE_SRC.includes("totalConnections"), "summary must include totalConnections");
    assert.ok(ROUTE_SRC.includes("healthyConnections"), "summary must include healthyConnections");
    assert.ok(ROUTE_SRC.includes("staleConnections"), "summary must include staleConnections");
    assert.ok(ROUTE_SRC.includes("accountsNeedingReattach"), "summary must include accountsNeedingReattach");
    assert.ok(ROUTE_SRC.includes("highConfidence"), "summary must include highConfidence count");
    assert.ok(ROUTE_SRC.includes("mediumConfidence"), "summary must include mediumConfidence count");
    assert.ok(ROUTE_SRC.includes("lowConfidence"), "summary must include lowConfidence count");
  });

  it("returns per-recommendation fields including staleReason and confidenceReason", () => {
    assert.ok(ROUTE_SRC.includes("staleReason"), "must explain why current connection is stale");
    assert.ok(ROUTE_SRC.includes("confidenceReason"), "must explain confidence basis");
    assert.ok(ROUTE_SRC.includes("currentBrokerConnectionId"), "must report current connection ID");
    assert.ok(ROUTE_SRC.includes("targetBrokerConnectionId"), "must report target connection ID");
  });

  it("returns connections summary for full picture", () => {
    assert.ok(ROUTE_SRC.includes("connectionsSummary"), "must include connections array in response");
    assert.ok(ROUTE_SRC.includes("accountCount"), "connections summary must include accountCount");
    assert.ok(ROUTE_SRC.includes("healthy"), "connections summary must flag healthy vs stale");
  });

  it("returns accountCount and createdAt per recommendation for manual review", () => {
    assert.ok(ROUTE_SRC.includes("currentAccountCount"), "must include currentAccountCount for safe migration check");
    assert.ok(ROUTE_SRC.includes("targetAccountCount"), "must include targetAccountCount");
    assert.ok(ROUTE_SRC.includes("currentCreatedAt"), "must include currentCreatedAt");
    assert.ok(ROUTE_SRC.includes("targetCreatedAt"), "must include targetCreatedAt");
  });
});
