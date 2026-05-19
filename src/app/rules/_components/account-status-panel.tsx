import type { EnforcementModeInfo } from "./enforcement-mode";

type LiveState = {
  riskState: string | null;
  cooldownActive: boolean | null;
  tradesCount: number | null;
  sessionDate: string | null;
  dailyPnl: { toString(): string } | null;
  consecutiveLosses: number | null;
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

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-[#f97316] font-mono whitespace-nowrap">
        {label}
      </span>
      <div className="flex-1 h-px bg-[#21262d]" />
    </div>
  );
}

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
        <div>
          <SectionHeader label="Enforcement" />
          <div
            className={`rounded px-2.5 py-2 text-[11px] font-medium border ${
              enforcementInfo.mode === "broker_enforcement_pending"
                ? "border-emerald-700 bg-emerald-900/30 text-emerald-400"
                : "border-[#30363d] bg-[#21262d] text-[#8b949e]"
            }`}
          >
            {enforcementInfo.label}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-[#8b949e]">{enforcementInfo.detail}</p>
        </div>
        <div>
          <SectionHeader label="Account status" />
          <p className="text-[11px] text-[#6e7781]">
            Select an individual account in the sidebar to see its live session state and lock status.
          </p>
        </div>
        <div>
          <SectionHeader label="About risk settings" />
          <RiskSettingsBlurb />
        </div>
      </div>
    );
  }

  const riskState = liveState?.riskState ?? null;
  const tradesCount = liveState?.tradesCount ?? null;
  const cooldownActive = liveState?.cooldownActive ?? false;
  const dailyPnl = liveState?.dailyPnl ?? null;
  const consecutiveLosses = liveState?.consecutiveLosses ?? null;
  const isLocked = riskState === "STOPPED" || cooldownActive || hasAlreadyTradedToday;

  const pnlNum = dailyPnl !== null ? Number(dailyPnl.toString()) : null;
  const pnlFormatted =
    pnlNum !== null
      ? `$${Math.abs(pnlNum).toFixed(2)}${pnlNum < 0 ? " (loss)" : ""}`
      : "—";
  const pnlColor =
    pnlNum === null
      ? "text-[#adbac7]"
      : pnlNum > 0
      ? "text-[#3fb950]"
      : pnlNum < 0
      ? "text-[#f85149]"
      : "text-[#adbac7]";

  const env = account.brokerConnection?.env ?? null;
  const permissions = account.brokerConnection?.permissionLevel ?? null;
  const permColor =
    permissions === "full_access" ? "text-[#3fb950]" : "text-[#adbac7]";

  return (
    <div className="grid gap-5">
      {/* Account identity */}
      <div>
        <SectionHeader label="Account" />
        <div className="grid gap-1.5">
          <StatusRow label="Label" value={account.label} />
          {env && (
            <StatusRow
              label="Env"
              value={env === "live" ? "Live" : env === "demo" ? "Demo / Sim" : env}
              valueColor={env === "live" ? "text-[#d29922]" : "text-[#adbac7]"}
            />
          )}
          {permissions && (
            <StatusRow label="Permissions" value={permissions} valueColor={permColor} />
          )}
        </div>
      </div>

      {/* Live session data */}
      <div>
        <SectionHeader label="Session" />
        <div className="grid gap-1.5">
          <StatusRow
            label="Trades today"
            value={tradesCount !== null ? String(tradesCount) : "—"}
          />
          <StatusRow
            label="Daily P&L"
            value={pnlFormatted}
            valueColor={pnlColor}
          />
          <StatusRow
            label="Risk state"
            value={riskState ?? "—"}
            valueColor={
              riskState === "STOPPED"
                ? "text-[#f85149]"
                : riskState != null
                ? "text-[#3fb950]"
                : undefined
            }
          />
          <StatusRow
            label="Consecutive losses"
            value={consecutiveLosses !== null ? String(consecutiveLosses) : "—"}
            valueColor={
              consecutiveLosses !== null && consecutiveLosses > 0
                ? "text-[#d29922]"
                : undefined
            }
          />
          {cooldownActive && (
            <StatusRow label="Cooldown" value="Active" valueColor="text-[#d29922]" />
          )}
          <StatusRow
            label="Rules locked"
            value={isLocked ? "YES" : "NO"}
            valueColor={isLocked ? "text-[#f85149]" : "text-[#3fb950]"}
          />
          {hasAlreadyTradedToday && (
            <p className="mt-1 text-[11px] leading-snug text-[#d29922]">
              Session has trades — rules locked until session resets.
            </p>
          )}
        </div>
      </div>

      {/* Enforcement sections */}
      <div>
        <SectionHeader label="Broker-Backed" />
        <div className="grid gap-1.5">
          <p className="text-[11px] text-[#8b949e] leading-relaxed">
            <span className="font-medium text-[#adbac7]">Daily loss</span> — eligible for Tradovate
            broker enforcement when Full Access permission is granted.
          </p>
        </div>
      </div>

      <div>
        <SectionHeader label="Guardrail Monitored" />
        <div className="grid gap-1.5">
          <p className="text-[11px] text-[#6e7781] leading-relaxed">
            Profit target, max trades, position size, and session cutoff are monitored in Guardrail
            and trigger in-app locks and alerts only.
          </p>
        </div>
      </div>

      <div>
        <SectionHeader label="Enforcement" />
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
      </div>
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
