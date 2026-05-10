/**
 * Reconnect flow — source-scan tests.
 *
 * Tests that copy, structure, and wiring for the reconnect flow are present
 * and correct. Source-scan tests catch regressions in static text, API
 * contract shapes, and route logic without needing a running server.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(rel: string): string {
  return readFileSync(resolve(import.meta.dirname, rel), "utf-8");
}

const connectClient = read("connect-tradovate-client.tsx");
const oauthState = read("../../../../../lib/brokers/tradovate-oauth-state.ts");
const setupRoute = read(
  "../../../../../app/api/auth/tradovate/setup/route.ts",
);
const connectRoute = read(
  "../../../../../app/api/auth/tradovate/connect/route.ts",
);
const callbackRoute = read(
  "../../../../../app/api/auth/tradovate/callback/route.ts",
);
const settingsPage = read("../../../../settings/page.tsx");
const brokerConnectionsSection = read(
  "../../../../settings/_components/broker-connections-section.tsx",
);
const removeBrokerConnectionButton = read(
  "../../../../settings/_components/remove-broker-connection-button.tsx",
);
const brokerConnectionsApiRoute = read(
  "../../../../../app/api/broker-connections/[id]/route.ts",
);

// ── connect-tradovate-client.tsx ──────────────────────────────────────────────

describe("ConnectTradovateClient — reconnect mode", () => {
  test("reads reconnect param from searchParams", () => {
    assert.ok(connectClient.includes('searchParams.get("reconnect")'));
  });

  test("reads env param from searchParams", () => {
    assert.ok(connectClient.includes('searchParams.get("env")'));
  });

  test("renders 'Reconnect Tradovate' title in reconnect mode", () => {
    assert.ok(connectClient.includes("Reconnect Tradovate"));
  });

  test("renders reconnect-specific subtitle about restoring live sync", () => {
    assert.ok(
      connectClient.includes(
        "Reconnect restores live sync and broker-side enforcement for the affected accounts",
      ),
    );
  });

  test("renders 'saved Guardrail rules will remain unchanged' copy", () => {
    assert.ok(connectClient.includes("Your saved Guardrail rules will remain unchanged"));
  });

  test("does NOT contain the old 'Guardrail connects read-only' subtitle", () => {
    assert.ok(!connectClient.includes("Guardrail connects read-only"));
  });

  test("does NOT contain the old 'Read-only connection' box heading as rendered text", () => {
    assert.ok(!connectClient.includes(">Read-only connection<"));
  });

  test("renders 'Choose the access level' permission explainer", () => {
    assert.ok(connectClient.includes("Choose the access level"));
  });

  test("explains Monitoring only access level", () => {
    assert.ok(connectClient.includes("Monitoring only"));
  });

  test("explains Risk settings enabled access level", () => {
    assert.ok(connectClient.includes("Risk settings enabled"));
  });

  test("passes reconnect to setup API body in reconnect mode", () => {
    assert.ok(connectClient.includes("reconnect: reconnectId"));
  });

  test("back link points to /settings in reconnect mode", () => {
    assert.ok(connectClient.includes('isReconnectMode ? "/settings"'));
  });

  test("hides step counter in reconnect mode", () => {
    assert.ok(connectClient.includes("!isReconnectMode"));
    assert.ok(connectClient.includes("Step 1 of 3"));
  });
});

// ── tradovate-oauth-state.ts ──────────────────────────────────────────────────

describe("TradovateOAuthState — reconnectId field", () => {
  test("defines reconnectId as optional field on TradovateOAuthState", () => {
    assert.ok(oauthState.includes("reconnectId?:"));
  });

  test("parses reconnectId in decodeOAuthState", () => {
    assert.ok(oauthState.includes("parsed.reconnectId"));
  });
});

// ── setup/route.ts ────────────────────────────────────────────────────────────

describe("setup route — reconnect mode", () => {
  test("accepts reconnect field in SetupBody type", () => {
    assert.ok(setupRoute.includes("reconnect?:"));
  });

  test("validates the BrokerConnection exists and belongs to the user", () => {
    assert.ok(setupRoute.includes("where: { id: reconnect, userId: currentUser.id }"));
  });

  test("redirects to connect route with reconnect param", () => {
    assert.ok(setupRoute.includes("reconnect=${encodeURIComponent(bc.id)}"));
  });

  test("reconnect path returns before PendingBrokerSetup.create", () => {
    const reconnectIdx = setupRoute.indexOf("if (reconnect)");
    const returnIdx = setupRoute.indexOf("return NextResponse.json", reconnectIdx);
    const createIdx = setupRoute.indexOf("pendingBrokerSetup.create");
    assert.ok(reconnectIdx > -1, "reconnect block must exist");
    assert.ok(createIdx > returnIdx, "create must come after the reconnect return");
  });
});

// ── connect/route.ts ──────────────────────────────────────────────────────────

describe("connect route — threads reconnectId into OAuth state", () => {
  test("reads reconnect from query params", () => {
    assert.ok(connectRoute.includes('searchParams.get("reconnect")'));
  });

  test("includes reconnectId in encodeOAuthState call", () => {
    assert.ok(connectRoute.includes("reconnectId,"));
  });
});

// ── callback/route.ts ─────────────────────────────────────────────────────────

describe("callback route — reconnect path", () => {
  test("checks payload.reconnectId before creating a new BrokerConnection", () => {
    const reconnectIdx = callbackRoute.indexOf("payload.reconnectId");
    const createIdx = callbackRoute.indexOf("brokerConnection.create");
    assert.ok(reconnectIdx > -1, "reconnectId check must exist");
    assert.ok(createIdx > reconnectIdx, "create must come after reconnect check");
  });

  test("updates existing BrokerConnection in reconnect path", () => {
    assert.ok(callbackRoute.includes("brokerConnection.update"));
  });

  test("resets connectionStatus to connected_readonly on reconnect", () => {
    assert.ok(callbackRoute.includes('connectionStatus: "connected_readonly"'));
  });

  test("re-activates expired ConnectedAccount rows linked to reconnected connection", () => {
    assert.ok(callbackRoute.includes('connectionStatus: "expired"'));
    assert.ok(callbackRoute.includes("connectedAccount.updateMany"));
  });

  test("redirects to /settings?tradovate_reconnected=1 after successful reconnect", () => {
    assert.ok(callbackRoute.includes("tradovate_reconnected=1"));
  });

  test("reconnect redirect is inside the payload.reconnectId block", () => {
    const ifIdx = callbackRoute.indexOf("if (payload.reconnectId)");
    const reconnectedIdx = callbackRoute.indexOf("tradovate_reconnected=1");
    const createIdx = callbackRoute.indexOf("brokerConnection.create");
    assert.ok(ifIdx > -1);
    // The redirect must come before BrokerConnection.create (normal path)
    assert.ok(reconnectedIdx < createIdx, "reconnect redirect must precede normal create path");
  });
});

// ── settings/page.tsx ─────────────────────────────────────────────────────────

describe("settings page — reconnect success banner", () => {
  test("reads tradovate_reconnected from searchParams type", () => {
    assert.ok(settingsPage.includes("tradovate_reconnected"));
  });

  test("shows banner when tradovate_reconnected === '1'", () => {
    assert.ok(settingsPage.includes('tradovate_reconnected === "1"'));
  });

  test("banner contains 'Tradovate reconnected'", () => {
    assert.ok(settingsPage.includes("Tradovate reconnected"));
  });

  test("banner mentions live sync resuming", () => {
    assert.ok(settingsPage.includes("Live sync will resume shortly"));
  });
});

// ── broker-connections-section.tsx ────────────────────────────────────────────

describe("broker-connections-section — orphaned connection remove button", () => {
  test("imports RemoveBrokerConnectionButton", () => {
    assert.ok(brokerConnectionsSection.includes("RemoveBrokerConnectionButton"));
  });

  test("renders RemoveBrokerConnectionButton in OrphanedConnectionRow", () => {
    const orphanedFnStart = brokerConnectionsSection.indexOf(
      "function OrphanedConnectionRow",
    );
    const orphanedFnEnd = brokerConnectionsSection.indexOf("\nfunction ", orphanedFnStart + 1);
    const orphanedFn = brokerConnectionsSection.slice(orphanedFnStart, orphanedFnEnd);
    assert.ok(
      orphanedFn.includes("RemoveBrokerConnectionButton"),
      "OrphanedConnectionRow must render RemoveBrokerConnectionButton",
    );
  });

  test("orphaned row passes connectionId={bc.id} to RemoveBrokerConnectionButton", () => {
    assert.ok(brokerConnectionsSection.includes("connectionId={bc.id}"));
  });

  test("ExpiredConnectionGroupCard (linked accounts) has no RemoveBrokerConnectionButton", () => {
    const groupCardStart = brokerConnectionsSection.indexOf(
      "function ExpiredConnectionGroupCard",
    );
    const groupCardEnd = brokerConnectionsSection.indexOf("\nfunction ", groupCardStart + 1);
    const groupCard = brokerConnectionsSection.slice(groupCardStart, groupCardEnd);
    assert.ok(
      !groupCard.includes("RemoveBrokerConnectionButton"),
      "grouped expired card (with accounts) must not have a remove button",
    );
  });
});

// ── remove-broker-connection-button.tsx ──────────────────────────────────────

describe("RemoveBrokerConnectionButton", () => {
  test("calls DELETE /api/broker-connections/:connectionId", () => {
    assert.ok(
      removeBrokerConnectionButton.includes(
        "`/api/broker-connections/${connectionId}`",
      ),
    );
    assert.ok(removeBrokerConnectionButton.includes('method: "DELETE"'));
  });

  test("has a confirm step before deletion", () => {
    assert.ok(removeBrokerConnectionButton.includes("confirming"));
    assert.ok(removeBrokerConnectionButton.includes("Remove this connection permanently"));
  });

  test("shows 'Remove connection' as the initial button label", () => {
    assert.ok(removeBrokerConnectionButton.includes("Remove connection"));
  });
});

// ── broker-connections/[id]/route.ts ─────────────────────────────────────────

describe("DELETE /api/broker-connections/[id]", () => {
  test("requires authentication", () => {
    assert.ok(brokerConnectionsApiRoute.includes("getCurrentUser"));
    assert.ok(brokerConnectionsApiRoute.includes('"unauthorized"'));
  });

  test("verifies BrokerConnection belongs to current user", () => {
    assert.ok(brokerConnectionsApiRoute.includes("userId: currentUser.id"));
  });

  test("blocks deletion when linked accounts exist", () => {
    assert.ok(brokerConnectionsApiRoute.includes("connectedAccount.count"));
    assert.ok(brokerConnectionsApiRoute.includes("has_linked_accounts"));
    assert.ok(brokerConnectionsApiRoute.includes("status: 409"));
  });

  test("deletes the BrokerConnection", () => {
    assert.ok(brokerConnectionsApiRoute.includes("brokerConnection.delete"));
  });

  test("returns { ok: true } on success", () => {
    assert.ok(brokerConnectionsApiRoute.includes("ok: true"));
  });
});
