/**
 * Audit-tier tests that document the pending-rule lifecycle today.
 *
 * Findings (verified against the source tree):
 *   - pendingPayloadJson and pendingEffectiveDate are WRITTEN by:
 *       /api/rules         (default-template locked save)
 *       /api/accounts/[id] (account-override locked save)
 *   - They are CLEARED (set to JsonNull / null) when the user saves again
 *     during an unlocked window — the new save replaces both active and
 *     pending state, but does NOT first apply the pending values.
 *   - They are READ (display-only) by app/rules/page.tsx and
 *     account-rules-form.tsx to render the pending panel.
 *   - There is NO cron job, page-load side effect, background task, or any
 *     other code path that reads pendingPayloadJson and writes its values
 *     into the active columns. Verified by grep below.
 *
 * Conclusion: pending changes are saved memory only. The user must re-save
 * during the next edit window for the values to take effect. The UI copy
 * must reflect that truth.
 *
 * These tests guard against silent regressions:
 *   - If someone adds a half-baked auto-promotion path that bypasses the
 *     eligibility check, the "no promotion code" test will fire.
 *   - If someone re-introduces stale "applies automatically" copy, the copy
 *     tests in account-rules-form-copy.test.ts will fire.
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

// ── No promotion code anywhere ───────────────────────────────────────────────

test("no source file applies pendingPayloadJson values into active rule columns", () => {
  // A real promoter would: read pendingPayloadJson, then UPDATE/upsert
  // AccountRiskRules or RiskRules with the pending values. We look for
  // any file that both READS pendingPayloadJson (treating it as a value
  // to promote) AND issues a Prisma update against either rules table.
  //
  // The display-only readers (page.tsx, account-rules-form.tsx) read
  // pendingPayloadJson to show the diff but never write it back.
  const suspicious = SOURCE_FILES.filter((f) => {
    const src = readFileSync(f, "utf8");
    const readsPending = /pendingPayloadJson/.test(src);
    if (!readsPending) return false;
    const writesActive =
      /accountRiskRules\.(update|upsert)|riskRules\.(update|upsert)/i.test(src);
    if (!writesActive) return false;
    // Allow the documented PATCH routes, since they clear pending without
    // promoting, which is the behaviour we're testing for.
    if (
      f.endsWith("/app/api/accounts/[id]/route.ts") ||
      f.endsWith("/app/api/rules/route.ts")
    ) {
      return false;
    }
    return true;
  });
  assert.deepEqual(
    suspicious,
    [],
    "No file outside the two PATCH routes should both read pendingPayloadJson and write to *RiskRules — that would be a half-baked promotion path",
  );
});

test("no cron route promotes pending rules", () => {
  const cronDir = join(SRC_ROOT, "app", "api", "cron");
  const cronFiles = walk(cronDir);
  for (const f of cronFiles) {
    const src = readFileSync(f, "utf8");
    assert.ok(
      !/pendingPayloadJson/.test(src),
      `cron route ${f} must not reference pendingPayloadJson — there is no scheduled promoter today`,
    );
  }
});

// ── Default-template pending banner is honest about no auto-activation ───────

test("default template pending banner says automatic activation is not wired yet", () => {
  const src = readFileSync(join(SRC_ROOT, "app", "rules", "page.tsx"), "utf8");
  assert.ok(
    src.includes("automatic activation is not wired yet"),
    "default template pending banner must explicitly say automatic activation is not wired yet",
  );
});

test("default template pending banner does not say 'Applies at:' (implied automation)", () => {
  const src = readFileSync(join(SRC_ROOT, "app", "rules", "page.tsx"), "utf8");
  assert.ok(
    !src.includes("Applies at:"),
    "default template banner must not say 'Applies at:' — the time is when the next edit window opens, not when the rules apply automatically",
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
