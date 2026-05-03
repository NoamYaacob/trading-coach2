/**
 * Design Lab — visual preview of dashboard direction candidates.
 *
 * SAFE TO DELETE: remove this file and the src/app/design-lab/ directory to
 * permanently remove the route. No other file imports from here.
 *
 * Protected by NEXT_PUBLIC_ENABLE_DESIGN_LAB=true — returns 404 otherwise.
 * Uses static mock data only. No Prisma, no auth, no broker calls.
 */
import { notFound } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Design Lab (Preview Only) — Guardrail",
  robots: { index: false, follow: false },
};

// ─── Static mock data ──────────────────────────────────────────────────────────

const M = {
  account: "Apex Funded — Eval",
  platform: "Tradovate",
  accountType: "Evaluation",
  connectionMode: "Broker-connected",
  lastSync: "2 min ago",
  sessionTime: "11:42 AM ET",
  resetTime: "Tomorrow, 6:00 AM ET",
  todayPnL: -120,
  todayTradesCount: 2,
  consecutiveLosses: 1,
  winCount: 1,
  lossCount: 1,
  maxDailyLoss: 500,
  maxTradesPerDay: 5,
  stopAfterLosses: 3,
  dailyProfitTarget: 300,
};

// ─── Shared primitives ─────────────────────────────────────────────────────────

type PermState = "ALLOWED" | "WARNING" | "LOCKED";

function PermChip({ state }: { state: PermState }) {
  const cfg: Record<PermState, { ring: string; dot: string; label: string }> = {
    ALLOWED: { ring: "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200", dot: "bg-emerald-500", label: "Allowed" },
    WARNING: { ring: "bg-amber-100 text-amber-700 ring-1 ring-amber-200",       dot: "bg-amber-400",   label: "Warning" },
    LOCKED:  { ring: "bg-red-100 text-red-700 ring-1 ring-red-200",             dot: "bg-red-500",     label: "Locked"  },
  };
  const c = cfg[state];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${c.ring}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} aria-hidden />
      {c.label}
    </span>
  );
}

type BarTone = "safe" | "warn" | "danger" | "profit" | "neutral";

