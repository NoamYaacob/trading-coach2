/**
 * Static-analysis tests for the rule-baseline-state diagnostic route.
 * The project's test runner (node --experimental-strip-types) does not
 * resolve tsconfig path aliases, so we cannot dynamically import the
 * Next.js handler. Mirrors the audit pattern used by other route tests
 * (see src/app/api/cron/promote-pending-rules/route.test.ts).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..", "..", "..");
const ROUTE_PATH = join(
  REPO_ROOT,
  "src",
  "app",
  "api",
  "debug",
  "rule-baseline-state",
  "route.ts",
);

function src(): string {
  return readFileSync(ROUTE_PATH, "utf8");
}

test("rule-baseline-state: requires authenticated session via getCurrentUser", () => {
  assert.ok(
    /getCurrentUser\(\)/.test(src()),
    "route must call getCurrentUser() to authenticate",
  );
  assert.ok(
    /status:\s*401/.test(src()),
    "unauthenticated callers must receive 401",
  );
});

test("rule-baseline-state: scopes the query to the requesting user", () => {
  // The userId filter on both queries enforces that callers can only see
  // their own rules — never another user's data.
  assert.ok(
    /userId:\s*user\.id/.test(src()),
    "default-template query must filter by the authenticated user's id",
  );
  assert.ok(
    /where:\s*\{\s*userId:\s*user\.id/.test(src()),
    "connectedAccount query must filter by the authenticated user's id",
  );
});

test("rule-baseline-state: returns the maxContracts column on RiskRules", () => {
  // The whole point of this endpoint: surface RiskRules.maxContracts so the
  // user can confirm whether the diff baseline source value is null.
  assert.ok(
    /maxContracts:\s*true/.test(src()),
    "select must include maxContracts on the default RiskRules query",
  );
});

test("rule-baseline-state: surfaces pendingPayloadJson.maxContracts explicitly", () => {
  // The endpoint extracts the maxContracts key out of pendingPayloadJson
  // and returns it as `pendingMaxContracts`, so the caller doesn't have to
  // parse JSON shape themselves.
  assert.ok(
    /pendingMaxContracts/.test(src()),
    "response must surface pendingPayloadJson.maxContracts as 'pendingMaxContracts'",
  );
});

test("rule-baseline-state: does not write to the database", () => {
  // Strict read-only — diagnostic endpoints must never mutate state.
  const stripped = src()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    !/prisma\.\w+\.(update|upsert|delete|create|deleteMany|updateMany)/i.test(stripped),
    "diagnostic route must never call write methods on prisma",
  );
});
