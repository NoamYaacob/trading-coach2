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

export function TradingSessionSelector({ values, onChange }: Props) {
  return (
    <div role="group" aria-label="Trading session" className="grid gap-4 rounded-2xl border border-stone-100 bg-stone-50/50 p-5">
      <div>
        <p className="text-sm font-semibold text-stone-950">Trading session</p>
        <p className="mt-1 text-xs text-stone-500">
          Select the sessions you normally trade. Guardrail uses them to detect off-session trades and lock rule editing during active sessions.
        </p>
        <p className="mt-1 text-xs text-stone-400">
          Times are shown in Eastern Time (ET). Guardrail uses sessions for discipline monitoring and rule-edit protection. Broker-level time blocking is not currently available.
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
                  ? "border-stone-950 bg-stone-950 text-stone-50"
                  : "border-stone-200 bg-white text-stone-600 hover:border-stone-400"
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
              ? "border-stone-950 bg-stone-950 text-stone-50"
              : "border-stone-200 bg-white text-stone-600 hover:border-stone-400"
          }`}
        >
          Custom
        </button>
      </div>

      {/* Show selected preset times */}
      {values.sessionPresets.length > 0 && (
        <div className="rounded-xl border border-stone-100 bg-white px-4 py-3 text-xs text-stone-600 space-y-1">
          {SESSION_PRESETS.filter((p) => values.sessionPresets.includes(p.id)).map((preset) => (
            <p key={preset.id}>
              <span className="font-medium">{preset.label}</span>{" – "}
              {fmt12h(preset.sessionStartTime)}–{fmt12h(preset.sessionEndTime)} ET · Locks at{" "}
              <span className="font-medium">{lockBufferStart12h(preset.sessionStartTime, 60)} ET</span>
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
              className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm focus:border-stone-950 focus:outline-none"
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
                className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm focus:border-stone-950 focus:outline-none"
              />
            </SessionField>
            <SessionField label="Session end (HH:mm)">
              <input
                type="text"
                value={values.sessionEndTime}
                onChange={(e) => onChange("sessionEndTime", e.target.value)}
                placeholder="16:00"
                pattern="\d{1,2}:\d{2}"
                className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm focus:border-stone-950 focus:outline-none"
              />
            </SessionField>
          </div>
        </div>
      )}

      {/* Rule edit lock buffer — always shown */}
      <SessionField
        label="Rule edit lock buffer (minutes)"
        hint="How many minutes before the session starts that rule editing locks. Default is 60."
      >
        <input
          type="number"
          inputMode="numeric"
          step={1}
          value={values.ruleEditLockBufferMinutes}
          onChange={(e) => onChange("ruleEditLockBufferMinutes", e.target.value)}
          placeholder="60"
          className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm focus:border-stone-950 focus:outline-none"
        />
      </SessionField>
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
      <span className="text-xs font-medium text-stone-600">{label}</span>
      {children}
      {hint && <span className="text-xs text-stone-400">{hint}</span>}
    </label>
  );
}
