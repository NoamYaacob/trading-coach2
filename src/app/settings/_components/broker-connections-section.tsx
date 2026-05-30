import React from "react";

import { RemoveAccountButton } from "./remove-account-button";
import { RemoveBrokerConnectionButton } from "./remove-broker-connection-button";
import { AccountDiscoveryHelper } from "./account-discovery-helper";
import { DisconnectConnectionButton } from "./disconnect-connection-button";
import Link from "next/link";
import { type DisconnectWindowState } from "@/lib/broker-disconnect-window";

// ── Types ─────────────────────────────────────────────────────────────────────

export type BrokerAccountRow = {
  id: string;
  label: string;
  platform: string;
  connectionStatus: string;
  connectedAt: Date | null;
  protectionStatus: string;
  missingFromBrokerSince: Date | null;
  lastSyncAt: Date | null;
  brokerConnectionId: string | null;
  pendingProtectionStatus: string | null;
  brokerConnection: {
    id: string;
    env: string;
    connectionStatus: string;
    permissionLevel: string | null;
  } | null;
};

/**
 * User-facing broker connection. Technical/diagnostic fields (brokerUserId,
 * tokenExpiresAt, lastReconciliation*, permissionLevel) are intentionally NOT
 * part of this type — normal Settings never shows them. They remain available
 * on the admin-only /debug/broker-accounts page.
 */
export type BrokerConnectionRow = {
  id: string;
  platform: string;
  env: string;
  connectionStatus: string;
  createdAt: Date;
};

// ── Pure helpers ──────────────────────────────────────────────────────────────

function platformLabel(platform: string): string {
  if (platform === "tradovate") return "Tradovate";
  if (platform === "tradingview") return "TradingView";
  if (platform === "manual") return "Manual";
  return platform;
}

function envLabel(env: string | null | undefined): string {
  if (env === "demo") return "Demo";
  if (env === "live") return "Live";
  return "";
}

function isExpiredStatus(status: string): boolean {
  return status === "expired" || status === "connection_error";
}

function reconnectUrlForConnection(bc: { id: string; env: string }): string {
  return `/accounts/connect/tradovate?env=${bc.env}&reconnect=${bc.id}`;
}

/**
 * Maps the raw connectionStatus enum to a single user-facing status. Internal
 * OAuth detail (token refresh / expiry timing) is never surfaced — users expect
 * a connection to stay connected until they disconnect it.
 */
function userFacingStatus(status: string): { label: string; color: "emerald" | "sky" | "amber" | "orange" } {
  if (status === "connected_live") return { label: "Connected", color: "emerald" };
  if (status === "connected_readonly") return { label: "Connected", color: "sky" };
  if (status === "expired") return { label: "Reconnect required", color: "amber" };
  if (status === "connection_error") return { label: "Needs reconnect", color: "orange" };
  return { label: "Connected", color: "sky" };
}

// ── Classification ────────────────────────────────────────────────────────────

/**
 * Classifies accounts into the standalone buckets rendered outside the
 * connection cards. Archived accounts are excluded here — they appear only
 * inside their connection card's collapsed "archived" list.
 *
 *   - pending  — pending_decision (new account, not yet set up)
 *   - inactive — missing from broker (missingFromBrokerSince set), not archived
 */
function classifyAccounts(accounts: BrokerAccountRow[]) {
  const nonArchived = accounts.filter((a) => a.protectionStatus !== "archived");

  const inactive = nonArchived.filter((a) => a.missingFromBrokerSince != null);
  const inactiveIds = new Set(inactive.map((a) => a.id));

  const pending = nonArchived.filter(
    (a) =>
      a.protectionStatus === "pending_decision" &&
      a.missingFromBrokerSince == null &&
      !inactiveIds.has(a.id),
  );

  return { pending, inactive };
}

// ── Status pill ───────────────────────────────────────────────────────────────

