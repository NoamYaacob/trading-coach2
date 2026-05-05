import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

// Set minimum env vars before importing the module under test.
const ORIGINAL_ENV = { ...process.env };

// 32-byte base64 (44 chars) for the token-encryption key validator.
process.env.TRADOVATE_CLIENT_ID = "test_cid";
process.env.TRADOVATE_CLIENT_SECRET = "test_secret";
process.env.TRADOVATE_TOKEN_ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
delete process.env.TRADOVATE_AUTH_URL_LIVE;
delete process.env.TRADOVATE_AUTH_URL_DEMO;
delete process.env.TRADOVATE_TOKEN_URL_LIVE;
delete process.env.TRADOVATE_TOKEN_URL_DEMO;

const { getTradovateConfig } = await import("./tradovate-env.ts");

describe("tradovate-env auth/token URL env-pairing", () => {
  after(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("default demo auth URL uses the -d hostname", () => {
    const status = getTradovateConfig();
    assert.equal(status.state, "ready");
    if (status.state !== "ready") return;
    assert.equal(status.config.authUrl.demo, "https://trader-d.tradovate.com/oauth");
  });

  it("default live auth URL uses the production hostname (no -d)", () => {
    const status = getTradovateConfig();
    if (status.state !== "ready") return;
    assert.equal(status.config.authUrl.live, "https://trader.tradovate.com/oauth");
  });

  it("default demo auth URL and demo token URL are env-paired (both -d)", () => {
    const status = getTradovateConfig();
    if (status.state !== "ready") return;
    const { authUrl, tokenUrl } = status.config;
    // Both demo URLs should reference the -d hostname.
    assert.ok(authUrl.demo.includes("trader-d."), `demo auth URL: ${authUrl.demo}`);
    assert.ok(tokenUrl.demo.includes("-api-d."), `demo token URL: ${tokenUrl.demo}`);
  });

  it("default live auth URL and live token URL are env-paired (no -d)", () => {
    const status = getTradovateConfig();
    if (status.state !== "ready") return;
    const { authUrl, tokenUrl } = status.config;
    assert.ok(!authUrl.live.includes("-d."), `live auth URL: ${authUrl.live}`);
    assert.ok(!tokenUrl.live.includes("-d."), `live token URL: ${tokenUrl.live}`);
  });
});
