import Link from "next/link";

import { DisconnectButton } from "@/app/accounts/_components/disconnect-button";
import { computeAccountDisconnectState, type DisconnectWindowState } from "@/lib/broker-disconnect-window";
import { RemoveAccountButton } from "./remove-account-button";

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
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function reconnectUrlForAccount(acct: BrokerAccountRow): string {
  if (acct.brokerConnection) {
    return `/accounts/connect/tradovate?env=${acct.brokerConnection.env}&reconnect=${acct.brokerConnection.id}`;
  }
  return "/accounts/connect/tradovate";
}

function reconnectUrlForConnection(bc: BrokerConnectionRow): string {
  return `/accounts/connect/tradovate?env=${bc.env}&reconnect=${bc.id}`;
}

// ── Classification ────────────────────────────────────────────────────────────

function classifyAccounts(accounts: BrokerAccountRow[]) {
  const needsAttention = accounts.filter(
    (a) =>
      isExpiredStatus(a.connectionStatus) ||
      (a.brokerConnection != null && isExpiredStatus(a.brokerConnection.connectionStatus)),
  );
  const needsAttentionIds = new Set(needsAttention.map((a) => a.id));

  const inactive = accounts.filter(
    (a) => a.missingFromBrokerSince != null && !needsAttentionIds.has(a.id),
  );
  const inactiveIds = new Set(inactive.map((a) => a.id));

  const connected = accounts.filter(
    (a) => !needsAttentionIds.has(a.id) && !inactiveIds.has(a.id),
  );

  return { needsAttention, inactive, connected };
}

// ── Status pill atoms ─────────────────────────────────────────────────────────

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
  const { needsAttention, inactive, connected } = classifyAccounts(accounts);

  // Broker connections with expired tokens but no accounts linked (e.g. setup
  // was abandoned before any accounts were discovered).
  const linkedConnectionIds = new Set(
    accounts.map((a) => a.brokerConnectionId).filter(Boolean),
  );
  const orphanedExpired = brokerConnections.filter(
    (bc) => isExpiredStatus(bc.connectionStatus) && !linkedConnectionIds.has(bc.id),
  );

  const hasNeedsAttention = needsAttention.length > 0 || orphanedExpired.length > 0;
  const hasConnected = connected.length > 0;
  const hasInactive = inactive.length > 0;

  if (!hasNeedsAttention && !hasConnected && !hasInactive) {
    return <p className="text-sm text-stone-500">No broker connected yet.</p>;
  }

  return (
    <div className="grid gap-5">

      {/* ── Needs attention ─────────────────────────────────────────────── */}
      {hasNeedsAttention && (
        <div className="grid gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">
            Needs attention
          </p>
          <div className="grid gap-2">

            {needsAttention.map((acct) => {
              const platform = platformLabel(acct.platform);
              const env = envLabel(acct.brokerConnection?.env);
              const subtitle = [platform, env].filter(Boolean).join(" ");
              return (
                <div
                  key={acct.id}
                  className="rounded-xl border border-amber-100 bg-amber-50/60 px-4 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="grid gap-1 text-sm">
                      <p className="font-medium text-amber-950">{acct.label}</p>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-amber-800">
                        <span>{subtitle}</span>
                        <StatusPill label="Expired" color="orange" />
                      </div>
                      <p className="text-xs text-amber-800">
                        Connection expired — reconnect to resume live sync and broker-side risk settings.
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <Link
                        href={reconnectUrlForAccount(acct)}
                        className="inline-flex items-center rounded-full bg-amber-900 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-amber-800"
                      >
                        Reconnect
                      </Link>
                      <RemoveAccountButton accountId={acct.id} redirectTo="/settings" />
                    </div>
                  </div>
                </div>
              );
            })}

            {orphanedExpired.map((bc) => {
              const platform = platformLabel(bc.platform);
              const env = envLabel(bc.env);
              return (
                <div
                  key={bc.id}
                  className="rounded-xl border border-amber-100 bg-amber-50/60 px-4 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="grid gap-1 text-sm">
                      <p className="font-medium text-amber-950">
                        {platform} {env}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-amber-800">
                        <StatusPill label="Expired" color="orange" />
                        <span>· No accounts linked</span>
                      </div>
                      <p className="text-xs text-amber-800">
                        Connection expired — reconnect to restore your broker accounts.
                      </p>
                    </div>
                    <Link
                      href={reconnectUrlForConnection(bc)}
                      className="inline-flex shrink-0 items-center rounded-full bg-amber-900 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-amber-800"
                    >
                      Reconnect
                    </Link>
                  </div>
                </div>
              );
            })}

          </div>
        </div>
      )}

      {/* ── Connected accounts ───────────────────────────────────────────── */}
      {hasConnected && (
        <div className="grid gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
            Connected accounts
          </p>
          <div className="grid gap-2">
            {connected.map((acct) => {
              const platform = platformLabel(acct.platform);
              const env = envLabel(acct.brokerConnection?.env);
              const subtitle = [platform, env].filter(Boolean).join(" ");

              const isReadOnly =
                acct.connectionStatus === "connected_readonly" ||
                acct.brokerConnection?.permissionLevel === "read_only";
              const isLive = acct.connectionStatus === "connected_live";
              const isPending =
                acct.connectionStatus === "pending_webhook" ||
                acct.connectionStatus === "oauth_pending_storage";

              const statusPill = isReadOnly ? (
                <StatusPill label="Read-only" color="sky" />
              ) : isLive ? (
                <StatusPill label="Connected" color="emerald" />
              ) : isPending ? (
                <StatusPill label="Syncing" color="amber" />
              ) : (
                <StatusPill label={acct.connectionStatus.replace(/_/g, " ")} color="stone" />
              );

              const disconnectState = computeAccountDisconnectState(acct, disconnectWindow);

              return (
                <div
                  key={acct.id}
                  className="rounded-xl border border-stone-100 bg-white px-4 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="grid gap-1 text-sm">
                      <p className="font-medium text-stone-950">{acct.label}</p>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
                        <span>{subtitle}</span>
                        {statusPill}
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
                      </div>
                      {isReadOnly ? (
                        <p className="text-xs text-stone-500">
                          Connected with read-only access. Guardrail can monitor this account,
                          but cannot apply broker-side risk settings.
                        </p>
                      ) : (
                        acct.brokerConnection?.permissionLevel === "full_access" && (
                          <p className="text-xs text-stone-400">
                            Full access · Risk settings enabled
                          </p>
                        )
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      {isReadOnly && acct.brokerConnection && (
                        <Link
                          href={`/accounts/connect/tradovate?env=${acct.brokerConnection.env}&reconnect=${acct.brokerConnection.id}`}
                          className="inline-flex items-center rounded-full border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600 transition hover:border-stone-400"
                        >
                          Reconnect with full access
                        </Link>
                      )}
                      <DisconnectButton
                        accountId={acct.id}
                        providerLabel={platform}
                        redirectTo="/settings"
                        {...disconnectState}
                        windowStartMs={disconnectWindow.nextWindowStart.getTime()}
                        windowEndMs={disconnectWindow.nextWindowEnd.getTime()}
                        userTz={userTz}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
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

    </div>
  );
}