function StatusPill({
  label,
  color,
}: {
  label: string;
  color: "emerald" | "sky" | "orange" | "amber" | "stone";
}) {
  const cls = {
    emerald: "bg-emerald-50 text-emerald-700",
    sky: "bg-sky-50 text-sky-700",
    orange: "bg-orange-100 text-orange-700",
    amber: "bg-amber-100 text-amber-700",
    stone: "bg-stone-100 text-stone-500",
  }[color];
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] ${cls}`}
    >
      {label}
    </span>
  );
}

// ── BrokerConnectionCard ──────────────────────────────────────────────────────

function BrokerConnectionCard({
  conn,
  linkedAccounts,
}: {
  conn: BrokerConnectionRow;
  linkedAccounts: BrokerAccountRow[];
}) {
  const expired = isExpiredStatus(conn.connectionStatus);
  const status = userFacingStatus(conn.connectionStatus);

  const archivedAccounts = linkedAccounts.filter((a) => a.protectionStatus === "archived");
  // Active accounts = everything the disconnect endpoint will act on.
  const activeAccounts = linkedAccounts.filter((a) => a.protectionStatus !== "archived");

  // The DELETE route succeeds only when every linked account is already
  // archived (it unlinks them, preserving history, then deletes the
  // connection). Mirror that here so the button never errors.
  const canRemoveConnection = linkedAccounts.every((a) => a.protectionStatus === "archived");

  const reconnectUrl = reconnectUrlForConnection(conn);

  return (
    <div
      className={`rounded-xl border px-4 py-4 ${expired ? "border-amber-200 bg-amber-50/40" : "border-stone-100 bg-white"}`}
    >
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${
                conn.env === "live"
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-sky-100 text-sky-700"
              }`}
            >
              {envLabel(conn.env)}
            </span>
            <StatusPill label={status.label} color={status.color} />
          </div>

          {/* Provider */}
          <p className="text-sm font-medium text-stone-800">{platformLabel(conn.platform)}</p>

          {/* Linked account count — true total (active + archived) */}
          <p className="text-xs text-stone-500">
            {linkedAccounts.length} linked account(s)
          </p>

          {/* Scheduled-removal note — surfaced at connection level so a deferred
              archive (locked / rule-active account) stays visible without
              listing every account row. */}
          {activeAccounts.some((a) => a.pendingProtectionStatus === "archived") && (
            <p className="text-xs text-amber-700">
              Removal scheduled — takes effect at the next trading session reset
            </p>
          )}
        </div>

        {/* Right: actions */}
        <div className="flex shrink-0 flex-col items-end gap-2">
          {expired ? (
            <>
              <Link
                href={reconnectUrl}
                className="inline-flex items-center rounded-full bg-amber-900 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-amber-800"
              >
                Reconnect {envLabel(conn.env) ? `${envLabel(conn.env)} connection` : "connection"}
              </Link>
              {canRemoveConnection ? (
                <RemoveBrokerConnectionButton connectionId={conn.id} />
              ) : (
                <DisconnectConnectionButton
                  connectionId={conn.id}
                  linkedAccountCount={activeAccounts.length}
                />
              )}
            </>
          ) : (
            <DisconnectConnectionButton
              connectionId={conn.id}
              linkedAccountCount={activeAccounts.length}
            />
          )}
        </div>
      </div>

      {/* Archived accounts — collapsed secondary list */}
      {archivedAccounts.length > 0 && (
        <details className="mt-3 border-t border-stone-100 pt-3">
          <summary className="cursor-pointer list-none text-xs font-medium text-stone-500">
            {archivedAccounts.length} archived account(s) under this connection
          </summary>
          <div className="mt-2 grid gap-1.5">
            {archivedAccounts.map((acct) => (
              <div
                key={acct.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-100 bg-stone-50 px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-medium text-stone-500">{acct.label}</span>
                  <StatusPill label="Archived" color="stone" />
                </div>
                <span className="text-[11px] text-stone-400">
                  Will be unlinked when this connection is removed
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ── Pending account card ──────────────────────────────────────────────────────

/**
 * One card per pending_decision account (new account not yet set up).
 */
function PendingAccountCard({ acct }: { acct: BrokerAccountRow }) {
  const platform = platformLabel(acct.platform);
  const env = envLabel(acct.brokerConnection?.env);
  const subtitle = [platform, env].filter(Boolean).join(" ");
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1 text-sm">
          <p className="font-medium text-stone-950">{acct.label}</p>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
            <span>{subtitle}</span>
            <StatusPill label="Setup needed" color="amber" />
          </div>
          <p className="text-xs text-amber-800">
            New account found. Set up rules before trading.
          </p>
        </div>
        <Link
          href={`/rules?scope=account&id=${acct.id}`}
          className="inline-flex shrink-0 items-center rounded-full bg-stone-950 px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-stone-800"
        >
          Set rules
        </Link>
      </div>
    </div>
  );
}

// ── Section component ─────────────────────────────────────────────────────────

export function BrokerConnectionsSection({
  accounts,
  brokerConnections,
}: {
  accounts: BrokerAccountRow[];
  brokerConnections: BrokerConnectionRow[];
  // Accepted for API compatibility with the settings page; the simplified
  // card no longer renders per-account disconnect windows.
  disconnectWindow?: DisconnectWindowState;
  userTz?: string | null;
}) {
  const { pending, inactive } = classifyAccounts(accounts);

  // Group accounts by brokerConnectionId for per-connection display.
  const accountsByConn = new Map<string, BrokerAccountRow[]>();
  for (const acct of accounts) {
    const key = acct.brokerConnectionId ?? "__unlinked__";
    if (!accountsByConn.has(key)) accountsByConn.set(key, []);
    accountsByConn.get(key)!.push(acct);
  }

  const liveConnections = brokerConnections.filter((bc) => bc.env === "live");
  const demoConnections = brokerConnections.filter((bc) => bc.env === "demo");

  const hasPending = pending.length > 0;
  const hasInactive = inactive.length > 0;
  const hasAnyConnection = brokerConnections.length > 0;

  if (!hasAnyConnection && !hasPending && !hasInactive) {
    return <p className="text-sm text-stone-500">No broker connected yet.</p>;
  }

  return (
    <div className="grid gap-5">

      {/* ── Explanation block — always visible ──────────────────────────── */}
      <div className="rounded-xl border border-stone-100 bg-stone-50/50 px-4 py-3 text-xs">
        <p className="font-semibold text-stone-700">How broker connections work</p>
        <p className="mt-1 leading-relaxed text-stone-600">
          A broker connection is the permission link to Tradovate. Broker accounts sit under
          that connection. If the connection expires, Guardrail keeps your saved rules, but
          live sync and broker-side enforcement pause until you reconnect.
        </p>
      </div>

      {/* ── Live connections ─────────────────────────────────────────────── */}
      {liveConnections.length > 0 && (
        <div className="grid gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
            Live connections
          </p>
          <div className="grid gap-3">
            {liveConnections.map((conn) => (
              <BrokerConnectionCard
                key={conn.id}
                conn={conn}
                linkedAccounts={accountsByConn.get(conn.id) ?? []}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Demo connections ─────────────────────────────────────────────── */}
      {demoConnections.length > 0 && (
        <div className="grid gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
            Demo connections
          </p>
          <div className="grid gap-3">
            {demoConnections.map((conn) => (
              <BrokerConnectionCard
                key={conn.id}
                conn={conn}
                linkedAccounts={accountsByConn.get(conn.id) ?? []}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── New accounts — pending setup ────────────────────────────────── */}
      {hasPending && (
        <div className="grid gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">
            New — needs setup
          </p>
          <div className="grid gap-2">
            {pending.map((acct) => (
              <PendingAccountCard key={acct.id} acct={acct} />
            ))}
          </div>
        </div>
      )}

      {/* ── Archived / inactive ──────────────────────────────────────────── */}
      {hasInactive && (
        <div className="grid gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
            Archived / inactive
          </p>
          <div className="grid gap-2">
            {inactive.map((acct) => {
              const platform = platformLabel(acct.platform);
              const env = envLabel(acct.brokerConnection?.env);
              const subtitle = [platform, env].filter(Boolean).join(" ");
              return (
                <div
                  key={acct.id}
                  className="rounded-xl border border-stone-100 bg-white px-4 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="grid gap-1 text-sm">
                      <p className="font-medium text-stone-700">{acct.label}</p>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-stone-400">
                        <span>{subtitle}</span>
                        <StatusPill label="Inactive" color="stone" />
                      </div>
                      <p className="text-xs text-stone-500">
                        No longer active in Tradovate. You can remove it from Guardrail.
                      </p>
                    </div>
                    <RemoveAccountButton accountId={acct.id} redirectTo="/settings" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Why don't I see my new account? ─────────────────────────────── */}
      <AccountDiscoveryHelper />

    </div>
  );
}
