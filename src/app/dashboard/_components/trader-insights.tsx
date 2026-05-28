/**
 * Trader-insights server-rendered panel.
 *
 * Renders a small 2×3 grid of stat cards immediately after the KPI strip on
 * the dashboard.  Pure presentational — all computation goes through the
 * pure helpers in `./insights.ts` and the supplied snapshot data; no I/O.
 *
 * Account isolation: every stat is derived from data already scoped to the
 * selected account by the caller (selectedAccount and the per-account
 * recentTrades array).  This component never reaches into other accounts.
 *
 * Empty-state policy: when a piece of data is missing or undefined, the
 * relevant card shows an honest "—" / "No … configured" message — never a
 * fabricated number.
 */

import type { CommandCenterAccount } from "@/app/dashboard/_components/command-center/types";
import type { GuardianSnapshot } from "@/lib/guardian";
import type { RoundTripTrade } from "@/lib/trades/round-trips";

import {
  biggestLoss,
  biggestWin,
  maxDrawdown,
  profitFactor,
} from "./insights.ts";

type RiskRulesLike = {
  stopAfterLosses: number | null;
} | null;

type Props = {
  selectedAccount: CommandCenterAccount;
  guardian: GuardianSnapshot;
  riskRules: RiskRulesLike;
  /** Round-trip trades over the last 30 days for the selected account. */
  recentTrades: RoundTripTrade[];
  /** IANA timezone used to determine "today" boundary. */
  timezone: string;
};

