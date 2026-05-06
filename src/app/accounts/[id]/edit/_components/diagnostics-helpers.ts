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

export function mapConnectionStatus(raw: string): string {
  return CONNECTION_STATUS_LABEL[raw] ?? raw.replace(/_/g, " ");
}

export function mapOutcome(raw: string): string {
  return OUTCOME_LABEL[raw] ?? raw.replace(/_/g, " ");
}

export function mapRiskState(raw: string): string {
  return RISK_STATE_LABEL[raw] ?? raw;
}
