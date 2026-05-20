/**
 * Pure helper — zero DB calls, zero Next.js imports.
 * Converts a CommandCenterAccount into a compact set of "chips" shown
 * on dashboard account rows and in the Safety Console.
 *
 * SAFETY INVARIANT: never show "Broker-backed: Profit target" — only
 * maxDailyLoss is broker-eligible. See rule-capabilities.ts.
 */

import type { CommandCenterAccount } from "../../app/dashboard/_components/command-center/types";

export type RuleSummaryChipSeverity = "ok" | "warning" | "locked" | "inactive" | "unsupported";

export type RuleSummaryChip = {
  key: string;
  text: string;
  /** "ok" | "warning" | "locked" | "inactive" | "unsupported" */
  severity: RuleSummaryChipSeverity;
};

/**
 * Build a compact list of rule status chips for an account row.
 * Returns an empty array gracefully for edge cases.
 */
export function buildRuleSummaryChips(account: CommandCenterAccount): RuleSummaryChip[] {
  try {
    const chips: RuleSummaryChip[] = [];

    // Not monitored at all — single chip, return early.
    if (
      account.protectionStatus !== "protected" &&
      account.protectionStatus !== "monitor_only"
    ) {
      return [{ key: "not_monitored", text: "Not monitored", severity: "inactive" }];
    }

    // Daily loss limit chip
    if (account.maxDailyLoss != null) {
      const pct = account.dailyLossUsedPct ?? 0;
      const isLocked =
        account.internalLockActive === true ||
        account.isLockedForToday === true ||
        account.brokerLockStatus === "broker_locked" ||
        account.status === "locked";

      let severity: RuleSummaryChipSeverity;
      if (isLocked) {
        severity = "locked";
      } else if (pct >= 70) {
        severity = "warning";
      } else {
        severity = "ok";
      }

      chips.push({
        key: "daily_loss",
        text: `Daily loss $${account.maxDailyLoss.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
        severity,
      });
    }

    // Max trades chip
    if (account.maxTradesPerDay != null) {
      chips.push({
        key: "max_trades",
        text: `Max trades ${account.maxTradesPerDay}`,
        severity: "ok",
      });
    }

    // Consecutive losses chip
    if (account.stopAfterLosses != null) {
      chips.push({
        key: "consec_losses",
        text: `Max streak ${account.stopAfterLosses}`,
        severity: "ok",
      });
    }

    // Max contracts chip (only when configured)
    if (account.hasMaxPositionSize) {
      chips.push({
        key: "max_contracts",
        text: "Position size limit",
        severity: "ok",
      });
    }

    // Broker-backed note — ONLY for daily loss, never for profit target or other rules
    const isBrokerBacked =
      (account.brokerLockStatus !== null && account.brokerLockStatus !== "not_requested") ||
      account.enforcementMode === "broker_active";
    if (isBrokerBacked && account.maxDailyLoss != null) {
      chips.push({
        key: "broker_backed",
        text: "Broker-backed: Daily loss",
        severity: "ok",
      });
    }

    // Listener stale warning
    if (account.listenerStatus !== "connected" && account.listenerLastEventAt != null) {
      const thirtyMinutesMs = 30 * 60 * 1000;
      const staleSince = Date.now() - account.listenerLastEventAt.getTime();
      if (staleSince > thirtyMinutesMs) {
        chips.push({
          key: "listener_stale",
          text: "Listener not connected",
          severity: "warning",
        });
      }
    } else if (account.listenerStatus !== "connected" && account.listenerLastEventAt == null) {
      // Listener has never connected but account is supposed to be monitored — skip,
      // the connection status badge handles this at a higher level.
    }

    return chips;
  } catch {
    // Graceful degradation — never throw from a pure helper.
    return [];
  }
}
