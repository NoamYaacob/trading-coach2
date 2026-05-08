/**
 * Audit-tier tests that pin the pending-rule lifecycle.
 *
 * Current state (verified against the source tree):
 *   - pendingPayloadJson + pendingEffectiveDate are WRITTEN by the locked
 *     branch of /api/rules and /api/accounts/[id].
 *   - They are CLEARED (set to JsonNull / null) when the user saves again
 *     during an unlocked window OR when the cron promotes them.
 *   - They are READ (display-only) by app/rules/page.tsx and
 *     account-rules-form.tsx to render the pending panel.
 *   - They are PROMOTED into the active columns by the cron route at
 *     /api/cron/promote-pending-rules, which calls
 *     src/lib/pending-rule-promoter.ts. Eligibility is anchored to the CME
 *     trading-day key (deriveCmeTradingDayKey).
 *
 * These tests guard against silent regressions:
 *   - Promotion-related Prisma writes can only originate from the two
 *     PATCH routes or the promoter library — anything else is suspect.
 *   - The promoter cron must exist and reference the promoter library.
 *   - UI copy must reflect that pending will activate automatically.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..", "..", "..");
const SRC_ROOT = join(REPO_ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      walk(full, out);
    } else if (
      st.isFile() &&
      (full.endsWith(".ts") || full.endsWith(".tsx")) &&
      !full.endsWith(".test.ts") &&
      !full.endsWith(".spec.ts") &&
      !full.endsWith(".d.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

const SOURCE_FILES = walk(SRC_ROOT);

// ── Pending payload write paths are exactly as documented ────────────────────

test("pendingPayloadJson is written from exactly two routes (default rules + account)", () => {
  const writers = SOURCE_FILES.filter((f) => {
    const src = readFileSync(f, "utf8");
    return /pendingPayloadJson:\s*payload|pendingPayloadJson:\s*cleaned/.test(src);
  });
  // Strip the repo prefix for stable assertions across machines.
  const rel = writers.map((f) => f.slice(REPO_ROOT.length + 1)).sort();
  assert.deepEqual(
    rel,
    [
      "src/app/api/accounts/[id]/route.ts",
      "src/app/api/rules/route.ts",
    ],
    "Only the two PATCH routes should write pendingPayloadJson — any new writer needs the audit re-run",
  );
});

// ── Promotion code is centralised ────────────────────────────────────────────

test("only the promoter library and the two PATCH routes touch pending+active rules", () => {
  // A real promoter reads pendingPayloadJson and UPDATEs / DELETEs the
  // matching rules row. We assert that the only files doing both are the
  // documented locations, so a half-baked alt-promoter can't sneak in.
  const allowed = new Set<string>([
    "src/app/api/accounts/[id]/route.ts",
    "src/app/api/rules/route.ts",
    "src/lib/pending-rule-promoter.ts",
  ]);
  const suspicious = SOURCE_FILES.filter((f) => {
    const src = readFileSync(f, "utf8");
    const readsPending = /pendingPayloadJson/.test(src);
    if (!readsPending) return false;
    const writesRules =
      /accountRiskRules\.(update|upsert|delete)|riskRules\.(update|upsert)/i.test(src);
    if (!writesRules) return false;
    const rel = f.slice(REPO_ROOT.length + 1);
    return !allowed.has(rel);
  });
  assert.deepEqual(
    suspicious,
    [],
    "Pending-payload promotion may only happen in /api/rules, /api/accounts/[id], or src/lib/pending-rule-promoter.ts",
  );
});

test("the promoter cron route exists and is wired to the promoter library", () => {
  const path = join(SRC_ROOT, "app", "api", "cron", "promote-pending-rules", "route.ts");
  const src = readFileSync(path, "utf8");
  assert.ok(
    /promotePendingRules/.test(src),
    "cron route must call promotePendingRules from the promoter library",
  );
  assert.ok(
    /x-cron-secret/.test(src),
    "cron route must require the same x-cron-secret header as other crons",
  );
});

test("the promoter uses the CME trading-day key, not raw UTC dates", () => {
  const src = readFileSync(join(SRC_ROOT, "lib", "pending-rule-promoter.ts"), "utf8");
  assert.ok(
    /deriveCmeTradingDayKey/.test(src),
    "promoter must use deriveCmeTradingDayKey to compute the eligibility key",
  );
});

test("the promoter library never imports a Tradovate / broker SDK", () => {
  const src = readFileSync(join(SRC_ROOT, "lib", "pending-rule-promoter.ts"), "utf8");
  // Strip line + block comments before scanning for broker imports / calls so
  // a comment that explicitly says "this module does not call Tradovate" can
  // stay in the source for human readers without tripping the regex.
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    !/from\s+["']@\/lib\/brokers\//.test(stripped),
    "promoter must not import from @/lib/brokers — promotion is a DB activation step only",
  );
  assert.ok(
    !/TradovateClient|tradovate-client|brokers\/tradovate/.test(stripped),
    "promoter code must not reference any Tradovate runtime symbol",
  );
});

// ── Default-template pending banner now reflects the wired promoter ──────────

test("default template pending banner says pending will activate automatically", () => {
  const src = readFileSync(join(SRC_ROOT, "app", "rules", "page.tsx"), "utf8");
  assert.ok(
    src.includes("will activate automatically at the next edit window"),
    "default template pending banner must say pending will activate automatically",
  );
});

test("default template pending banner no longer claims 'not wired yet'", () => {
  const src = readFileSync(join(SRC_ROOT, "app", "rules", "page.tsx"), "utf8");
  assert.ok(
    !src.includes("automatic activation is not wired yet"),
    "the 'not wired yet' line must be removed now that the promoter exists",
  );
});

// ── Pending lock-write isolation (account override never touches default) ────

test("account-route pending write only touches AccountRiskRules", () => {
  const src = readFileSync(
    join(SRC_ROOT, "app", "api", "accounts", "[id]", "route.ts"),
    "utf8",
  );
  // The locked-save branch should upsert AccountRiskRules and never RiskRules.
  // Find the block that writes pendingPayloadJson and confirm it's scoped to
  // accountRiskRules.upsert.
  const lockedBlock = src.match(/eligibility\.canEditNow[\s\S]*?prisma\.accountRiskRules\.upsert/);
  assert.ok(lockedBlock, "expected locked-save branch to upsert accountRiskRules");
  // Same block must NOT call prisma.riskRules.{update|upsert}.
  const lockedSegment = lockedBlock![0];
  assert.ok(
    !/prisma\.riskRules\.(update|upsert)/.test(lockedSegment),
    "locked-save branch in /api/accounts/[id] must not write to RiskRules (default template)",
  );
});

test("default-template-route pending write only touches RiskRules", () => {
  const src = readFileSync(join(SRC_ROOT, "app", "api", "rules", "route.ts"), "utf8");
  // The locked-save branch should upsert RiskRules and never AccountRiskRules.
  const lockedBlock = src.match(/eligibility\.canEditNow[\s\S]*?prisma\.riskRules\.upsert/);
  assert.ok(lockedBlock, "expected locked-save branch to upsert riskRules");
  const lockedSegment = lockedBlock![0];
  assert.ok(
    !/prisma\.accountRiskRules\.(update|upsert)/.test(lockedSegment),
    "locked-save branch in /api/rules must not write to AccountRiskRules (account overrides)",
  );
});

// ── pendingEffectiveDate uses CME trading-day key, not local/UTC midnight ────

test("pendingEffectiveDate is computed from eligibility.nextAllowedAt (CME-anchored)", () => {
  const accountSrc = readFileSync(
    join(SRC_ROOT, "app", "api", "accounts", "[id]", "route.ts"),
    "utf8",
  );
  const rulesSrc = readFileSync(
    join(SRC_ROOT, "app", "api", "rules", "route.ts"),
    "utf8",
  );
  // Both should use eligibility.nextAllowedAt, not Date.now or new Date().
  for (const [path, src] of [
    ["accounts/[id]/route.ts", accountSrc] as const,
    ["rules/route.ts", rulesSrc] as const,
  ]) {
    assert.ok(
      /eligibility\.nextAllowedAt/.test(src),
      `${path} must derive pendingEffectiveDate from eligibility.nextAllowedAt (CME-aware), not local/UTC time`,
    );
  }
});
