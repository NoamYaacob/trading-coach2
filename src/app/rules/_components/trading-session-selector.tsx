"use client";

import { SESSION_PRESETS } from "@/lib/rule-edit-eligibility";
import { fmt12h, lockBufferStart12h } from "./trading-session-utils";

export type TradingSessionValues = {
  sessionPresets: string[];
  sessionIsCustom: boolean;
  sessionStartTime: string;
  sessionEndTime: string;
  sessionTimezone: string;
  ruleEditLockBufferMinutes: string;
};

export { fmt12h };

type Props = {
  values: TradingSessionValues;
  onChange: (key: keyof TradingSessionValues, val: TradingSessionValues[keyof TradingSessionValues]) => void;
};

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-[#f97316] font-mono whitespace-nowrap">
        {label}
      </span>
      <div className="flex-1 h-px bg-[#21262d]" />
    </div>
  );
}

export function TradingSessionSelector({ values, onChange }: Props) {
  return (
    <div role="group" aria-label="Trading session" className="space-y-3 pb-6 border-b border-[#21262d]">
      <SectionHeader label="Trading Session" />
      <div>
        <p className="text-xs text-[#8b949e]">
          Select the sessions you normally trade. Guardrail uses these to warn about off-session trades and prevent rule changes during active sessions.
        </p>
        <p className="mt-1 text-xs text-[#6e7781]">
          Times are in Eastern Time (ET). Session hours do not block broker orders yet.
        </p>
      </div>

      {/* Multi-select preset buttons */}
      <div className="flex flex-wrap gap-2">
        {SESSION_PRESETS.map((preset) => {
          const selected = values.sessionPresets.includes(preset.id);
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                const next = selected
                  ? values.sessionPresets.filter((id) => id !== preset.id)
                  : [...values.sessionPresets, preset.id];
                onChange("sessionPresets", next);
                if (next.length > 0) onChange("sessionIsCustom", false);
              }}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
                selected
                  ? "border-[#f97316] bg-[#f97316] text-white"
                  : "border-[#30363d] bg-[#1c2128] text-[#8b949e] hover:border-[#f97316]/60 hover:text-[#e6edf3]"
              }`}
            >
              {preset.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => {
            onChange("sessionIsCustom", !values.sessionIsCustom);
            if (!values.sessionIsCustom) onChange("sessionPresets", []);
          }}
          className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
            values.sessionIsCustom
              ? "border-[#f97316] bg-[#f97316] text-white"
              : "border-[#30363d] bg-[#1c2128] text-[#8b949e] hover:border-[#f97316]/60 hover:text-[#e6edf3]"
          }`}
        >
          Custom
        </button>
      </div>

      {/* Show selected preset times */}
      {values.sessionPresets.length > 0 && (
        <div className="rounded border border-[#30363d] bg-[#161b22] px-3 py-2.5 text-xs text-[#8b949e] space-y-1">
          {SESSION_PRESETS.filter((p) => values.sessionPresets.includes(p.id)).map((preset) => (
            <p key={preset.id}>
              <span className="font-medium text-[#adbac7]">{preset.label}</span>{" – "}
              {fmt12h(preset.sessionStartTime)}–{fmt12h(preset.sessionEndTime)} ET · Locks at{" "}
              <span className="font-medium text-[#adbac7]">{lockBufferStart12h(preset.sessionStartTime, 60)} ET</span>
            </p>
          ))}
        </div>
      )}

      {/* Custom session fields */}
      {values.sessionIsCustom && (
        <div className="grid gap-3">
          <SessionField label="Timezone (IANA, e.g. America/New_York)">
            <input
              type="text"
              value={values.sessionTimezone}
              onChange={(e) => onChange("sessionTimezone", e.target.value)}
              placeholder="America/New_York"
              className="w-full rounded border border-[#30363d] bg-[#161b22] px-3 py-1.5 text-sm text-[#f0f6fc] placeholder:text-[#484f58] focus:border-[#f97316] focus:outline-none"
            />
          </SessionField>
          <div className="grid gap-3 sm:grid-cols-2">
            <SessionField label="Session start (HH:mm)">
              <input
                type="text"
                value={values.sessionStartTime}
                onChange={(e) => onChange("sessionStartTime", e.target.value)}
                placeholder="09:30"
                pattern="\d{1,2}:\d{2}"
                className="w-full rounded border border-[#30363d] bg-[#161b22] px-3 py-1.5 text-sm text-[#f0f6fc] placeholder:text-[#484f58] focus:border-[#f97316] focus:outline-none"
              />
            </SessionField>
            <SessionField label="Session end (HH:mm)">
              <input
                type="text"
                value={values.sessionEndTime}
                onChange={(e) => onChange("sessionEndTime", e.target.value)}
                placeholder="16:00"
                pattern="\d{1,2}:\d{2}"
                className="w-full rounded border border-[#30363d] bg-[#161b22] px-3 py-1.5 text-sm text-[#f0f6fc] placeholder:text-[#484f58] focus:border-[#f97316] focus:outline-none"
              />
            </SessionField>
          </div>
        </div>
      )}

      {/* Rule edit lock buffer — always shown */}
      <div className="max-w-[200px]">
        <SessionField
          label="Rule edit lock buffer (minutes)"
          hint="Minutes before the session starts that rule editing locks. Default: 60."
        >
          <input
            type="number"
            inputMode="numeric"
            step={1}
            value={values.ruleEditLockBufferMinutes}
            onChange={(e) => onChange("ruleEditLockBufferMinutes", e.target.value)}
            placeholder="60"
            className="w-full rounded border border-[#30363d] bg-[#161b22] px-3 py-1.5 text-sm text-[#f0f6fc] placeholder:text-[#484f58] focus:border-[#f97316] focus:outline-none"
          />
        </SessionField>
      </div>
    </div>
  );
}

function SessionField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-[#8b949e]">{label}</span>
      {children}
      {hint && <span className="text-xs text-[#6e7781]">{hint}</span>}
    </label>
  );
}
