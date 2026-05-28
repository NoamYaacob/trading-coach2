/**
 * Source-scan contract tests confirming that expired/unavailable accounts
 * are excluded from primary selectors on /dashboard and /trades, but are
 * still surfaced in a dedicated "Expired / unavailable" group with archive
 * actions on the dashboard.
 *
 * No JSX renderer — matches the project's existing safety-test pattern.
 * Catches regressions where someone iterates `commandCenter.accounts`
 * directly in places that should iterate `activeAccounts`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd(), "src");
function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

describe("/dashboard: expired-account isolation", () => {
  const page = read("app/dashboard/page.tsx");

  it("partitions accounts into active and expired groups", () => {
    assert.ok(
      page.includes("partitionAccountsByActive"),
      "must call partitionAccountsByActive on commandCenter.accounts",
    );
    assert.ok(
      page.includes("activeAccounts"),
      "must reference the active accounts variable",
    );
    assert.ok(
      page.includes("expiredAccounts"),
      "must reference the expired accounts variable",
    );
  });

  it("uses activeAccounts for the auto-select fallback (never auto-selects an expired account)", () => {
    // Must NOT find the old un-filtered fallback that picked from all accounts
    assert.ok(
      !/autoSelectedAccount\s*=\s*\n?\s*commandCenter\.accounts\.find/.test(page),
      "autoSelectedAccount must derive from activeAccounts, not commandCenter.accounts",
    );
    // The auto-select chain must reference activeAccounts
    assert.ok(
      /autoSelectedAccount\s*=\s*\n?\s*activeAccounts\.find/.test(page),
      "autoSelectedAccount must start the fallback chain on activeAccounts",
    );
  });

  it("renders the expired-accounts group with archive action when expired accounts exist", () => {
    assert.ok(
      page.includes("Expired / unavailable"),
      "must render the 'Expired / unavailable' section heading",
    );
    assert.ok(
      page.includes("ArchiveAccountButton"),
      "must render the ArchiveAccountButton for each expired account",
    );
    assert.ok(
      page.includes("Historical data preserved"),
      "must include copy clarifying that archiving preserves history",
    );
  });

  it("sidebar account list iterates only active accounts", () => {
    // The sidebar block uses activeAccounts.slice(0, 4)
    assert.ok(
      /activeAccounts\.slice\(0,\s*4\)/.test(page),
      "sidebar must slice activeAccounts (not commandCenter.accounts)",
    );
  });

  it("active account cards grid iterates only active accounts", () => {
    assert.ok(
      /activeAccounts\.map\(/.test(page),
      "the main account cards grid must map over activeAccounts",
    );
  });
});

describe("/trades: expired-account isolation", () => {
  const page = read("app/trades/page.tsx");

  it("partitions accounts and exposes activeAccounts", () => {
    assert.ok(
      page.includes("partitionAccountsByActive"),
      "trades page must call partitionAccountsByActive",
    );
    assert.ok(
      page.includes("activeAccounts"),
      "trades page must reference activeAccounts",
    );
  });

  it("auto-selects from activeAccounts, never from expired accounts", () => {
    // Trades auto-select must use activeAccounts[0], not accounts[0]
    assert.ok(
      /activeAccounts\[0\]/.test(page),
      "trades page must auto-select activeAccounts[0]",
    );
  });

  it("account picker tabs iterate only active accounts", () => {
    assert.ok(
      /activeAccounts\.map\(/.test(page),
      "trades account tab strip must map over activeAccounts",
    );
  });

  it("permits deep-link to an expired account via ?accountId= and shows a notice", () => {
    assert.ok(
      page.includes("selectedAccountIsExpired"),
      "must compute whether the selected account is expired",
    );
    assert.ok(
      page.includes("Viewing historical trades for an expired or unavailable account"),
      "must show a clear notice when viewing an expired account's history",
    );
  });

  it("sidebar account list iterates only active accounts", () => {
    assert.ok(
      /activeAccounts\.slice\(0,\s*4\)/.test(page),
      "trades sidebar must slice activeAccounts (not the full accounts array)",
    );
  });

  it("shows a clear empty state when all accounts are expired/unavailable", () => {
    assert.ok(
      page.includes("No live accounts to show trades for."),
      "must show 'No live accounts' empty state when all accounts are expired",
    );
  });
});

describe("Archive endpoint: preserves historical data", () => {
  // The archive flow uses POST /api/accounts/[id]/protection with
  // protectionStatus="archived". This source-scan asserts the route only
  // mutates the ConnectedAccount protectionStatus and never touches the
  // NormalizedTradeEvent, AccountRiskRules, or AuditEvent tables.
  const route = read("app/api/accounts/[id]/protection/route.ts");

  it("archive branch updates ONLY protectionStatus fields on ConnectedAccount", () => {
    // Locate the full archived block (from the if-guard to the Compute lock comment).
    // The block now has two exits: immediate archive and deferred (pending) archive —
    // both must not touch historical data, and at least one path must set
    // protectionStatus: "archived".
    const archiveBlockStart = route.indexOf('newStatus === "archived"');
    assert.ok(archiveBlockStart !== -1, "archived branch must exist");
    // Block ends just before the lock-state computation that follows it.
    const archiveBlockEnd = route.indexOf("// Compute lock state from the user", archiveBlockStart);
    const archivedBlock = archiveBlockEnd !== -1
      ? route.slice(archiveBlockStart, archiveBlockEnd)
      : route.slice(archiveBlockStart, archiveBlockStart + 3000);

    // Must NOT delete or touch trade/rule/audit tables
    for (const forbidden of [
      "normalizedTradeEvent",
      "accountRiskRules",
      "auditEvent",
      "riskRules.delete",
      ".deleteMany(",
    ]) {
      assert.ok(
        !archivedBlock.includes(forbidden),
        `archive branch must not reference '${forbidden}' — historical data must be preserved`,
      );
    }
    // Must update protectionStatus on connectedAccount somewhere in the block
    assert.ok(
      archivedBlock.includes("connectedAccount.update"),
      "archive branch must call connectedAccount.update",
    );
    assert.ok(
      archivedBlock.includes('protectionStatus: "archived"'),
      "archive branch must set protectionStatus to 'archived' in the immediate path",
    );
  });
});
