import React from "react";
import Link from "next/link";

import { DisconnectButton } from "@/app/accounts/_components/disconnect-button";
import { computeAccountDisconnectState, type DisconnectWindowState } from "@/lib/broker-disconnect-window";
import { RemoveAccountButton } from "./remove-account-button";
import { RemoveBrokerConnectionButton } from "./remove-broker-connection-button";
import { AccountDiscoveryHelper } from "./account-discovery-helper";

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
  brokerConnection: {
    id: string;
    env: string;
    connectionStatus: string;
    permissionLevel: string | null;
  } | null;
};

export type BrokerConnectionRow = {
  id: string;
  platform: string;
  env: string;
  connectionStatus: string;
  permissionLevel: string | null;
  createdAt: Date;
  brokerUserId: string | null;
  tokenExpiresAt: Date | null;
  lastReconciliationAt: Date | null;
  lastReconciliationStatus: string | null;
  lastReconciledAccountCount: number | null;
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
 * Per-account display properties derived exclusively from permissionLevel.
 *
 * permissionLevel is the authoritative source for write-access capability:
 *   full_access   — probe confirmed Account Risk Settings access
 *   read_only     — probe confirmed 401/403; broker writes will fail
 *   unknown/null  — probe inconclusive or not yet run
 *
 * connectionStatus is NOT used to determine the badge or copy here.
 * It only drives the "since <date>" annotation (connected_live = first webhook).
 */
type PermDisplay = {
  pill: React.ReactElement;
  copy: string;
  /** Show "Reconnect with full access" upgrade link. */
  showReconnect: boolean;
};

function permDisplay(perm: string | null | undefined): PermDisplay {
  if (perm === "full_access") {
    return {
      pill: <StatusPill label="Risk settings" color="emerald" />,
      copy: "Connected with risk settings access. Guardrail can monitor this account and sync supported broker-side risk settings.",
      showReconnect: false,
    };
  }
  if (perm === "read_only") {
    return {
      pill: <StatusPill label="Read-only" color="sky" />,
      copy: "Connected with read-only access. Guardrail can monitor this account, but cannot apply broker-side risk settings.",
      showReconnect: true,
    };
  }
  // null or "unknown" — probe not yet run or returned an inconclusive result.
  // Show reconnect when "unknown" (probe ran but failed) so the user can trigger
  // a fresh probe; omit when null (probe has never run — it will run on next sync).
  return {
    pill: <StatusPill label="Checking" color="amber" />,
    copy: "Permission check pending. Guardrail can monitor only until access is confirmed.",
    showReconnect: perm === "unknown",
  };
}

// ── Classification ────────────────────────────────────────────────────────────

/**
 * Classifies accounts into four mutually-exclusive buckets.
 *
 * Precedence:
 *   1. inactive  — missing from broker (missingFromBrokerSince set)
 *   2. pending   — pending_decision (new account, not yet set up)
 *   3. needsAttention — OAuth token expired but account still exists in broker
 *   4. connected — everything else
 *
 * Inactive takes highest precedence so an account that is both "missing from
 * broker" and "in an expired connection" ends up in the inactive section (where
 * Remove from Guardrail is offered), not in the reconnect group.
 */
function classifyAccounts(accounts: BrokerAccountRow[]) {
  const pending = accounts.filter(
    (a) => a.protectionStatus === "pending_decision" && a.missingFromBrokerSince == null,
  );
  const pendingIds = new Set(pending.map((a) => a.id));

  const inactive = accounts.filter((a) => a.missingFromBrokerSince != null);
  const inactiveIds = new Set(inactive.map((a) => a.id));

  const needsAttention = accounts.filter(
    (a) =>
      !inactiveIds.has(a.id) &&
      !pendingIds.has(a.id) &&
      (isExpiredStatus(a.connectionStatus) ||
        (a.brokerConnection != null && isExpiredStatus(a.brokerConnection.connectionStatus))),
  );
  const needsAttentionIds = new Set(needsAttention.map((a) => a.id));

  const connected = accounts.filter(
    (a) => !inactiveIds.has(a.id) && !needsAttentionIds.has(a.id) && !pendingIds.has(a.id),
  );

  return { pending, needsAttention, inactive, connected };
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

function ConnectionStatusPill({ status }: { status: string }) {
  if (status === "connected_live") return <StatusPill label="Live" color="emerald" />;
  if (status === "connected_readonly") return <StatusPill label="Connected" color="sky" />;
  if (status === "expired") return <StatusPill label="Expired" color="amber" />;
  if (status === "connection_error") return <StatusPill label="Error" color="orange" />;
  return <StatusPill label={status} color="stone" />;
}

// ── BrokerConnectionCard ──────────────────────────────────────────────────────

function BrokerConnectionCard({
  conn,
  linkedAccounts,
  disconnectWindow,
  userTz,
}: {
  conn: BrokerConnectionRow;
  linkedAccounts: BrokerAccountRow[];
  disconnectWindow: DisconnectWindowState;
  userTz: string | null;
}) {
  const expired = isExpiredStatus(conn.connectionStatus);
  const now = new Date();
  const tokenExpired = conn.tokenExpiresAt != null && conn.tokenExpiresAt < now;
  const tokenSoon =
    !tokenExpired &&
    conn.tokenExpiresAt != null &&
    conn.tokenExpiresAt.getTime() - now.getTime() < 30 * 60 * 1000;

  const canDiscover = !expired;
  const connectedAccts = linkedAccounts.filter((a) => a.missingFromBrokerSince == null);

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
            <ConnectionStatusPill status={conn.connectionStatus} />
            <span className="text-xs text-stone-400">
              {platformLabel(conn.platform)}
            </span>
          </div>

          {/* Tradovate user ID */}
          <p className="text-xs text-stone-500">
            Tradovate user:{" "}
            {conn.brokerUserId ? (
              <span className="font-mono text-stone-700">{conn.brokerUserId}</span>
            ) : (
              <span className="italic text-stone-400">
                {canDiscover ? "(not yet populated)" : "(unknown)"}
              </span>
            )}
          </p>

          {/* Token expiry */}
          {conn.tokenExpiresAt && (
            <p className="text-xs text-stone-500">
              Token expires:{" "}
              <span
                className={
                  tokenExpired
                    ? "font-medium text-red-600"
                    : tokenSoon
                      ? "font-medium text-amber-600"
                      : "text-stone-700"
                }
              >
                {conn.tokenExpiresAt.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
                {tokenExpired ? " — expired" : tokenSoon ? " — expires soon" : ""}
              </span>
            </p>
          )}

          {/* Last sync */}
          {conn.lastReconciliationAt ? (
            <p className="text-xs text-stone-500">
              Last sync:{" "}
              <span className="text-stone-700">
                {conn.lastReconciliationAt.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
              {conn.lastReconciliationStatus && (
                <span className="ml-1 text-stone-400">
                  · {conn.lastReconciliationStatus}
                </span>
              )}
              {conn.lastReconciledAccountCount != null && (
                <span className="ml-1 text-stone-400">
                  · {conn.lastReconciledAccountCount} account(s)
                </span>
              )}
            </p>
          ) : (
            <p className="text-xs text-stone-400">Not yet synced</p>
          )}

          {/* Account discovery capability */}
          <p className="text-xs">
            {canDiscover ? (
              <span className="text-emerald-700">Can discover new accounts</span>
            ) : (
              <span className="text-amber-700">Cannot discover accounts — reconnect required</span>
            )}
          </p>

          {/* Linked account count */}
          <p className="text-xs text-stone-500">
            {connectedAccts.length} linked account(s)
          </p>
        </div>

        {/* Right: reconnect CTA for expired */}
        {expired && (
          <div className="flex shrink-0 flex-col items-end gap-2">
            <Link
              href={reconnectUrl}
              className="inline-flex items-center rounded-full bg-amber-900 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-amber-800"
            >
              Reconnect {envLabel(conn.env) ? `${envLabel(conn.env)} connection` : "connection"}
            </Link>
            {linkedAccounts.length === 0 && (
              <RemoveBrokerConnectionButton connectionId={conn.id} />
            )}
          </div>
        )}
      </div>

      {/* Linked accounts list */}
      {linkedAccounts.length > 0 && (
        <div className="mt-3 grid gap-2 border-t border-stone-100 pt-3">
          {linkedAccounts.map((acct) => {
            const { pill, copy, showReconnect } = permDisplay(
              acct.brokerConnection?.permissionLevel,
            );
            const isLive = acct.connectionStatus === "connected_live";
            const disconnectState = computeAccountDisconnectState(acct, disconnectWindow);
            const isMissing = acct.missingFromBrokerSince != null;

            return (
              <div
                key={acct.id}
                className={`rounded-lg border px-3 py-2.5 ${isMissing ? "border-stone-100 bg-stone-50" : "border-stone-100 bg-white"}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="grid gap-1 text-sm">
                    <p className={`font-medium ${isMissing ? "text-stone-400" : "text-stone-950"}`}>
                      {acct.label}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
                      {isMissing ? (
                        <StatusPill label="Inactive" color="stone" />
                      ) : (
                        <>
                          {pill}
                          {isLive && acct.connectedAt && (
                            <span className="text-stone-400">
                              · since{" "}
                              {acct.connectedAt.toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    {!isMissing && (
                      <p className="text-xs text-stone-500">{copy}</p>
                    )}
                    {isMissing && (
                      <p className="text-xs text-stone-400">
                        No longer active in Tradovate. You can remove it from Guardrail.
                      </p>
                    )}
                    {acct.protectionStatus === "pending_decision" && (
                      <p className="text-xs text-amber-700">Setup needed before trading</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {!isMissing && showReconnect && acct.brokerConnection && (
                      <Link
                        href={`/accounts/connect/tradovate?env=${acct.brokerConnection.env}&reconnect=${acct.brokerConnection.id}`}
                        className="inline-flex items-center rounded-full border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600 transition hover:border-stone-400"
                      >
                        Reconnect with full access
                      </Link>
                    )}
                    {isMissing ? (
                      <RemoveAccountButton accountId={acct.id} redirectTo="/settings" />
                    ) : (
                      <DisconnectButton
                        accountId={acct.id}
                        providerLabel={platformLabel(acct.platform)}
                        redirectTo="/settings"
                        {...disconnectState}
                        windowStartMs={disconnectWindow.nextWindowStart.getTime()}
                        windowEndMs={disconnectWindow.nextWindowEnd.getTime()}
                        userTz={userTz}
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Pending account card ──────────────────────────────────────────────────────

/**
 * One card per pending_decision account (new account not yet set up).
 * Rendered at the top of the section with an amber treatment to draw attention.
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
  disconnectWindow,
  userTz,
}: {
  accounts: BrokerAccountRow[];
  brokerConnections: BrokerConnectionRow[];
  disconnectWindow: DisconnectWindowState;
  userTz: string | null;
}) {
  const { pending, inactive } = classifyAccounts(accounts);

  // Group accounts by brokerConnectionId for per-connection display
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
                disconnectWindow={disconnectWindow}
                userTz={userTz}
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
                disconnectWindow={disconnectWindow}
                userTz={userTz}
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
