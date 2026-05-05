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

describe("tradovate-env unified-host OAuth defaults", () => {
  after(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("default auth URL is trader.tradovate.com for both envs", () => {
    const status = getTradovateConfig();
    assert.equal(status.state, "ready");
    if (status.state !== "ready") return;
    assert.equal(status.config.authUrl.live, "https://trader.tradovate.com/oauth");
    assert.equal(status.config.authUrl.demo, "https://trader.tradovate.com/oauth");
  });

  it("default token URL is live-api.tradovate.com for both envs", () => {
    const status = getTradovateConfig();
    if (status.state !== "ready") return;
    assert.equal(status.config.tokenUrl.live, "https://live-api.tradovate.com/auth/oauthtoken");
    assert.equal(status.config.tokenUrl.demo, "https://live-api.tradovate.com/auth/oauthtoken");
  });

  it("auth and token URLs are paired to the same host family (no -d for both)", () => {
    const status = getTradovateConfig();
    if (status.state !== "ready") return;
    const { authUrl, tokenUrl } = status.config;
    // No URL should reference the -d demo host while another references the
    // production host — that mix produced the original invalid_client error.
    assert.ok(!authUrl.live.includes("-d."), `live auth URL: ${authUrl.live}`);
    assert.ok(!authUrl.demo.includes("-d."), `demo auth URL: ${authUrl.demo}`);
    assert.ok(!tokenUrl.live.includes("-d."), `live token URL: ${tokenUrl.live}`);
    assert.ok(!tokenUrl.demo.includes("-d."), `demo token URL: ${tokenUrl.demo}`);
  });
});
