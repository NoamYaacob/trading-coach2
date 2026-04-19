"use client";

import { useState } from "react";

export type DiagnosticsEvent = {
  eventType: string;
  occurredAt: string;
  pnl: string | null;
  side: string | null;
};

export type DiagnosticsIntervention = {
  triggerType: string;
  outcome: string;
  createdAt: string;
  message: string | null;
};

export type DiagnosticsSession = {
  riskState: string;
  dailyPnl: string;
  tradesCount: number;
  consecutiveLosses: number;
  cooldownActive: boolean;
  cooldownUntil: string | null;
  sessionDate: string;
} | null;

type Props = {
  accountId: string;
  connectionStatus: string;
  externalAccountId: string | null;
  connectedAt: string | null;
  sessionSnapshot: DiagnosticsSession;
  recentEvents: DiagnosticsEvent[];
  recentInterventions: DiagnosticsIntervention[];
  isDev: boolean;
};

const EVENT_TYPE_LABEL: Record<string, string> = {
  trade_closed: "Trade closed",
  trade_opened: "Trade opened",
  daily_pnl_updated: "P&L update",
};

const TRIGGER_LABEL: Record<string, string> = {
  daily_loss_limit: "Daily loss limit",
  consecutive_losses: "Consecutive losses",
  max_trades_reached: "Max trades reached",
  rapid_trading: "Rapid trading",
  revenge_entry: "Revenge entry",
  increased_size_after_loss: "Size increase after loss",
  outside_allowed_hours: "Outside trading hours",
};

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

type TestResult = Record<string, unknown>;

