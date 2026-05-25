/**
 * Session cutoff section card for the account Trading Plan form.
 *
 * Fields:
 *   - Stop trading at CME hour    — Monitoring only (warning trigger only;
 *     no Tradovate API exists for time-window restrictions).
 *   - Let open trade finish, then lock     — Planned · not active.
 *   - Close open positions at cutoff       — Planned · not active.
 *
 * Both cutoff behavior radios are stored on the rule record so user intent is
 * captured for the day the scheduler ships. Saving them today has no effect
 * on lock behavior — copy must reflect that.
 *
 * Long per-option hints live behind individual "Learn more" disclosures so
 * the card stays compact at a glance.
 */
import { cmeHourToLocalHour, SESSION_WINDOW_TIMEZONE } from "@/lib/trading-day";
import { SESSION_WINDOW_COPY } from "../session-window-copy";
import { CmeHourSelect } from "../cme-hour-select";
import { cmeHourBoundaryNote } from "../cme-hour-parsing";
import { RuleStatusBadge } from "../rule-status-badge";
import { Field } from "./field-primitives";

const TZ_CITY: Record<string, string> = {
  "Asia/Jerusalem": "Israel",
  "America/New_York": "New York",
  "America/Chicago": "Chicago",
  "America/Los_Angeles": "Los Angeles",
  "Europe/London": "London",
  "Europe/Berlin": "Berlin",
  "Asia/Bangkok": "Bangkok",
  "Asia/Tokyo": "Tokyo",
  "Australia/Sydney": "Sydney",
};

function tzLabel(tz: string | null | undefined): string | null {
  if (!tz) return null;
  const city = TZ_CITY[tz];
  return city ? `${city} time` : null;
}

function intOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

export const SESSION_END_BEHAVIOR_OPTIONS = [
  {
    value: "wait_for_exit_then_lock",
    label: "Let open trade finish, then lock",
    hint: "Saved in Guardrail. Automatic cutoff scheduling is not active yet. When enabled, Guardrail will wait for the open position to close, then mark the account stopped for the rest of the day.",
  },
  {
    value: "flatten_at_session_end",
    label: "Close open positions at cutoff, then lock",
    hint: "Saved for future cutoff automation. This action is not active yet. When enabled, Guardrail will close all open positions at the cutoff hour, then lock the account for the rest of the day.",
  },
] as const;

export type SessionCutoffValues = {
  allowedEndHour: string;
  sessionEndBehavior: string;
};

type Props = {
  values: SessionCutoffValues;
  update: <K extends keyof SessionCutoffValues>(
    key: K,
    value: SessionCutoffValues[K],
  ) => void;
  timezone?: string | null;
};

export function SessionCutoffSection({
  values,
  update,
  timezone,
}: Props) {
  const hour = intOrNull(values.allowedEndHour);
  const boundary = hour !== null ? cmeHourBoundaryNote(hour) : null;
  const label = tzLabel(timezone);
  const showLocal = label && timezone && timezone !== SESSION_WINDOW_TIMEZONE;
  const localHour = hour !== null && showLocal ? cmeHourToLocalHour(hour, timezone) : null;

  return (
    <details
      className="group rounded-2xl border border-stone-200 bg-white/70 px-3 py-2.5 sm:px-4 sm:py-3"
      aria-label="Session cutoff"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-stone-700">
        <span className="flex items-center gap-2">
          Session cutoff
          <RuleStatusBadge variant="monitoring-only" compact />
        </span>
        <span aria-hidden className="text-stone-400 transition-transform group-open:rotate-45">
          +
        </span>
      </summary>
      <div className="mt-3 grid gap-2.5">
      <Field
        label={SESSION_WINDOW_COPY.endLabel}
        hint="Saved — cutoff scheduling is not automated yet."
        details={SESSION_WINDOW_COPY.endHint}
      >
        <CmeHourSelect
          value={values.allowedEndHour}
          onChange={(v) => update("allowedEndHour", v)}
          ariaLabel={SESSION_WINDOW_COPY.endLabel}
        />
      </Field>
      {(boundary || localHour !== null) && (
        <div className="grid gap-1 text-xs text-stone-500">
          {boundary && <p className="text-stone-600">{boundary}</p>}
          {localHour !== null && (
            <p className="text-stone-400">
              {SESSION_WINDOW_COPY.localPreviewPrefix}{" "}
              {String(localHour).padStart(2, "0")}:00 {label}
            </p>
          )}
        </div>
      )}
      <div className="grid gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-xs font-medium text-stone-600">
            {SESSION_WINDOW_COPY.cutoffBehaviorLabel}
          </p>
          <RuleStatusBadge variant="planned-broker" compact />
        </div>
        <div className="grid gap-2">
          {SESSION_END_BEHAVIOR_OPTIONS.map(({ value, label, hint }) => (
            <div
              key={value}
              className="rounded-xl border border-stone-200 bg-white px-4 py-2.5"
            >
              <label className="flex cursor-pointer items-center gap-3 text-sm">
                <input
                  type="radio"
                  name="accountSessionEndBehavior"
                  value={value}
                  checked={values.sessionEndBehavior === value}
                  onChange={() => update("sessionEndBehavior", value)}
                  className="h-4 w-4 shrink-0 accent-stone-950"
                />
                <span className="font-medium text-stone-950">{label}</span>
              </label>
              <details className="group ml-7 mt-1 text-xs text-stone-400">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1 hover:text-stone-600">
                  <span className="text-[10px]">Learn more</span>
                  <span aria-hidden className="text-[10px] transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-1 text-stone-500">{hint}</p>
              </details>
            </div>
          ))}
        </div>
      </div>
      </div>
    </details>
  );
}
