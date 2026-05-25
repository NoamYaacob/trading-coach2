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
 */
import { cmeHourToLocalHour, SESSION_WINDOW_TIMEZONE } from "@/lib/trading-day";
import { SESSION_WINDOW_COPY } from "../session-window-copy";
import { CmeHourSelect } from "../cme-hour-select";
import { cmeHourBoundaryNote } from "../cme-hour-parsing";
import { RuleStatusBadge } from "../rule-status-badge";
import { Field, SectionCard } from "./field-primitives";

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
    hint: "Saved for future cutoff automation. This action is not active yet.",
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
  /** Customizes the helper text shown under the section title. */
  introHint?: string;
};

export function SessionCutoffSection({
  values,
  update,
  timezone,
  introHint,
}: Props) {
  const hour = intOrNull(values.allowedEndHour);
  const boundary = hour !== null ? cmeHourBoundaryNote(hour) : null;
  const label = tzLabel(timezone);
  const showLocal = label && timezone && timezone !== SESSION_WINDOW_TIMEZONE;
  const localHour = hour !== null && showLocal ? cmeHourToLocalHour(hour, timezone) : null;

  return (
    <SectionCard title="Session cutoff" ariaLabel="Session cutoff">
      <div>
        <p className="flex items-center gap-2 text-sm font-semibold text-stone-950">
          {SESSION_WINDOW_COPY.legend}
          <RuleStatusBadge variant="monitoring-only" />
        </p>
        <p className="mt-1 text-xs text-stone-500">
          {introHint ?? `Override the default daily cutoff for this account. ${SESSION_WINDOW_COPY.helperText}`}
        </p>
      </div>
      <Field
        label={SESSION_WINDOW_COPY.endLabel}
        hint={SESSION_WINDOW_COPY.endHint}
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
      <div>
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-xs font-medium text-stone-600">
            {SESSION_WINDOW_COPY.cutoffBehaviorLabel}
          </p>
          <RuleStatusBadge variant="planned-broker" />
        </div>
        <div className="mt-2 grid gap-2">
          {SESSION_END_BEHAVIOR_OPTIONS.map(({ value, label, hint }) => (
            <label
              key={value}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm"
            >
              <input
                type="radio"
                name="accountSessionEndBehavior"
                value={value}
                checked={values.sessionEndBehavior === value}
                onChange={() => update("sessionEndBehavior", value)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-stone-950"
              />
              <span>
                <span className="font-medium text-stone-950">{label}</span>
                <span className="mt-0.5 block text-stone-500">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
    </SectionCard>
  );
}