export function DiagnosticsPanel({
  accountId,
  connectionStatus,
  externalAccountId,
  connectedAt,
  sessionSnapshot,
  recentEvents,
  recentInterventions,
  isDev,
}: Props) {
  const [open, setOpen] = useState(false);
  const [firing, setFiring] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  async function handleFireTestEvent() {
    setFiring(true);
    setTestResult(null);
    setTestError(null);
    try {
      const res = await fetch("/api/debug/fire-test-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      });
      const data = (await res.json()) as TestResult;
      if (!res.ok) {
        setTestError((data.error as string) ?? "Request failed");
      } else {
        setTestResult(data);
      }
    } catch {
      setTestError("Network error");
    } finally {
      setFiring(false);
    }
  }

  return (
    <div className="rounded-[1.75rem] border border-stone-200 bg-stone-50">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between px-6 py-4 text-left"
      >
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
          Diagnostics
        </span>
        <span className="text-xs text-stone-400">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="grid gap-5 border-t border-stone-200 px-6 pb-6 pt-5">
          {/* Connection + Session */}
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
                Connection
              </p>
              <dl className="grid gap-1.5 text-sm">
                <Row label="Status">
                  <span className="font-mono text-stone-900">{connectionStatus}</span>
                </Row>
                <Row label="Account ID">
                  <span className="font-mono text-stone-900">{externalAccountId ?? "—"}</span>
                </Row>
                {connectedAt && (
                  <Row label="Live since">
                    <span className="text-stone-700">{shortDate(connectedAt)}</span>
                  </Row>
                )}
              </dl>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
                Session today
              </p>
              {sessionSnapshot ? (
                <dl className="grid gap-1.5 text-sm">
                  <Row label="Risk state">
                    <span
                      className={`font-semibold ${
                        sessionSnapshot.riskState === "STOPPED"
                          ? "text-red-700"
                          : sessionSnapshot.riskState === "WARNING"
                            ? "text-amber-700"
                            : "text-emerald-700"
                      }`}
                    >
                      {sessionSnapshot.riskState}
                    </span>
                  </Row>
                  <Row label="Daily P&L">
                    <span
                      className={`font-mono ${
                        Number(sessionSnapshot.dailyPnl) < 0
                          ? "text-red-700"
                          : Number(sessionSnapshot.dailyPnl) > 0
                            ? "text-emerald-700"
                            : "text-stone-900"
                      }`}
                    >
                      {Number(sessionSnapshot.dailyPnl) >= 0 ? "+" : ""}
                      {Number(sessionSnapshot.dailyPnl).toFixed(2)}
                    </span>
                  </Row>
                  <Row label="Trades">
                    <span className="text-stone-900">{sessionSnapshot.tradesCount}</span>
                  </Row>
                  <Row label="Loss streak">
                    <span className="text-stone-900">{sessionSnapshot.consecutiveLosses}</span>
                  </Row>
                  {sessionSnapshot.cooldownActive && (
                    <Row label="Cooldown">
                      <span className="text-amber-700">
                        {sessionSnapshot.cooldownUntil
                          ? `Until ${shortDate(sessionSnapshot.cooldownUntil)}`
                          : "Active"}
                      </span>
                    </Row>
                  )}
                </dl>
              ) : (
                <p className="text-sm text-stone-400">No session data — no events yet today.</p>
              )}
            </div>
          </div>

          {/* Recent events */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
              Recent events ({recentEvents.length})
            </p>
            {recentEvents.length === 0 ? (
              <p className="text-sm text-stone-400">No events yet.</p>
            ) : (
              <div className="grid gap-1">
                {recentEvents.map((e, i) => (
                  <div key={i} className="flex items-baseline gap-3 text-sm">
                    <span className="shrink-0 font-mono text-xs text-stone-400">
                      {shortDate(e.occurredAt)}
                    </span>
                    <span className="text-stone-700">
                      {EVENT_TYPE_LABEL[e.eventType] ?? e.eventType.replace(/_/g, " ")}
                    </span>
                    {e.pnl != null && (
                      <span
                        className={`font-mono text-xs ${
                          Number(e.pnl) < 0 ? "text-red-600" : "text-emerald-600"
                        }`}
                      >
                        {Number(e.pnl) >= 0 ? "+" : ""}
                        {Number(e.pnl).toFixed(2)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent interventions */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
              Recent interventions ({recentInterventions.length})
            </p>
            {recentInterventions.length === 0 ? (
              <p className="text-sm text-stone-400">No interventions recorded.</p>
            ) : (
              <div className="grid gap-1">
                {recentInterventions.map((iv, i) => (
                  <div key={i} className="flex items-baseline gap-3 text-sm">
                    <span className="shrink-0 font-mono text-xs text-stone-400">
                      {shortDate(iv.createdAt)}
                    </span>
                    <span className="text-stone-700">
                      {TRIGGER_LABEL[iv.triggerType] ?? iv.triggerType.replace(/_/g, " ")}
                    </span>
                    <span
                      className={`text-xs font-semibold ${
                        iv.outcome === "stop" || iv.outcome === "cooldown"
                          ? "text-red-600"
                          : iv.outcome === "warning"
                            ? "text-amber-600"
                            : "text-stone-500"
                      }`}
                    >
                      {iv.outcome}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Dev-only test event */}
          {isDev && (
            <div className="border-t border-stone-200 pt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
                Development tools
              </p>
              <button
                type="button"
                onClick={handleFireTestEvent}
                disabled={firing}
                className="inline-flex rounded-full border border-stone-300 px-4 py-2 text-xs font-medium text-stone-700 transition hover:border-stone-500 hover:text-stone-950 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {firing ? "Firing…" : "Fire test trade (−$50)"}
              </button>
              <p className="mt-1.5 text-xs text-stone-400">
                Persists a synthetic trade_closed event through the guardian pipeline. Telegram not
                sent.
              </p>
              {testError && (
                <p className="mt-2 text-xs text-red-600">{testError}</p>
              )}
              {testResult && (
                <pre className="mt-3 overflow-x-auto rounded-xl border border-stone-200 bg-stone-100 p-3 text-xs leading-relaxed text-stone-700">
                  {JSON.stringify(testResult, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="shrink-0 text-stone-500">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
