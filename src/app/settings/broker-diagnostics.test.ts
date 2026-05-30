/**
 * Contract tests for broker diagnostics and onboarding components.
 * These verify source-level guarantees without runtime rendering.
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(rel: string): string {
  return readFileSync(resolve(import.meta.dirname, rel), "utf8");
}

// ── Expired connections show reconnect CTA ────────────────────────────────────

describe("expired connections show reconnect CTA", () => {
  test("broker-connections-section.tsx includes reconnect link for expired connections", () => {
    const src = read("./_components/broker-connections-section.tsx");
    assert.ok(
      src.includes("Reconnect"),
      "component must include Reconnect CTA for expired connections",
    );
  });

  test("reconnect href uses env and reconnect params", () => {
    const src = read("./_components/broker-connections-section.tsx");
    assert.ok(
      src.includes("reconnect="),
      "reconnect URL must include reconnect= param referencing the connection ID",
    );
    assert.ok(
      src.includes("env="),
      "reconnect URL must include env= param",
    );
  });

  test("BrokerConnectionCard conditionally renders Reconnect only when expired", () => {
    const src = read("./_components/broker-connections-section.tsx");
    const cardStart = src.indexOf("function BrokerConnectionCard");
    const cardEnd = src.indexOf("\nfunction ", cardStart + 1);
    const cardSrc = src.slice(cardStart, cardEnd);
    assert.ok(
      cardSrc.includes("expired") && cardSrc.includes("Reconnect"),
      "BrokerConnectionCard must gate Reconnect CTA on expired state",
    );
  });
});

// ── Active connections show linked account count ──────────────────────────────

describe("active connections show linked account count", () => {
  test("BrokerConnectionCard shows linked account count", () => {
    const src = read("./_components/broker-connections-section.tsx");
    const cardStart = src.indexOf("function BrokerConnectionCard");
    const cardEnd = src.indexOf("\nfunction ", cardStart + 1);
    const cardSrc = src.slice(cardStart, cardEnd);
    assert.ok(
      cardSrc.includes("linked account"),
      "BrokerConnectionCard must display linked account count",
    );
  });

  test("accountsByConn groups accounts by connection ID for per-card display", () => {
    const src = read("./_components/broker-connections-section.tsx");
    assert.ok(
      src.includes("accountsByConn"),
      "section must group accounts by brokerConnectionId for per-connection display",
    );
  });
});

// ── pending_decision = 0 shows 'No new accounts found' message ────────────────

describe("pending_decision = 0 behaviour in discovery helper", () => {
  test("account-discovery-helper.tsx includes text about pending_decision state", () => {
    const src = read("./_components/account-discovery-helper.tsx");
    assert.ok(
      src.includes("pending") || src.includes("New — needs setup"),
      "discovery helper must mention pending_decision / needs setup state",
    );
  });

  test("discovery helper mentions both live and demo environments", () => {
    const src = read("./_components/account-discovery-helper.tsx");
    assert.ok(
      src.includes("live") || src.includes("Live"),
      "discovery helper must mention live environment",
    );
    assert.ok(
      src.includes("demo") || src.includes("Demo"),
      "discovery helper must mention demo environment",
    );
  });

  test("discovery helper has run sync button posting to /api/accounts/sync-all", () => {
    const src = read("./_components/account-discovery-helper.tsx");
    assert.ok(
      src.includes("/api/accounts/sync-all"),
      "discovery helper must POST to /api/accounts/sync-all",
    );
  });
});

// ── Diagnostics never expose tokens ──────────────────────────────────────────

describe("diagnostics never expose tokens", () => {
  test("broker-connections-section.tsx does not select accessTokenEncrypted", () => {
    const src = read("./_components/broker-connections-section.tsx");
    assert.ok(
      !src.includes("accessTokenEncrypted"),
      "broker-connections-section must not reference accessTokenEncrypted",
    );
  });

  test("broker-connections-section.tsx does not select refreshTokenEncrypted", () => {
    const src = read("./_components/broker-connections-section.tsx");
    assert.ok(
      !src.includes("refreshTokenEncrypted"),
      "broker-connections-section must not reference refreshTokenEncrypted",
    );
  });

  test("account-discovery-helper.tsx has no token fields", () => {
    const src = read("./_components/account-discovery-helper.tsx");
    assert.ok(
      !src.includes("accessToken") && !src.includes("refreshToken"),
      "account-discovery-helper must not reference any token fields",
    );
  });

  test("debug/broker-accounts/page.tsx prisma select does not include accessTokenEncrypted", () => {
    const src = read("../debug/broker-accounts/page.tsx");
    assert.ok(
      !src.includes("accessTokenEncrypted"),
      "debug broker-accounts page must not select accessTokenEncrypted",
    );
  });

  test("debug/broker-accounts/page.tsx prisma select does not include refreshTokenEncrypted", () => {
    const src = read("../debug/broker-accounts/page.tsx");
    assert.ok(
      !src.includes("refreshTokenEncrypted"),
      "debug broker-accounts page must not select refreshTokenEncrypted",
    );
  });
});

// ── Sync result separates live and demo ───────────────────────────────────────

describe("sync result separates live and demo", () => {
  test("account-discovery-helper.tsx references both live and demo in explanations", () => {
    const src = read("./_components/account-discovery-helper.tsx");
    const hasLive = src.toLowerCase().includes("live");
    const hasDemo = src.toLowerCase().includes("demo");
    assert.ok(hasLive, "discovery helper must mention live environment");
    assert.ok(hasDemo, "discovery helper must mention demo environment");
  });

  test("broker-connections-section.tsx separates Live and Demo connection sections", () => {
    const src = read("./_components/broker-connections-section.tsx");
    assert.ok(
      src.includes("Live connections"),
      "section must have 'Live connections' subsection",
    );
    assert.ok(
      src.includes("Demo connections"),
      "section must have 'Demo connections' subsection",
    );
    const liveIdx = src.indexOf("Live connections");
    const demoIdx = src.indexOf("Demo connections");
    assert.ok(liveIdx < demoIdx, "Live connections must appear before Demo connections");
  });
});
