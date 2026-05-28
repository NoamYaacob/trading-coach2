import React from "react";
import Link from "next/link";

import { DisconnectButton } from "@/app/accounts/_components/disconnect-button";
import { computeAccountDisconnectState, type DisconnectWindowState } from "@/lib/broker-disconnect-window";
import { RemoveAccountButton } from "./remove-account-button";
import { RemoveBrokerConnectionButton } from "./remove-broker-connection-button";

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

type ExpiredConnectionGroup = {
  connectionId: string;
  platform: string;
  env: string;
  reconnectUrl: string;
  accounts: BrokerAccountRow[];
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

function reconnectUrlForAccount(acct: BrokerAccountRow): string {
  if (acct.brokerConnection) {
    return `/accounts/connect/tradovate?env=${acct.brokerConnection.env}&reconnect=${acct.brokerConnection.id}`;
  }
  return "/accounts/connect/tradovate";
}

function reconnectUrlForConnection(bc: BrokerConnectionRow): string {
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

/**
 * Groups expired accounts by their brokerConnectionId so that all accounts
 * belonging to the same OAuth token are displayed as one card, not N cards.
 * Accounts without a brokerConnectionId each get their own synthetic group.
 */
function groupExpiredByConnection(accounts: BrokerAccountRow[]): ExpiredConnectionGroup[] {
  const groups = new Map<string, ExpiredConnectionGroup>();

  for (const acct of accounts) {
    const key = acct.brokerConnectionId ?? `__standalone_${acct.id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        connectionId: key,
        platform: acct.platform,
        env: acct.brokerConnection?.env ?? "",
        reconnectUrl: reconnectUrlForAccount(acct),
        accounts: [],
      });
    }
    groups.get(key)!.accounts.push(acct);
  }

  return Array.from(groups.values());
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

// ── Sub-components ────────────────────────────────────────────────────────────

/**
 * One card per expired broker connection. All accounts that share the same
 * OAuth token are listed compactly inside the single card so the user
 * understands one reconnect action fixes all of them.
 */
function ExpiredConnectionGroupCard({ group }: { group: ExpiredConnectionGroup }) {
  const platform = platformLabel(group.platform);
  const env = envLabel(group.env);
  const count = group.accounts.length;
  const title = `${platform}${env ? ` ${env}` : ""} connection expired`;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        {/* Left: description */}
        <div className="grid min-w-0 gap-2">
          <div>
            <p className="text-sm font-semibold text-amber-950">{title}</p>
            <p className="mt-0.5 text-xs text-amber-700">
              {count === 1
                ? `Affects 1 account: ${group.accounts[0]!.label}`
                : `Affects ${count} accounts`}
            </p>
          </div>

          {/* Affected account list — shown only for 2+ accounts */}
          {count > 1 && (
            <ul className="grid gap-0.5">
              {group.accounts.map((acct) => (
                <li key={acct.id} className="flex items-center gap-1.5 text-xs text-amber-800">
                  <span className="h-1 w-1 shrink-0 rounded-full bg-amber-400" aria-hidden />
                  {acct.label}
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs text-amber-800">
            Connection expired — reconnect to resume live sync and broker-side risk settings
            {count > 1 ? " for these accounts." : "."}
          </p>
          <p className="text-xs text-amber-700">
            Broker-side enforcement paused until reconnect.
          </p>
        </div>

        {/* Right: primary action */}
        <Link
          href={group.reconnectUrl}
          className="inline-flex shrink-0 items-center rounded-full bg-amber-900 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-amber-800"
        >
          Reconnect {env ? `${env} connection` : "connection"}
        </Link>
      </div>
    </div>
  );
}

/**
 * Compact muted row for an expired broker connection that has no linked
 * accounts. Does not visually compete with groups that have real affected
 * accounts.
 */
function OrphanedConnectionRow({ bc }: { bc: BrokerConnectionRow }) {
  const platform = platformLabel(bc.platform);
  const env = envLabel(bc.env);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-stone-50 px-4 py-2.5">
      <p className="text-xs text-stone-500">
        Old expired {platform}
        {env ? ` ${env}` : ""} connection
        {" · "}
        <span className="text-stone-400">No accounts linked</span>
      </p>
      <RemoveBrokerConnectionButton connectionId={bc.id} />
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
  const { pending, needsAttention, inactive, connected } = classifyAccounts(accounts);

  const expiredGroups = groupExpiredByConnection(needsAttention);

  // Broker connections whose token expired but have no linked accounts at all
  // (e.g. setup abandoned before any accounts were discovered).
  const linkedConnectionIds = new Set(
    accounts.map((a) => a.brokerConnectionId).filter(Boolean),
  );
  const orphanedExpired = brokerConnections.filter(
    (bc) => isExpiredStatus(bc.connectionStatus) && !linkedConnectionIds.has(bc.id),
  );

  const hasPending = pending.length > 0;
  const hasNeedsAttention = expiredGroups.length > 0;
  const hasOrphaned = orphanedExpired.length > 0;
  const hasConnected = connected.length > 0;
  const hasInactive = inactive.length > 0;

  if (!hasPending && !hasNeedsAttention && !hasOrphaned && !hasConnected && !hasInactive) {
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

      {/* ── Needs attention ─────────────────────────────────────────────── */}
      {hasNeedsAttention && (
        <div className="grid gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">
            Needs attention
          </p>
          <div className="grid gap-3">
            {expiredGroups.map((group) => (
              <ExpiredConnectionGroupCard key={group.connectionId} group={group} />
            ))}
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

              const { pill, copy, showReconnect } = permDisplay(
                acct.brokerConnection?.permissionLevel,
              );
              // connectedAt date shown only after first webhook event arrives.
              const isLive = acct.connectionStatus === "connected_live";
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
                      </div>
                      <p className="text-xs text-stone-500">{copy}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      {showReconnect && acct.brokerConnection && (
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

      {/* ── Unused expired connections ───────────────────────────────────── */}
      {hasOrphaned && (
        <div className="grid gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
            Unused expired connections
          </p>
          <div className="grid gap-2">
            {orphanedExpired.map((bc) => (
              <OrphanedConnectionRow key={bc.id} bc={bc} />
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

    </div>
  );
}
