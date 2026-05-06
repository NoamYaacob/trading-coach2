/** Whether the Advanced diagnostics panel is open by default. */
export const DIAGNOSTICS_DEFAULT_OPEN = false;

export const EVENT_TYPE_LABEL: Record<string, string> = {
  trade_closed: "Trade closed",
  trade_opened: "Trade opened",
  daily_pnl_updated: "P&L update",
};

export const CONNECTION_STATUS_LABEL: Record<string, string> = {
  connected_live: "Connected",
  connected_readonly: "Connected",
  pending_webhook: "Pending sync",
  oauth_pending_storage: "Setting up",
  not_connected: "Not connected",
  expired: "Expired",
  connection_error: "Connection error",
};

export const OUTCOME_LABEL: Record<string, string> = {
  stop: "Stopped",
  cooldown: "Cooldown",
  warning: "Warning",
  skipped: "Skipped",
};

export const RISK_STATE_LABEL: Record<string, string> = {
  NORMAL: "Normal",
  WARNING: "Warning",
  STOPPED: "Stopped",
};

/**
 * Builds the Tradovate webhook URL from the app's base URL.
 * Falls back to the placeholder string when the env var is absent.
 */
export function buildWebhookUrl(baseUrl: string): string {
  return `${baseUrl}/api/tradovate/webhook`;
}

export function mapConnectionStatus(raw: string): string {
  return CONNECTION_STATUS_LABEL[raw] ?? raw.replace(/_/g, " ");
}

export function mapOutcome(raw: string): string {
  return OUTCOME_LABEL[raw] ?? raw.replace(/_/g, " ");
}

export function mapRiskState(raw: string): string {
  return RISK_STATE_LABEL[raw] ?? raw;
}

export function shortDate(date: string | Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(typeof date === "string" ? new Date(date) : date);
}
