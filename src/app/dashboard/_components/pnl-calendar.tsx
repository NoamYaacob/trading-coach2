"use client";

/**
 * P&L calendar client island.
 *
 * Renders a real month grid (6 weeks × 7 days) of daily realized P&L for the
 * selected account, with prev/next month navigation.  Aggregation uses the
 * dashboard's timezone-aware en-CA date key (same as the prior inline
 * implementation) so timezone behaviour is preserved.
 *
 * Honest-data caveats:
 *   - The source `trades` prop only covers the last 30 days of synced fills.
 *     When the user navigates to a month earlier than that window we still
 *     render the grid (so the user can see the calendar exists) but show an
 *     inline notice that older months will populate as fills are backfilled.
 *   - "Today" only highlights when the user is viewing the current month.
 *   - Empty months show the same honest empty-state message as the
 *     30-day implementation.
 */

import * as React from "react";
import Link from "next/link";

import type { RoundTripTrade } from "@/lib/trades/round-trips";

type Props = {
  /** Round-trip trades for the selected account (already <= 30d). */
  trades: RoundTripTrade[];
  /** IANA timezone used for daily aggregation, e.g. "America/Chicago". */
  timezone: string;
  /** Label of the selected account, shown in the panel subtitle. */
  accountLabel: string;
  /** Destination for the "View trades →" link in the panel header. */
  tradesHref: string;
  /** Account ID used to build day-click deep links to /trades?accountId=…&date=… */
  accountId: string;
};

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmt$(v: number): string {
  const abs = Math.abs(v);
  const sign = v >= 0 ? "+" : "−";
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function monthLabel(year: number, month: number): string {
  // month is 0-indexed.
  return new Date(year, month, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

/**
 * Build a 6×7 = 42-cell grid for the supplied (year, month) viewed in the
 * supplied timezone.  Each cell carries an en-CA "YYYY-MM-DD" key so trade
 * aggregation can be looked up directly.
 */
function buildMonthGrid(
  year: number,
  month: number,
  timezone: string,
): Array<{ key: string; dayNum: number; inMonth: boolean }> {
  // First day of the month, anchored at noon to avoid DST midnight edges.
  const firstOfMonth = new Date(Date.UTC(year, month, 1, 12, 0, 0));
  // Day-of-week (in displayed timezone) for the first of the month.
  const fmtDow = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  });
  const firstDow = DOW_LABELS.indexOf(fmtDow.format(firstOfMonth));
  // Start of grid = (firstOfMonth - firstDow days), aligned to Sunday.
  const gridStart = new Date(firstOfMonth);
  gridStart.setUTCDate(firstOfMonth.getUTCDate() - firstDow);

  const cells: Array<{ key: string; dayNum: number; inMonth: boolean }> = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setUTCDate(gridStart.getUTCDate() + i);
    const key = d.toLocaleDateString("en-CA", { timeZone: timezone });
    // dayNum + inMonth derived from the timezone-local date string.
    const parts = key.split("-");
    const cellYear = parseInt(parts[0] ?? "0", 10);
    const cellMonth = parseInt(parts[1] ?? "0", 10) - 1;
    const dayNum = parseInt(parts[2] ?? "0", 10);
    cells.push({
      key,
      dayNum,
      inMonth: cellYear === year && cellMonth === month,
    });
  }
  return cells;
}

