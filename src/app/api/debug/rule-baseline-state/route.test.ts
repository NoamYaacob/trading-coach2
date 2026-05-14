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

test("rule-baseline-state: surfaces the DEFAULT TEMPLATE's pendingPayloadJson.maxContracts too", () => {
  // The default template (RiskRules) can ALSO defer saves into
  // pendingPayloadJson when the user is locked. In that state the active
  // RiskRules.maxContracts column is null but the form may still display
  // the typed value, making the account form look like it's misreporting
  // "Not set → 4". The endpoint must surface the default's pending payload
  // so we can distinguish "actually saved" from "saved as pending".
  const s = src();
  // Selection includes RiskRules.pendingPayloadJson + pendingEffectiveDate.
  assert.ok(
    /select:[\s\S]*?pendingPayloadJson:\s*true/.test(s),
    "select must include pendingPayloadJson on the default RiskRules query",
  );
  assert.ok(
    /select:[\s\S]*?pendingEffectiveDate:\s*true/.test(s),
    "select must include pendingEffectiveDate on the default RiskRules query",
  );
  // Response payload exposes the extracted maxContracts key on defaultRiskRules.
  assert.ok(
    /defaultRiskRules[\s\S]{0,800}pendingMaxContracts/.test(s),
    "defaultRiskRules in the JSON response must include pendingMaxContracts",
  );
  assert.ok(
    /defaultRiskRules[\s\S]{0,800}pendingEffectiveDate/.test(s),
    "defaultRiskRules in the JSON response must include pendingEffectiveDate",
  );
});

test("rule-baseline-state: includes externalAccountId per account so the user can match log lines to broker accounts", () => {
  // When debugging a specific Tradovate account (e.g. DEMO7433035), the
  // user needs to see externalAccountId next to the row to confirm which
  // ConnectedAccount.id maps to which broker label.
  assert.ok(
    /externalAccountId:\s*true/.test(src()),
    "select must include externalAccountId on the connectedAccount query",
  );
});

test("rule-baseline-state: the JSON-payload key extractor is shared between default and accounts", () => {
  // Both the default RiskRules and each AccountRiskRules row run their
  // pendingPayloadJson through the same extractor (pendingKey) so the
  // shape of the returned 'pendingMaxContracts' is consistent across
  // both surfaces. A regression where the default payload was serialized
  // differently than the account payload would mask exactly the bug we
  // are diagnosing.
  const s = src();
  assert.ok(
    /function pendingKey\b/.test(s),
    "endpoint must define a shared pendingKey() helper for JSON-shape extraction",
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