function Bar({ pct, tone }: { pct: number; tone: BarTone }) {
  const fill: Record<BarTone, string> = {
    safe:    "bg-emerald-500",
    warn:    "bg-amber-400",
    danger:  "bg-red-500",
    profit:  "bg-emerald-400",
    neutral: "bg-stone-300",
  };
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-stone-200">
      <div
        className={`h-full rounded-full transition-all ${fill[tone]}`}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

function EnforcementFooter({ dark = false }: { dark?: boolean }) {
  const cls = dark ? "text-stone-400" : "text-stone-400";
  return (
    <div className={`flex flex-wrap items-center gap-x-5 gap-y-1 text-xs ${cls}`}>
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
        App-level lock active
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-stone-300" aria-hidden />
        Broker-side blocking not active
      </span>
      <span>Tradovate read-only</span>
    </div>
  );
}

function VariantLabel({ n, name, desc }: { n: string; name: string; desc: string }) {
  return (
    <div className="mb-6 flex items-baseline gap-4 border-b border-stone-200 pb-5">
      <span className="shrink-0 font-mono text-3xl font-bold text-stone-200">{n}</span>
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-stone-950">{name}</h2>
        <p className="mt-0.5 text-sm text-stone-500">{desc}</p>
      </div>
    </div>
  );
}

// ─── Variant 1 — Guardrail Baseline ───────────────────────────────────────────
// Reproduces the current production style: warm off-white background, white/90
// cards with rounded corners, progress bars per rule, small stat tiles.

function V1Baseline() {
  const lossUsed = Math.abs(M.todayPnL);
  const rules = [
    { label: "Daily loss",     used: lossUsed,              limit: M.maxDailyLoss,      pfx: "$", tone: lossUsed / M.maxDailyLoss >= 0.8 ? "danger" : lossUsed / M.maxDailyLoss >= 0.5 ? "warn" : "safe" },
    { label: "Trades taken",   used: M.todayTradesCount,    limit: M.maxTradesPerDay,   pfx: "",  tone: M.todayTradesCount / M.maxTradesPerDay >= 0.8 ? "warn" : "safe" },
    { label: "Loss streak",    used: M.consecutiveLosses,   limit: M.stopAfterLosses,   pfx: "",  tone: M.consecutiveLosses / M.stopAfterLosses >= 0.67 ? "warn" : "safe" },
    { label: "Profit target",  used: 0,                     limit: M.dailyProfitTarget, pfx: "$", tone: "profit" },
  ] as const;

  return (
    <div className="rounded-[2rem] border border-stone-200/80 bg-white/85 p-6 shadow-[0_30px_80px_-45px_rgba(41,37,36,0.45)] backdrop-blur lg:p-8">
      {/* Account + permission */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
            {M.connectionMode} · {M.platform}
          </p>
          <p className="mt-1 text-xl font-semibold tracking-tight text-stone-950">{M.account}</p>
          <p className="mt-0.5 text-sm text-stone-500">Synced {M.lastSync} · {M.sessionTime}</p>
        </div>
        <PermChip state="WARNING" />
      </div>

      {/* Rule progress bars */}
      <div className="mb-5 grid gap-2.5">
        {rules.map((r) => (
          <div key={r.label} className="rounded-2xl bg-stone-50 px-4 py-3">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium text-stone-700">{r.label}</span>
              <span className="tabular-nums text-stone-500">{r.pfx}{r.used} / {r.pfx}{r.limit}</span>
            </div>
            <Bar pct={(r.used / r.limit) * 100} tone={r.tone} />
          </div>
        ))}
      </div>

      {/* Stats */}
      <div className="mb-5 grid grid-cols-3 gap-3">
        {[
          { label: "P&L today",   value: "−$120", cls: "text-red-600" },
          { label: "Trades",      value: "2 / 5", cls: "text-stone-950" },
          { label: "Loss streak", value: "1",     cls: "text-stone-950" },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-stone-100 px-4 py-3 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">{s.label}</p>
            <p className={`mt-1.5 text-xl font-bold tabular-nums ${s.cls}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Warning notice */}
      <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
        <span className="font-semibold text-amber-800">Daily loss at 24% of limit.</span>{" "}
        <span className="text-stone-600">$380 budget remaining. 3 trades before cap.</span>
      </div>

      <EnforcementFooter />
    </div>
  );
}

// ─── Variant 2 — Command Center ────────────────────────────────────────────────
// Serious trading risk control room. Stone-950 command header, white body,
// bold rule cards with large numbers, alert feed, broker scope panel.

function V2CommandCenter() {
  const lossUsed = Math.abs(M.todayPnL);
  const ruleCards = [
    { label: "Daily Loss",     used: lossUsed,            limit: M.maxDailyLoss,      pfx: "$", tone: "warn"    as BarTone },
    { label: "Max Trades",     used: M.todayTradesCount,  limit: M.maxTradesPerDay,   pfx: "",  tone: "safe"    as BarTone },
    { label: "Loss Streak",    used: M.consecutiveLosses, limit: M.stopAfterLosses,   pfx: "",  tone: "safe"    as BarTone },
    { label: "Profit Target",  used: 0,                   limit: M.dailyProfitTarget, pfx: "$", tone: "neutral" as BarTone },
  ];

  return (
    <div className="overflow-hidden rounded-[2rem] border border-stone-300 shadow-[0_30px_80px_-45px_rgba(28,25,23,0.40)]">
      {/* Dark command strip */}
      <div className="bg-stone-950 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-stone-400">
              Risk command · {M.platform}
            </p>
            <p className="mt-1 text-xl font-semibold text-stone-50">{M.account}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="rounded bg-stone-800 px-2 py-0.5 font-mono text-[10px] uppercase text-stone-300">
                {M.accountType}
              </span>
              <span className="rounded bg-stone-800 px-2 py-0.5 font-mono text-[10px] uppercase text-stone-300">
                {M.connectionMode}
              </span>
              <span className="font-mono text-[11px] text-stone-500">Synced {M.lastSync}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-bold uppercase tracking-wider text-stone-950">
              ⚠ Warning
            </span>
            <p className="text-right font-mono text-[11px] text-stone-400">
              {M.sessionTime} · Reset {M.resetTime}
            </p>
          </div>
        </div>
      </div>

      {/* White body */}
      <div className="bg-white p-6">
        <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
          {/* Rule cards grid */}
          <div className="grid gap-3 sm:grid-cols-2">
            {ruleCards.map((r) => (
              <div key={r.label} className="rounded-2xl border border-stone-100 bg-stone-50/60 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">{r.label}</p>
                <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight text-stone-950">
                  {r.pfx}{r.used}
                  <span className="ml-1.5 text-base font-normal text-stone-400">/ {r.pfx}{r.limit}</span>
                </p>
                <div className="mt-3">
                  <Bar pct={(r.used / r.limit) * 100} tone={r.tone} />
                </div>
              </div>
            ))}
          </div>

          {/* Right column: alerts + scope */}
          <div className="flex flex-col gap-3">
            <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Active alerts</p>
              <ul className="flex flex-col gap-2 text-sm">
                <li className="flex items-start gap-2 text-stone-700">
                  <span className="mt-0.5 shrink-0 text-amber-500">▲</span>
                  Daily loss at 24% — $380 budget remains
                </li>
                <li className="flex items-start gap-2 text-stone-700">
                  <span className="mt-0.5 shrink-0 text-amber-500">▲</span>
                  1 consecutive loss — 2 away from streak stop
                </li>
              </ul>
            </div>

            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Enforcement scope</p>
              <ul className="flex flex-col gap-1.5">
                {[
                  { dot: "bg-emerald-500", text: "App-level session lock" },
                  { dot: "bg-emerald-500", text: "Telegram alerts (connected)" },
                  { dot: "bg-stone-300",   text: "Order cancel — not active" },
                  { dot: "bg-stone-300",   text: "Position flatten — not active" },
                ].map((item) => (
                  <li key={item.text} className="flex items-center gap-2 text-xs text-stone-600">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.dot}`} aria-hidden />
                    {item.text}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl border border-stone-100 bg-stone-50/60 p-4 text-xs">
              <p className="font-semibold text-stone-700">Tradovate read-only</p>
              <p className="mt-1 text-stone-500">
                Trade events received in real time. Cannot place, modify, or cancel orders. Broker-side enforcement planned after verification.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Variant 3 — Premium Analytics ────────────────────────────────────────────
// Cleaner metrics dashboard. Larger cards with big numbers, session P&L front
// and center, strong typographic hierarchy, generous whitespace.

function V3PremiumAnalytics() {
  const lossUsed = Math.abs(M.todayPnL);
  const bigMetrics = [
    { label: "P&L today",   value: "−$120", sub: "Limit −$500",   cls: "text-red-600" },
    { label: "Budget left", value: "$380",  sub: "76% remaining", cls: "text-stone-950" },
    { label: "Trades",      value: "2 / 5", sub: "3 remaining",   cls: "text-stone-950" },
    { label: "Loss streak", value: "1 / 3", sub: "Stop after 3",  cls: "text-stone-950" },
  ];
  const limitBars = [
    { label: "Daily loss limit",       used: lossUsed,            limit: M.maxDailyLoss,      pfx: "$", tone: "warn"    as BarTone },
    { label: "Max trades per day",     used: M.todayTradesCount,  limit: M.maxTradesPerDay,   pfx: "",  tone: "safe"    as BarTone },
    { label: "Consecutive losses",     used: M.consecutiveLosses, limit: M.stopAfterLosses,   pfx: "",  tone: "safe"    as BarTone },
    { label: "Daily profit target",    used: 0,                   limit: M.dailyProfitTarget, pfx: "$", tone: "profit"  as BarTone },
  ];

  return (
    <div className="rounded-[2rem] border border-stone-100 bg-white p-6 shadow-[0_40px_100px_-50px_rgba(28,25,23,0.18)] lg:p-10">
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.28em] text-stone-400">
            {M.platform} · {M.accountType} · {M.connectionMode}
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-stone-950">{M.account}</h2>
          <p className="mt-1 text-sm text-stone-500">
            Trading open · {M.sessionTime} · Synced {M.lastSync}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="rounded-xl bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 ring-1 ring-amber-200">
            Warning — monitor limits
          </span>
          <p className="text-xs text-stone-400">Resets {M.resetTime}</p>
        </div>
      </div>

      {/* Big metric cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {bigMetrics.map((m) => (
          <div key={m.label} className="rounded-2xl bg-stone-50 px-5 py-5">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-stone-500">{m.label}</p>
            <p className={`mt-3 text-3xl font-bold tabular-nums tracking-tight ${m.cls}`}>{m.value}</p>
            <p className="mt-1 text-xs text-stone-400">{m.sub}</p>
          </div>
        ))}
      </div>

      {/* Limit progress bars */}
      <div className="mb-8 grid gap-5 lg:grid-cols-2">
        {limitBars.map((r) => (
          <div key={r.label}>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium text-stone-700">{r.label}</span>
              <span className="tabular-nums text-stone-400">{r.pfx}{r.used} / {r.pfx}{r.limit}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-stone-100">
              <div
                className={`h-full rounded-full ${
                  r.tone === "warn" ? "bg-amber-400" : r.tone === "profit" ? "bg-emerald-400" : "bg-emerald-500"
                }`}
                style={{ width: `${Math.min(100, (r.used / r.limit) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-stone-100 pt-5 text-xs text-stone-400">
        <span>App-level lock active</span>
        <span className="h-3 w-px bg-stone-200" aria-hidden />
        <span>Broker-side enforcement not active — planned after verification</span>
        <span className="h-3 w-px bg-stone-200" aria-hidden />
        <span>Tradovate read-only webhook</span>
      </div>
    </div>
  );
}

// ─── Variant 4 — Risk Control Room ────────────────────────────────────────────
// Darker top command strip, monospace status bar, compact monitoring panels
// with severity-coded borders. More operational, less editorial.

function V4RiskControlRoom() {
  const lossUsed = Math.abs(M.todayPnL);

  type PanelStatus = "safe" | "warn" | "danger" | "neutral";
  const panels: Array<{ label: string; value: string; limit: string; pct: number; status: PanelStatus }> = [
    { label: "DAILY LOSS",  value: `$${lossUsed}`,              limit: `$${M.maxDailyLoss}`,       pct: (lossUsed / M.maxDailyLoss) * 100,                  status: "warn"    },
    { label: "TRADES",      value: String(M.todayTradesCount),  limit: String(M.maxTradesPerDay),  pct: (M.todayTradesCount / M.maxTradesPerDay) * 100,      status: "safe"    },
    { label: "LOSS STREAK", value: String(M.consecutiveLosses), limit: String(M.stopAfterLosses),  pct: (M.consecutiveLosses / M.stopAfterLosses) * 100,     status: "safe"    },
    { label: "PROFIT TGT",  value: "$0",                        limit: `$${M.dailyProfitTarget}`,  pct: 0,                                                  status: "neutral" },
  ];

  const panelCfg: Record<PanelStatus, { border: string; bg: string; val: string; bar: string; badge: string; badgeLabel: string }> = {
    safe:    { border: "border-stone-200",  bg: "bg-white",        val: "text-stone-950", bar: "bg-emerald-500", badge: "text-emerald-600", badgeLabel: "OK"     },
    warn:    { border: "border-amber-200",  bg: "bg-amber-50/40",  val: "text-amber-700", bar: "bg-amber-400",   badge: "text-amber-600",   badgeLabel: "WARN"   },
    danger:  { border: "border-red-200",    bg: "bg-red-50/40",    val: "text-red-600",   bar: "bg-red-500",     badge: "text-red-600",     badgeLabel: "BREACH" },
    neutral: { border: "border-stone-100",  bg: "bg-stone-50/60",  val: "text-stone-400", bar: "bg-stone-200",   badge: "text-stone-400",   badgeLabel: "—"      },
  };

  return (
    <div className="overflow-hidden rounded-[2rem] border border-stone-300 shadow-[0_30px_80px_-45px_rgba(28,25,23,0.35)]">
      {/* Dark command header */}
      <div className="bg-stone-900 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 ring-1 ring-amber-500/30">
              <span className="text-base font-bold leading-none text-amber-400">!</span>
            </div>
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-stone-400">guardrail · risk</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-base font-semibold text-stone-100">{M.account}</span>
                <span className="rounded bg-stone-700/80 px-1.5 py-0.5 font-mono text-[10px] text-stone-300">{M.platform}</span>
                <span className="rounded bg-stone-700/80 px-1.5 py-0.5 font-mono text-[10px] uppercase text-stone-300">{M.accountType}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded bg-amber-500/20 px-3 py-1 font-mono text-xs font-bold uppercase tracking-[0.15em] text-amber-300 ring-1 ring-amber-500/30">
              WARNING
            </span>
            <span className="rounded bg-stone-800 px-2 py-1 font-mono text-[11px] text-stone-400">{M.sessionTime}</span>
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div className="border-b border-stone-200 bg-stone-50 px-6 py-2">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 font-mono text-[11px]">
          <span className="text-emerald-600">● APP LOCK ACTIVE</span>
          <span className="text-stone-400">○ BROKER CANCEL OFF</span>
          <span className="text-stone-400">○ FLATTEN OFF</span>
          <span className="text-stone-500">DATA: TRADOVATE READ-ONLY</span>
          <span className="ml-auto text-stone-400">SYNC {M.lastSync}</span>
        </div>
      </div>

      {/* Monitoring grid */}
      <div className="bg-white p-5">
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {panels.map((p) => {
            const c = panelCfg[p.status];
            return (
              <div key={p.label} className={`rounded-xl border px-4 py-3 ${c.border} ${c.bg}`}>
                <div className="flex items-start justify-between gap-1">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500">{p.label}</p>
                  <span className={`font-mono text-[10px] font-bold ${c.badge}`}>{c.badgeLabel}</span>
                </div>
                <p className={`mt-2 text-2xl font-bold tabular-nums ${c.val}`}>{p.value}</p>
                <p className="text-[11px] text-stone-400">limit {p.limit}</p>
                <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-stone-200">
                  <div className={`h-full rounded-full ${c.bar}`} style={{ width: `${Math.min(100, p.pct)}%` }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* P&L strip */}
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-5 py-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-wrap items-end gap-6">
              {[
                { label: "P&L TODAY",    value: `−$${lossUsed}`,                   cls: "text-red-600" },
                { label: "BUDGET LEFT",  value: `$${M.maxDailyLoss - lossUsed}`,   cls: "text-stone-950" },
                { label: "WIN / LOSS",   value: `${M.winCount} / ${M.lossCount}`,  cls: "text-stone-950" },
              ].map((s) => (
                <div key={s.label}>
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400">{s.label}</p>
                  <p className={`mt-0.5 text-2xl font-bold tabular-nums tracking-tight ${s.cls}`}>{s.value}</p>
                </div>
              ))}
            </div>
            <div className="text-right">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400">RESET</p>
              <p className="mt-0.5 text-sm font-semibold text-stone-600">{M.resetTime}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function DesignLabPage() {
  if (process.env.NEXT_PUBLIC_ENABLE_DESIGN_LAB !== "true") {
    notFound();
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_rgba(113,63,18,0.07),_transparent_45%),linear-gradient(180deg,_#f5f1ea_0%,_#ede8dc_100%)]">
      {/* Preview banner */}
      <div className="sticky top-0 z-50 border-b border-amber-200 bg-amber-50 px-4 py-2 text-center">
        <p className="text-xs font-semibold text-amber-700">
          Preview only — not connected to live data
          <span className="ml-2 font-normal text-amber-600">/design-lab</span>
        </p>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        {/* Page header */}
        <div className="mb-12 border-b border-stone-200 pb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-500">Design Lab</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-stone-950">
            Dashboard Variants
          </h1>
          <p className="mt-2 max-w-xl text-sm text-stone-500">
            Four visual directions for the Guardrail dashboard. All data is static mock.
            Not connected to any live system. Resets {M.resetTime}.
          </p>
        </div>

        <div className="grid gap-16">
          <section>
            <VariantLabel
              n="01"
              name="Guardrail Baseline"
              desc="Current production style — warm off-white, white cards, progress bars per rule."
            />
            <V1Baseline />
          </section>

          <section>
            <VariantLabel
              n="02"
              name="Command Center"
              desc="Stone-950 command header, bold rule cards with large numbers, alert feed. Risk control room."
            />
            <V2CommandCenter />
          </section>

          <section>
            <VariantLabel
              n="03"
              name="Premium Analytics"
              desc="Larger metric cards, big numbers, generous whitespace, strong typographic hierarchy."
            />
            <V3PremiumAnalytics />
          </section>

          <section>
            <VariantLabel
              n="04"
              name="Risk Control Room"
              desc="Darker command strip, monospace status bar, compact monitoring panels, operational density."
            />
            <V4RiskControlRoom />
          </section>
        </div>

        <div className="mt-16 border-t border-stone-200 pt-8 text-center text-xs text-stone-400">
          <p>
            Preview only. To remove permanently, delete{" "}
            <code className="rounded bg-stone-100 px-1 py-0.5 text-stone-600">src/app/design-lab/</code>
          </p>
        </div>
      </div>
    </div>
  );
}
