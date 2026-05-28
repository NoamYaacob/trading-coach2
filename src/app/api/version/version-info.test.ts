import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildVersionInfo } from "./version-info.ts";

describe("buildVersionInfo: secret safety", () => {
  it("never exposes DATABASE_URL or auth/API/token env vars", () => {
    const env = {
      DATABASE_URL: "postgres://user:secret@host:5432/db",
      AUTH_SECRET: "supersecret",
      ANTHROPIC_API_KEY: "sk-leak",
      TRADOVATE_TOKEN_ENCRYPTION_KEY: "key-leak",
      RAILWAY_GIT_COMMIT_SHA: "abc123",
      RAILWAY_GIT_BRANCH: "main",
      RAILWAY_ENVIRONMENT_NAME: "production",
    } as NodeJS.ProcessEnv;
    const v = buildVersionInfo(env);
    const serialized = JSON.stringify(v);
    assert.ok(!serialized.includes("secret"), "must not include any secrets");
    assert.ok(!serialized.includes("sk-leak"), "must not include API keys");
    assert.ok(!serialized.includes("postgres://"), "must not include DB URL");
    assert.ok(!serialized.includes("key-leak"), "must not include encryption keys");
  });

  it("only returns the four documented fields", () => {
    const v = buildVersionInfo({} as NodeJS.ProcessEnv);
    assert.deepEqual(Object.keys(v).sort(), [
      "branch",
      "commit",
      "deployedAt",
      "environment",
      "ok",
    ]);
  });
});

describe("buildVersionInfo: env precedence", () => {
  it("prefers Railway commit over Vercel commit when both present", () => {
    const v = buildVersionInfo({
      RAILWAY_GIT_COMMIT_SHA: "railway-sha",
      VERCEL_GIT_COMMIT_SHA: "vercel-sha",
    } as NodeJS.ProcessEnv);
    assert.equal(v.commit, "railway-sha");
  });

  it("falls back to Vercel commit when Railway is missing", () => {
    const v = buildVersionInfo({
      VERCEL_GIT_COMMIT_SHA: "vercel-sha",
    } as NodeJS.ProcessEnv);
    assert.equal(v.commit, "vercel-sha");
  });

  it("falls back to a generic GIT_COMMIT_SHA when neither Railway nor Vercel is present", () => {
    const v = buildVersionInfo({
      GIT_COMMIT_SHA: "generic-sha",
    } as NodeJS.ProcessEnv);
    assert.equal(v.commit, "generic-sha");
  });

  it("returns 'unknown' when no commit env var is set", () => {
    const v = buildVersionInfo({} as NodeJS.ProcessEnv);
    assert.equal(v.commit, "unknown");
  });

  it("environment falls through Railway → Vercel → NODE_ENV", () => {
    assert.equal(
      buildVersionInfo({ RAILWAY_ENVIRONMENT_NAME: "prod" } as NodeJS.ProcessEnv).environment,
      "prod",
    );
    assert.equal(
      buildVersionInfo({ VERCEL_ENV: "preview" } as NodeJS.ProcessEnv).environment,
      "preview",
    );
    assert.equal(
      buildVersionInfo({ NODE_ENV: "development" } as NodeJS.ProcessEnv).environment,
      "development",
    );
  });

  it("branch falls through Railway → Vercel → generic", () => {
    assert.equal(
      buildVersionInfo({ RAILWAY_GIT_BRANCH: "main" } as NodeJS.ProcessEnv).branch,
      "main",
    );
    assert.equal(
      buildVersionInfo({ VERCEL_GIT_COMMIT_REF: "feature-x" } as NodeJS.ProcessEnv).branch,
      "feature-x",
    );
  });
});

describe("buildVersionInfo: whitespace / empty handling", () => {
  it("treats empty string as missing and falls through", () => {
    const v = buildVersionInfo({
      RAILWAY_GIT_COMMIT_SHA: "",
      VERCEL_GIT_COMMIT_SHA: "fallback",
    } as NodeJS.ProcessEnv);
    assert.equal(v.commit, "fallback");
  });

  it("treats whitespace-only string as missing", () => {
    const v = buildVersionInfo({
      RAILWAY_GIT_COMMIT_SHA: "   ",
      VERCEL_GIT_COMMIT_SHA: "fallback",
    } as NodeJS.ProcessEnv);
    assert.equal(v.commit, "fallback");
  });

  it("trims surrounding whitespace from returned values", () => {
    const v = buildVersionInfo({
      RAILWAY_GIT_COMMIT_SHA: "  abc123  ",
    } as NodeJS.ProcessEnv);
    assert.equal(v.commit, "abc123");
  });
});
