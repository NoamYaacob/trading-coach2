import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getCurrentUser } from "@/lib/auth";
import { isAdminEmail } from "@/lib/subscription";
import { prisma } from "@/lib/db";
import { ProbePanel } from "./_components/probe-panel";

export const metadata: Metadata = {
  title: "Broker Account Diagnostics",
  robots: { index: false, follow: false },
};

const STATUS_COLOR: Record<string, string> = {
  connected_live: "text-emerald-700",
  connected_readonly: "text-sky-700",
  expired: "text-amber-700",
  connection_error: "text-red-700",
  not_connected: "text-stone-500",
  pending_webhook: "text-stone-500",
};

const PSTATUS_COLOR: Record<string, string> = {
  protected: "text-emerald-700",
  monitor_only: "text-sky-700",
  pending_decision: "text-amber-700",
  ignored: "text-stone-400",
  archived: "text-stone-400",
};

function StatusBadge({ status, map }: { status: string; map: Record<string, string> }) {
  const cls = map[status] ?? "text-stone-500";
  return <span className={`font-mono text-xs ${cls}`}>{status}</span>;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-1 border-b border-stone-100 py-1 text-xs last:border-0">
      <span className="text-stone-400">{label}</span>
      <span className="break-all font-mono text-stone-700">{value ?? <em className="text-stone-300">null</em>}</span>
    </div>
  );
}

export default async function BrokerAccountsDiagnosticsPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/login");
  if (!isAdminEmail(currentUser.email)) notFound();

  const [connections, accounts] = await Promise.all([
    prisma.brokerConnection.findMany({
      where: { userId: currentUser.id },
      select: {
        id: true,
        platform: true,
        env: true,
        connectionStatus: true,
        brokerUserId: true,
        tokenExpiresAt: true,
        permissionLevel: true,
        lastRenewedAt: true,
        lastRenewError: true,
        lastReconciliationAt: true,
        lastReconciliationStatus: true,
        lastReconciliationError: true,
        lastReconciledAccountCount: true,
        listenerStatus: true,
        listenerErrorMessage: true,
        errorMessage: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.connectedAccount.findMany({
      where: { userId: currentUser.id },
      select: {
        id: true,
        label: true,
        platform: true,
        externalAccountId: true,
        propFirm: true,
        accountType: true,
        connectionStatus: true,
        protectionStatus: true,
        brokerConnectionId: true,
        brokerUserId: true,
        lastSyncAt: true,
        missingFromBrokerSince: true,
        lastSeenInBrokerAt: true,
        connectedAt: true,
      },
      orderBy: { label: "asc" },
    }),
  ]);

  const accountsByConn = new Map<string | null, typeof accounts>();
  for (const acct of accounts) {
    const key = acct.brokerConnectionId;
    if (!accountsByConn.has(key)) accountsByConn.set(key, []);
    accountsByConn.get(key)!.push(acct);
  }

  const connIds = new Set(connections.map((c) => c.id));
  const orphaned = accounts.filter(
    (a) => a.brokerConnectionId != null && !connIds.has(a.brokerConnectionId),
  );
  const unlinked = accountsByConn.get(null) ?? [];

  const now = new Date();
  const tradovateConnIds = connections
    .filter((c) => c.platform === "tradovate")
    .map((c) => c.id);

  return (
    <AppShell eyebrow="Debug" title="Broker Account Diagnostics" description="Admin-only diagnostic view for broker connections and accounts.">
      <div className="mx-auto grid max-w-4xl gap-6 px-4 py-8 sm:px-6">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-950">
            Broker Account Diagnostics
          </h1>
          <p className="mt-1 text-sm text-stone-500">
            Admin-only. User: <span className="font-mono">{currentUser.email}</span>
            {" · "}
            {connections.length} connection(s) · {accounts.length} account(s)
          </p>
        </div>

        {/* Quick summary */}
        <SectionCard title="Quick summary">
          <div className="grid gap-1">
            <Field label="Total connections" value={String(connections.length)} />
            <Field label="Total accounts" value={String(accounts.length)} />
            <Field
              label="Active Tradovate"
              value={String(
                connections.filter(
                  (c) =>
                    c.platform === "tradovate" &&
                    (c.connectionStatus === "connected_live" || c.connectionStatus === "connected_readonly"),
                ).length,
              )}
            />
            <Field
              label="Expired/error"
              value={String(
                connections.filter(
                  (c) =>
                    c.connectionStatus === "expired" || c.connectionStatus === "connection_error",
                ).length,
              )}
            />
            <Field
              label="pending_decision accounts"
              value={String(accounts.filter((a) => a.protectionStatus === "pending_decision").length)}
            />
            <Field
              label="Missing from broker"
              value={String(accounts.filter((a) => a.missingFromBrokerSince != null).length)}
            />
          </div>
        </SectionCard>

        {/* Per-connection cards */}
        {connections.map((conn) => {
          const linked = accountsByConn.get(conn.id) ?? [];
          const tokenExpired =
            conn.tokenExpiresAt != null && conn.tokenExpiresAt < now;
          const tokenSoonExpires =
            !tokenExpired &&
            conn.tokenExpiresAt != null &&
            conn.tokenExpiresAt.getTime() - now.getTime() < 30 * 60 * 1000;

          return (
            <SectionCard
              key={conn.id}
              title={`${conn.platform.toUpperCase()} · ${conn.env} · ${conn.id.slice(0, 12)}…`}
              description={
                <StatusBadge status={conn.connectionStatus} map={STATUS_COLOR} />
              }
            >
              <div className="grid gap-4">
                {/* Connection fields */}
                <div className="grid gap-0">
                  <Field label="id" value={conn.id} />
                  <Field label="platform" value={conn.platform} />
                  <Field label="env" value={conn.env} />
                  <Field label="connectionStatus" value={<StatusBadge status={conn.connectionStatus} map={STATUS_COLOR} />} />
                  <Field label="brokerUserId" value={conn.brokerUserId} />
                  <Field
                    label="tokenExpiresAt"
                    value={
                      conn.tokenExpiresAt == null ? null : (
                        <span className={tokenExpired ? "text-red-600" : tokenSoonExpires ? "text-amber-600" : undefined}>
                          {conn.tokenExpiresAt.toISOString()}
                          {tokenExpired ? " ⚠ EXPIRED" : tokenSoonExpires ? " ⚠ <30 min" : ""}
                        </span>
                      )
                    }
                  />
                  <Field label="permissionLevel" value={conn.permissionLevel} />
                  <Field label="lastRenewedAt" value={conn.lastRenewedAt?.toISOString() ?? null} />
                  <Field label="lastRenewError" value={conn.lastRenewError} />
                  <Field label="listenerStatus" value={conn.listenerStatus} />
                  <Field label="listenerErrorMessage" value={conn.listenerErrorMessage} />
                  <Field label="errorMessage" value={conn.errorMessage} />
                  <Field label="lastReconciliationAt" value={conn.lastReconciliationAt?.toISOString() ?? null} />
                  <Field label="lastReconciliationStatus" value={conn.lastReconciliationStatus} />
                  <Field label="lastReconciliationError" value={conn.lastReconciliationError} />
                  <Field label="lastReconciledAccountCount" value={conn.lastReconciledAccountCount != null ? String(conn.lastReconciledAccountCount) : null} />
                  <Field label="createdAt" value={conn.createdAt.toISOString()} />
                </div>

                {/* Linked accounts */}
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-stone-400">
                    Linked accounts ({linked.length})
                  </p>
                  {linked.length === 0 ? (
                    <p className="text-xs text-stone-400">No linked accounts.</p>
                  ) : (
                    <div className="grid gap-3">
                      {linked.map((acct) => (
                        <div
                          key={acct.id}
                          className="rounded-lg border border-stone-100 bg-stone-50/60 px-3 py-2"
                        >
                          <p className="mb-1 text-xs font-semibold text-stone-800">
                            {acct.label}
                          </p>
                          <div className="grid gap-0">
                            <Field label="id" value={acct.id} />
                            <Field label="externalAccountId" value={acct.externalAccountId} />
                            <Field label="propFirm" value={acct.propFirm} />
                            <Field label="accountType" value={acct.accountType} />
                            <Field label="protectionStatus" value={<StatusBadge status={acct.protectionStatus} map={PSTATUS_COLOR} />} />
                            <Field label="connectionStatus" value={<StatusBadge status={acct.connectionStatus} map={STATUS_COLOR} />} />
                            <Field label="brokerUserId" value={acct.brokerUserId} />
                            <Field label="lastSyncAt" value={acct.lastSyncAt?.toISOString() ?? null} />
                            <Field label="lastSeenInBrokerAt" value={acct.lastSeenInBrokerAt?.toISOString() ?? null} />
                            <Field
                              label="missingFromBrokerSince"
                              value={
                                acct.missingFromBrokerSince ? (
                                  <span className="text-amber-700">{acct.missingFromBrokerSince.toISOString()}</span>
                                ) : null
                              }
                            />
                            <Field label="connectedAt" value={acct.connectedAt?.toISOString() ?? null} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </SectionCard>
          );
        })}

        {/* Orphaned accounts */}
        {orphaned.length > 0 && (
          <SectionCard title={`Orphaned accounts (${orphaned.length})`} description="brokerConnectionId points to a connection not in this user's list">
            {orphaned.map((acct) => (
              <div key={acct.id} className="grid gap-0 border-b border-stone-100 pb-3 pt-2 last:border-0">
                <Field label="label" value={acct.label} />
                <Field label="id" value={acct.id} />
                <Field label="brokerConnectionId" value={acct.brokerConnectionId} />
                <Field label="externalAccountId" value={acct.externalAccountId} />
                <Field label="protectionStatus" value={<StatusBadge status={acct.protectionStatus} map={PSTATUS_COLOR} />} />
                <Field label="missingFromBrokerSince" value={acct.missingFromBrokerSince?.toISOString() ?? null} />
              </div>
            ))}
          </SectionCard>
        )}

        {/* Unlinked accounts */}
        {unlinked.length > 0 && (
          <SectionCard title={`Unlinked accounts (${unlinked.length})`} description="brokerConnectionId is null">
            {unlinked.map((acct) => (
              <div key={acct.id} className="grid gap-0 border-b border-stone-100 pb-3 pt-2 last:border-0">
                <Field label="label" value={acct.label} />
                <Field label="id" value={acct.id} />
                <Field label="externalAccountId" value={acct.externalAccountId} />
                <Field label="protectionStatus" value={<StatusBadge status={acct.protectionStatus} map={PSTATUS_COLOR} />} />
              </div>
            ))}
          </SectionCard>
        )}

        {/* Probe panel — runs sync + calls Tradovate API */}
        <SectionCard
          title="Run sync + probe Tradovate API"
          description={
            <>
              Calls /account/list for each active connection and runs reconciliation.
              {" "}
              <strong>This writes to the DB</strong> (same as "Sync all").
              For a read-only trace per connection, use the individual links below.
            </>
          }
        >
          <ProbePanel connectionIds={tradovateConnIds} />
        </SectionCard>

        {/* Links to existing diagnostic endpoints */}
        <SectionCard title="Other diagnostic endpoints">
          <div className="grid gap-2 text-xs">
            <a href="/api/debug/tradovate-probe" target="_blank" rel="noreferrer"
               className="text-sky-600 underline hover:text-sky-800">
              GET /api/debug/tradovate-probe — permission probe state for all connections
            </a>
            <a href="/api/debug/tradovate-token-diagnostics" target="_blank" rel="noreferrer"
               className="text-sky-600 underline hover:text-sky-800">
              GET /api/debug/tradovate-token-diagnostics — token lifecycle for all connections (admin)
            </a>
            <a href="/api/debug/connected-accounts" target="_blank" rel="noreferrer"
               className="text-sky-600 underline hover:text-sky-800">
              GET /api/debug/connected-accounts — all connected accounts with eligibility flags
            </a>
            {tradovateConnIds.map((id) => (
              <a
                key={id}
                href={`/api/debug/tradovate-discovery?connectionId=${id}`}
                target="_blank"
                rel="noreferrer"
                className="text-sky-600 underline hover:text-sky-800"
              >
                GET /api/debug/tradovate-discovery?connectionId={id} — full dry-run discovery trace
              </a>
            ))}
          </div>
        </SectionCard>

      </div>
    </AppShell>
  );
}
