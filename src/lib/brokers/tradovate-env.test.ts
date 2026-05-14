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

describe("tradovate-env OAuth defaults", () => {
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

  it("live token URL uses live-api.tradovate.com", () => {
    const status = getTradovateConfig();
    if (status.state !== "ready") return;
    assert.equal(status.config.tokenUrl.live, "https://live-api.tradovate.com/auth/oauthtoken");
  });

  it("demo token URL uses demo.tradovateapi.com (not live-api)", () => {
    const status = getTradovateConfig();
    if (status.state !== "ready") return;
    assert.equal(status.config.tokenUrl.demo, "https://demo.tradovateapi.com/auth/oauthtoken");
    assert.ok(
      !status.config.tokenUrl.demo.includes("live-api"),
      "demo token URL must not point at the live-api host",
    );
  });

  it("demo token URL host matches demo REST base host", () => {
    const status = getTradovateConfig();
    if (status.state !== "ready") return;
    const tokenHost = new URL(status.config.tokenUrl.demo).host;
    const restHost = new URL(status.config.apiBaseUrl.demo).host;
    assert.equal(tokenHost, restHost, "demo token URL and REST base must be on the same host");
  });

  it("live token URL host differs from demo token URL host", () => {
    const status = getTradovateConfig();
    if (status.state !== "ready") return;
    const liveTokenHost = new URL(status.config.tokenUrl.live).host;
    const demoTokenHost = new URL(status.config.tokenUrl.demo).host;
    assert.notEqual(liveTokenHost, demoTokenHost, "live and demo token URLs must use different hosts");
  });

  it("auth URLs never reference the -d. demo host (wrong client_id guard)", () => {
    const status = getTradovateConfig();
    if (status.state !== "ready") return;
    const { authUrl } = status.config;
    assert.ok(!authUrl.live.includes("-d."), `live auth URL: ${authUrl.live}`);
    assert.ok(!authUrl.demo.includes("-d."), `demo auth URL: ${authUrl.demo}`);
  });

  it("live REST base host differs from demo REST base host", () => {
    const status = getTradovateConfig();
    if (status.state !== "ready") return;
    const liveHost = new URL(status.config.apiBaseUrl.live).host;
    const demoHost = new URL(status.config.apiBaseUrl.demo).host;
    assert.notEqual(liveHost, demoHost, "live and demo REST bases must use different hosts");
  });
});
