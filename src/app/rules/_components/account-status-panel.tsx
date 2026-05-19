import type { EnforcementModeInfo } from "./enforcement-mode";

type LiveState = {
  riskState: string | null;
  cooldownActive: boolean | null;
  tradesCount: number | null;
  sessionDate: string | null;
} | null;

type StatusAccount = {
  label: string;
  connectionStatus: string;
  brokerConnection: {
    env: string;
    connectionStatus: string;
    permissionLevel: string | null;
  } | null;
} | null;

type Props = {
  account: StatusAccount;
  liveState: LiveState;
  hasAlreadyTradedToday: boolean;
  enforcementInfo: EnforcementModeInfo;
  isDefaultScope: boolean;
};

export function AccountStatusPanel({
  account,
  liveState,
  hasAlreadyTradedToday,
  enforcementInfo,
  isDefaultScope,
}: Props) {
  if (isDefaultScope || !account) {
    return (
      <div className="grid gap-5">
        <PanelSection label="Enforcement">
          <div
            className={`rounded px-2.5 py-2 text-[11px] font-medium border ${
              enforcementInfo.mode === "broker_enforcement_pending"
                ? "border-emerald-700 bg-emerald-900/30 text-emerald-400"
                : "border-[#30363d] bg-[#21262d] text-[#8b949e]"
            }`}
          >
            {enforcementInfo.label}
          </div>
          <p className="text-[11px] leading-relaxed text-[#8b949e]">{enforcementInfo.detail}</p>
        </PanelSection>
        <PanelSection label="Account status">
          <p className="text-[11px] text-[#6e7781]">
            Select an individual account in the sidebar to see its live session state and lock status.
          </p>
        </PanelSection>
        <PanelSection label="About risk settings">
          <RiskSettingsBlurb />
        </PanelSection>
      </div>
    );
  }

  const riskState = liveState?.riskState ?? null;
  const tradesCount = liveState?.tradesCount ?? null;
  const cooldownActive = liveState?.cooldownActive ?? false;
  const isLocked = riskState === "STOPPED" || cooldownActive || hasAlreadyTradedToday;

  return (
    <div className="grid gap-5">
      <PanelSection label="Session state">
        <StatusRow label="Trades today" value={tradesCount !== null ? String(tradesCount) : "—"} />
        <StatusRow
          label="Risk state"
          value={riskState ?? "—"}
          valueColor={riskState === "STOPPED" ? "text-red-400" : riskState != null ? "text-[#3fb950]" : undefined}
        />
        {cooldownActive && (
          <StatusRow label="Cooldown" value="Active" valueColor="text-amber-400" />
        )}
        <StatusRow
          label="Rules locked"
          value={isLocked ? "Yes" : "No"}
          valueColor={isLocked ? "text-red-400" : "text-[#3fb950]"}
        />
        {hasAlreadyTradedToday && (
          <p className="mt-1 text-[11px] leading-snug text-amber-400">
            Session has trades — rules locked until session resets.
          </p>
        )}
      </PanelSection>

      <PanelSection label="Connection">
        <StatusRow label="Status" value={account.connectionStatus} />
        <StatusRow label="Environment" value={account.brokerConnection?.env ?? "—"} />
        <StatusRow
          label="Permissions"
          value={account.brokerConnection?.permissionLevel ?? "—"}
          valueColor={
            account.brokerConnection?.permissionLevel === "full_access"
              ? "text-[#3fb950]"
              : undefined
          }
        />
      </PanelSection>

      <PanelSection label="Enforcement">
        <div
          className={`rounded px-2.5 py-2 text-[11px] font-medium border ${
            enforcementInfo.mode === "broker_enforcement_pending"
              ? "border-emerald-700 bg-emerald-900/30 text-emerald-400"
              : "border-[#30363d] bg-[#21262d] text-[#8b949e]"
          }`}
        >
          {enforcementInfo.label}
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-[#8b949e]">{enforcementInfo.detail}</p>
      </PanelSection>

      <PanelSection label="About risk settings">
        <RiskSettingsBlurb />
      </PanelSection>
    </div>
  );
}

function PanelSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#f97316]">{label}</p>
      {children}
    </div>
  );
}

function StatusRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-[#6e7781]">{label}</span>
      <span className={`font-mono text-[11px] font-medium ${valueColor ?? "text-[#adbac7]"}`}>
        {value}
      </span>
    </div>
  );
}

function RiskSettingsBlurb() {
  return (
    <div className="grid gap-2">
      <p className="text-[11px] leading-relaxed text-[#8b949e]">
        <span className="font-semibold text-[#adbac7]">Daily loss</span> — eligible for Tradovate
        broker enforcement when Full Access permission is granted.
      </p>
      <p className="text-[11px] leading-relaxed text-[#8b949e]">
        All other limits (profit target, trade count, session cutoff) are monitored by Guardrail
        and trigger in-app locks and alerts only.
      </p>
    </div>
  );
}