function fmt$(v: number): string {
  const abs = Math.abs(v);
  const sign = v >= 0 ? "+" : "−";
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtMoney(v: number): string {
  return `$${v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function StatCard({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "ok" | "warn" | "bad";
}) {
  const valueColor =
    tone === "warn"
      ? "var(--gr-warn)"
      : tone === "bad"
      ? "var(--gr-bad)"
      : tone === "ok"
      ? "var(--gr-ok)"
      : "var(--gr-ink)";
  return (
    <div
      style={{
        background: "var(--gr-surface)",
        border: "1px solid var(--gr-border)",
        borderRadius: 12,
        padding: 16,
      }}
    >
      <span
        style={{
          fontSize: 10.5,
          fontWeight: 500,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--gr-text-mute)",
        }}
      >
        {label}
      </span>
      <div
        style={{
          fontSize: 20,
          fontWeight: 600,
          lineHeight: 1,
          letterSpacing: "-0.02em",
          marginTop: 8,
          fontFamily: "var(--font-ibm-plex-mono, monospace)",
          color: valueColor,
        }}
      >
        {value}
      </div>
      {sub && (
        <span
          style={{
            fontSize: 11,
            marginTop: 6,
            display: "inline-block",
            color: "var(--gr-text-mute)",
            lineHeight: 1.4,
          }}
        >
          {sub}
        </span>
      )}
    </div>
  );
}

export function TraderInsights({
  selectedAccount,
  guardian: _guardian,
  riskRules: _riskRules,
  recentTrades,
  timezone,
}: Props) {
  // Today boundary expressed via en-CA key in the displayed timezone so it
  // matches the calendar's bucketing logic.
  const now = new Date();
  const todayKey = now.toLocaleDateString("en-CA", { timeZone: timezone });
  const todayTrades = recentTrades.filter(
    (t) => t.closedAt.toLocaleDateString("en-CA", { timeZone: timezone }) === todayKey,
  );

  // 1. Daily loss remaining
  const lossRemainingCard = (() => {
    if (selectedAccount.remainingDailyLoss != null && selectedAccount.maxDailyLoss != null) {
      const pct = selectedAccount.dailyLossUsedPct ?? 0;
      return (
        <StatCard
          key="daily-loss-remaining"
          label="Daily loss remaining"
          value={fmtMoney(selectedAccount.remainingDailyLoss)}
          sub={`of ${fmtMoney(selectedAccount.maxDailyLoss)} limit · ${Math.round(pct * 100)}% used`}
          tone={pct > 0.8 ? "warn" : "ok"}
        />
      );
    }
    return (
      <StatCard
        key="daily-loss-remaining"
        label="Daily loss remaining"
        value="—"
        sub="No daily-loss rule configured"
      />
    );
  })();

  // 2. Trades left today
  const tradesLeftCard = (() => {
    if (selectedAccount.maxTradesPerDay != null) {
      const used = selectedAccount.tradesCount ?? 0;
      const left = Math.max(0, selectedAccount.maxTradesPerDay - used);
      const pct = selectedAccount.tradesUsedPct ?? 0;
      return (
        <StatCard
          key="trades-left"
          label="Trades left today"
          value={String(left)}
          sub={`${used} of ${selectedAccount.maxTradesPerDay} used`}
          tone={pct > 0.8 ? "warn" : "ok"}
        />
      );
    }
    return null;
  })();

  // 3. Biggest win today
  const biggestWinCard = (() => {
    const winner = biggestWin(todayTrades);
    if (winner) {
      return (
        <StatCard
          key="biggest-win"
          label="Biggest win today"
          value={fmt$(winner.pnl)}
          sub={`${winner.symbol} · ${winner.side} · ${winner.qty}`}
          tone="ok"
        />
      );
    }
    return (
      <StatCard
        key="biggest-win"
        label="Biggest win today"
        value="—"
        sub={todayTrades.length === 0 ? "No round-trips today" : "No winners today"}
      />
    );
  })();

  // 4. Biggest loss today
  const biggestLossCard = (() => {
    const loser = biggestLoss(todayTrades);
    if (loser) {
      return (
        <StatCard
          key="biggest-loss"
          label="Biggest loss today"
          value={fmt$(loser.pnl)}
          sub={`${loser.symbol} · ${loser.side} · ${loser.qty}`}
          tone="bad"
        />
      );
    }
    return (
      <StatCard
        key="biggest-loss"
        label="Biggest loss today"
        value="—"
        sub={todayTrades.length === 0 ? "No round-trips today" : "No losers today"}
      />
    );
  })();

  // 5. Profit factor (30d)
  const profitFactorCard = (() => {
    const pf = profitFactor(recentTrades);
    if (pf == null) {
      return (
        <StatCard
          key="profit-factor"
          label="Profit factor (30d)"
          value="—"
          sub={
            recentTrades.length === 0
              ? "No round-trips in window"
              : "No losing trades yet — undefined"
          }
        />
      );
    }
    return (
      <StatCard
        key="profit-factor"
        label="Profit factor (30d)"
        value={pf.toFixed(2)}
        sub={`gross wins ÷ gross losses · ${recentTrades.length} trades`}
        tone={pf >= 1 ? "ok" : "warn"}
      />
    );
  })();

  // 6. Max drawdown (30d)
  const maxDdCard = (() => {
    if (recentTrades.length === 0) {
      return (
        <StatCard
          key="max-drawdown"
          label="Max drawdown (30d)"
          value="—"
          sub="No round-trips in window"
        />
      );
    }
    const dd = maxDrawdown(recentTrades);
    return (
      <StatCard
        key="max-drawdown"
        label="Max drawdown (30d)"
        value={dd > 0 ? `−${fmtMoney(dd)}` : "$0.00"}
        sub={
          dd > 0
            ? "Worst peak-to-trough across cum. P&L"
            : "Cum. P&L has not pulled back"
        }
        tone={dd > 0 ? "warn" : "neutral"}
      />
    );
  })();

  const cards = [
    lossRemainingCard,
    tradesLeftCard,
    biggestWinCard,
    biggestLossCard,
    profitFactorCard,
    maxDdCard,
  ].filter((c) => c != null);

  return (
    <section style={{ padding: "0 36px 20px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 10,
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--gr-text-mute)",
          }}
        >
          Trader insights · {selectedAccount.label}
        </span>
        <span style={{ fontSize: 11, color: "var(--gr-text-mute)" }}>
          Computed from this account&apos;s broker fills only
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 12,
        }}
      >
        {cards}
      </div>
    </section>
  );
}
