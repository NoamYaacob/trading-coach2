import Link from "next/link";
import { SyncButton } from "./sync-button";
import {
  CONN_STATUS,
  formatConnectionLabel,
  isExpiredStatus,
  shortDate,
} from "./connection-card-logic";

export type AccountForCard = {
  id: string;
  label: string;
  lastSyncAt: Date | null;
};

export type ConnectionForCard = {
  id: string;
  platform: string;
  env: string;
  connectionStatus: string;
  accounts: AccountForCard[];
};

function StatusChip({ label, cls }: { label: string; cls: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${cls}`}
    >
      {label}
    </span>
  );
}

export function ConnectionCard({ connection }: { connection: ConnectionForCard }) {
  const { id, platform, env, connectionStatus, accounts } = connection;
  const isExpired = isExpiredStatus(connectionStatus);
  const connStatus = CONN_STATUS[connectionStatus] ?? {
    label: connectionStatus.replace(/_/g, " "),
    cls: "bg-stone-100 text-stone-600",
  };

  const lastSyncAt = accounts.reduce<Date | null>((latest, a) => {
    if (!a.lastSyncAt) return latest;
    return !latest || a.lastSyncAt > latest ? a.lastSyncAt : latest;
  }, null);

  return (
    <div className="rounded-2xl border border-stone-200 bg-white px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-stone-950">
              {formatConnectionLabel(platform, env)}
            </h3>
            <StatusChip label={connStatus.label} cls={connStatus.cls} />
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-stone-500">
            <span>
              {accounts.length} account{accounts.length === 1 ? "" : "s"}
            </span>
            {lastSyncAt && <span>Last sync {shortDate(lastSyncAt)}</span>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isExpired ? (
            <Link
              href={`/accounts/connect/tradovate?env=${env}&reconnect=${id}`}
              className="inline-flex items-center rounded-full border border-red-300 px-3.5 py-1.5 text-xs font-medium text-red-700 transition hover:border-red-500"
            >
              Reconnect
            </Link>
          ) : (
            <SyncButton connectionId={id} lastSyncAt={lastSyncAt} />
          )}
          <Link
            href="/dashboard"
            className="inline-flex items-center rounded-full border border-stone-200 px-3.5 py-1.5 text-xs font-medium text-stone-600 transition hover:border-stone-400 hover:text-stone-950"
          >
            View accounts
          </Link>
        </div>
      </div>

      {accounts.length === 0 && (
        <p className="mt-3 text-sm text-stone-500">
          No accounts found on this connection.{" "}
          {!isExpired && (
            <Link
              href={`/accounts/connect/tradovate?env=${env}&reconnect=${id}`}
              className="font-medium text-stone-950 underline-offset-2 hover:underline"
            >
              Re-run setup
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
