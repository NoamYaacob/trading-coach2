// Pure logic for the simplified Broker Connections page.
// No React or browser dependencies — safe to import in node:test.

export const PAGE_SUBTITLE =
  "Connect Tradovate, check sync status, and reconnect when needed.";

export const CONNECT_TRADOVATE_HREF = "/accounts/connect/tradovate";

export const PLATFORM_LABEL: Record<string, string> = {
  tradovate: "Tradovate",
  tradingview: "TradingView",
  manual: "Manual",
};

export const ENV_LABEL: Record<string, string> = {
  live: "Live",
  demo: "Demo / Sim",
};

export const CONN_STATUS: Record<string, { label: string; cls: string }> = {
  connected_live:        { label: "Connected live",   cls: "bg-emerald-100 text-emerald-700" },
  connected_readonly:    { label: "Limited",          cls: "bg-sky-100 text-sky-700" },
  pending_webhook:       { label: "Pending sync",     cls: "bg-amber-100 text-amber-700" },
  oauth_pending_storage: { label: "Setting up",       cls: "bg-amber-100 text-amber-700" },
  not_connected:         { label: "Not connected",    cls: "bg-stone-100 text-stone-600" },
  expired:               { label: "Expired",          cls: "bg-orange-100 text-orange-700" },
  connection_error:      { label: "Connection error", cls: "bg-red-100 text-red-700" },
};

export function isExpiredStatus(status: string): boolean {
  return status === "expired" || status === "connection_error";
}

export function formatConnectionLabel(platform: string, env: string): string {
  const p = PLATFORM_LABEL[platform] ?? platform;
  const e = ENV_LABEL[env] ?? env;
  return `${p} · ${e}`;
}

export function shortDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