export function PnlCalendar({ trades, timezone, accountLabel, tradesHref, accountId }: Props) {
  const [monthOffset, setMonthOffset] = React.useState(0);

  const now = new Date();
  const todayKey = now.toLocaleDateString("en-CA", { timeZone: timezone });
  // Anchor month = current calendar month in the displayed timezone.
  const anchorYear = parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric" }).format(now),
    10,
  );
  const anchorMonth =
    parseInt(
      new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "2-digit" }).format(now),
      10,
    ) - 1;
  // Apply offset.  Using JS Date math handles negative offsets correctly:
  // new Date(2026, -1, 1) → December 2025.
  const viewDate = new Date(anchorYear, anchorMonth + monthOffset, 1);
  const viewYear = viewDate.getFullYear();
  const viewMonth = viewDate.getMonth();

  // Aggregate trades by displayed-timezone day (en-CA key).
  const dayMap = React.useMemo(() => {
    const map = new Map<string, { pnl: number; count: number }>();
    for (const t of trades) {
      const key = t.closedAt.toLocaleDateString("en-CA", { timeZone: timezone });
      const cur = map.get(key) ?? { pnl: 0, count: 0 };
      map.set(key, { pnl: cur.pnl + t.pnl, count: cur.count + 1 });
    }
    return map;
  }, [trades, timezone]);

  const cells = React.useMemo(
    () => buildMonthGrid(viewYear, viewMonth, timezone),
    [viewYear, viewMonth, timezone],
  );

  // Month totals + win/loss counts for cells that are in-month and have data.
  const inMonthCells = cells.filter((c) => c.inMonth);
  const tradedCells = inMonthCells
    .map((c) => ({ ...c, data: dayMap.get(c.key) ?? null }))
    .filter((c) => c.data && c.data.count > 0);
  const winDays = tradedCells.filter((c) => c.data!.pnl > 0).length;
  const lossDays = tradedCells.filter((c) => c.data!.pnl < 0).length;
  const totalPnl = tradedCells.reduce((s, c) => s + c.data!.pnl, 0);
  const totalTrades = tradedCells.reduce((s, c) => s + c.data!.count, 0);

  const isViewingPast = monthOffset < 0;
  const isCurrentMonth = monthOffset === 0;

  return (
    <div
      style={{
        background: "var(--gr-surface)",
        border: "1px solid var(--gr-border)",
        borderRadius: 14,
        padding: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 16,
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div>
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--gr-ink)" }}>
            P&amp;L calendar
          </span>
          <div
            style={{ fontSize: 11.5, color: "var(--gr-text-mute)", marginTop: 2 }}
          >
            Daily realized P&amp;L · {accountLabel}
          </div>
        </div>
        <Link
          href={tradesHref}
          className="btn-compact"
          style={{
            fontSize: 12,
            padding: "4px 10px",
            borderRadius: 7,
            border: "none",
            background: "transparent",
            color: "var(--gr-copper)",
            textDecoration: "none",
          }}
        >
          View trades →
        </Link>
      </div>

      {/* Month nav + heading */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <button
          type="button"
          onClick={() => setMonthOffset((o) => o - 1)}
          aria-label="Previous month"
          className="btn-compact"
          style={{
            width: 28, height: 28,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontSize: 12,
            borderRadius: 7,
            border: "1px solid var(--gr-border)",
            background: "var(--gr-surface)",
            color: "var(--gr-text-mid)",
            cursor: "pointer",
          }}
        >
          ◀
        </button>
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--gr-ink)",
            letterSpacing: "-0.01em",
            minWidth: 140,
            textAlign: "center",
          }}
        >
          {monthLabel(viewYear, viewMonth)}
        </span>
        <button
          type="button"
          onClick={() => setMonthOffset((o) => Math.min(0, o + 1))}
          aria-label="Next month"
          disabled={isCurrentMonth}
          className="btn-compact"
          style={{
            width: 28, height: 28,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontSize: 12,
            borderRadius: 7,
            border: "1px solid var(--gr-border)",
            background: "var(--gr-surface)",
            color: isCurrentMonth ? "var(--gr-text-faint)" : "var(--gr-text-mid)",
            cursor: isCurrentMonth ? "not-allowed" : "pointer",
            opacity: isCurrentMonth ? 0.4 : 1,
          }}
        >
          ▶
        </button>
        {!isCurrentMonth && (
          <button
            type="button"
            onClick={() => setMonthOffset(0)}
            className="btn-compact"
            style={{
              padding: "4px 10px",
              fontSize: 11,
              borderRadius: 7,
              border: "1px solid var(--gr-border)",
              background: "transparent",
              color: "var(--gr-copper)",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            Today
          </button>
        )}
      </div>

      {/* Historical-data caveat — visible whenever the user navigates to a
        * previous month, since the trade source only covers ~30 days. */}
      {isViewingPast && (
        <div
          style={{
            marginBottom: 12,
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid var(--gr-border)",
            background: "var(--gr-bg-elev)",
            fontSize: 11.5,
            color: "var(--gr-text-mute)",
            lineHeight: 1.5,
          }}
        >
          Showing only the last 30 days of synced fills. Older months will
          populate as fills are backfilled.
        </div>
      )}

      {/* Monthly summary line */}
      {tradedCells.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 20,
            marginBottom: 14,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 12, color: "var(--gr-text-mute)" }}>
            <span style={{ color: "var(--gr-ok)", fontWeight: 600 }}>
              {winDays}W
            </span>
            {" · "}
            <span style={{ color: "var(--gr-bad)", fontWeight: 600 }}>
              {lossDays}L
            </span>
            {" · "}
            {tradedCells.length} day{tradedCells.length !== 1 ? "s" : ""} traded ·
            {" "}{totalTrades} trade{totalTrades !== 1 ? "s" : ""}
          </span>
          <span
            style={{
              fontSize: 12,
              fontFamily: "var(--font-ibm-plex-mono, monospace)",
              fontWeight: 600,
              color: totalPnl >= 0 ? "var(--gr-ok)" : "var(--gr-bad)",
            }}
          >
            {fmt$(totalPnl)} total
          </span>
        </div>
      )}

      {/* Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {DOW_LABELS.map((d) => (
          <div
            key={d}
            style={{
              fontSize: 10,
              color: "var(--gr-text-faint)",
              textAlign: "center",
              padding: "4px 0 6px",
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            {d}
          </div>
        ))}
        {cells.map((cell, i) => {
          const data = dayMap.get(cell.key) ?? null;
          const hasTrades = data != null && data.count > 0;
          const pnl = data?.pnl ?? 0;
          const isToday = cell.key === todayKey;
          const title = hasTrades
            ? `${cell.key} · ${fmt$(pnl)} · ${data!.count} trade${data!.count !== 1 ? "s" : ""}`
            : cell.inMonth
            ? `${cell.key} · no trades`
            : undefined;
          const cellBg = !cell.inMonth
            ? "transparent"
            : hasTrades && pnl > 0
            ? "var(--gr-ok-bg)"
            : hasTrades && pnl < 0
            ? "var(--gr-bad-bg)"
            : "var(--gr-bg-elev)";
          const cellBorder = isToday
            ? "1.5px solid var(--gr-copper)"
            : cell.inMonth
            ? "1px solid var(--gr-border)"
            : "1px solid transparent";
          return (
            <div
              key={i}
              title={title}
              style={{
                padding: "4px 3px 4px",
                borderRadius: 7,
                textAlign: "left",
                minHeight: 44,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: 1,
                background: cellBg,
                border: cellBorder,
                boxShadow: isToday ? "0 0 0 2px var(--gr-copper-bg)" : "none",
                opacity: !cell.inMonth ? 0.3 : 1,
                position: "relative",
                cursor: hasTrades && accountId ? "pointer" : "default",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  color: isToday ? "var(--gr-copper)" : "var(--gr-text-mid)",
                  fontWeight: isToday ? 700 : 500,
                  lineHeight: 1,
                  padding: "0 2px",
                }}
              >
                {cell.dayNum}
              </span>
              {hasTrades ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 1,
                    paddingBottom: 2,
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontFamily: "var(--font-ibm-plex-mono, monospace)",
                      color: pnl > 0 ? "var(--gr-ok)" : "var(--gr-bad)",
                      fontWeight: 700,
                      lineHeight: 1,
                    }}
                  >
                    {pnl > 0 ? "+" : "−"}${Math.abs(pnl).toFixed(0)}
                  </div>
                  <div
                    style={{
                      fontSize: 9,
                      color: "var(--gr-text-faint)",
                      fontWeight: 500,
                      lineHeight: 1,
                    }}
                  >
                    {data!.count}T
                  </div>
                </div>
              ) : (
                cell.inMonth && <div style={{ height: 12 }} />
              )}
              {hasTrades && accountId && (
                <Link
                  href={`/trades?accountId=${accountId}&date=${cell.key}`}
                  aria-label={`View trades for ${cell.key}`}
                  style={{ position: "absolute", inset: 0, borderRadius: 7 }}
                />
              )}
            </div>
          );
        })}
      </div>

      {tradedCells.length === 0 && (
        <div
          style={{
            padding: "16px 0",
            textAlign: "center",
            fontSize: 12.5,
            color: "var(--gr-text-mute)",
          }}
        >
          No closed trades in the last 30 days. Calendar fills as trades close.
        </div>
      )}
    </div>
  );
}
