"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cmeHourToLocalHour, SESSION_WINDOW_TIMEZONE } from "@/lib/trading-day";
import { SESSION_WINDOW_COPY } from "./session-window-copy";
import { MAX_POSITION_SIZE_COPY } from "./position-size-copy";
import { MaxPositionSizeConversionTable } from "./max-position-size-conversion-table";
import { AUTOMATED_ACTIONS_CONSENT_TEXT } from "@/lib/brokers/automated-actions-consent";
import {
  computeAccountRulesBanner,
  computeAccountSaveButtonState,
  computePendingFieldRowsWithSource,
  computeShowPendingPanel,
  REVIEW_INHERITED_HINT,
  type PendingDiffBaseline,
  type PendingFieldActiveSource,
} from "./account-rules-form-logic";
import { validateRules, effectiveValue } from "./rule-validation";
import { TradingSessionSelector, type TradingSessionValues } from "./trading-session-selector";
import { fmt12h } from "./trading-session-utils";
import { SESSION_PRESETS } from "@/lib/rule-edit-eligibility";
import { CmeHourSelect } from "./cme-hour-select";
import { cmeHourBoundaryNote } from "./cme-hour-parsing";
import { ApplyPendingButton } from "./apply-pending-button";

export type DefaultRuleValues = {
  maxDailyLoss: string;
  riskPerTrade: string;
  maxTradesPerDay: string;
  stopAfterLosses: string;
  allowedEndHour: string;
  maxContracts?: string;
};

export type AccountRulesValues = {
  maxDailyLoss: string;
  riskPerTrade: string;
  maxTradesPerDay: string;
  stopAfterLosses: string;
  allowedEndHour: string;
  sessionEndBehavior: string;
  sessionPresets: string[];
  sessionIsCustom: boolean;
  sessionStartTime: string;
  sessionEndTime: string;
  sessionTimezone: string;
  ruleEditLockBufferMinutes: string;
  maxContracts: string;
  /** When true, Guardrail writes a global raw contract cap to Tradovate.
   *  WARNING: counts all contracts equally (2 MNQ blocked with max=1). Default: false. */
  rawBrokerHardLimitEnabled: boolean;
  // TODO: Move propFirm fields to Account setup / details page — not Trading Plan rules.
};

type Props = {
  accountId: string;
  accountLabel: string;
  hasExistingRules: boolean;
  /** True when the saved rule record has a valid (current-version) automated-
   *  actions consent. When false, the consent checkbox is shown and required
   *  to submit — broker-side enforcement will not fire without it. */
  hasValidConsent: boolean;
  initial: AccountRulesValues;
  isLocked: boolean;
  /** Human-readable message explaining the current lock reason (session-aware). */
  lockMessage?: string | null;
  hasDefaultRules: boolean;
  timezone?: string | null;
  defaultValues?: DefaultRuleValues;
  /** Pending payload stored for this account (not yet applied). */
  pendingPayload?: Record<string, unknown> | null;
  pendingEffectiveDate?: string | null;
  /**
   * Parsed pendingPayloadJson from the DEFAULT TEMPLATE RiskRules row.
   * When a field has no account override AND the inherited default active column
   * is also null, but this payload has a value, we show an inline note:
   * "The default template has this value pending (not active yet)."
   * This prevents users from thinking "Not set → X" in the diff means the
   * default was never configured — it means the default's pending hasn't
   * promoted yet.
   */
  defaultPendingPayload?: Record<string, unknown> | null;
  /** True when the server has determined it is safe to promote pending rules
   *  immediately. Shows the "Apply pending now" button in the pending panel. */
  canApplyPendingNow?: boolean;
  /** When canApplyPendingNow is false, the human-readable reason why activation
   *  is blocked (e.g. "Account is in active trading — ..."). Shown as a small
   *  note below the pending diff so the user understands why the button is
   *  absent. Null when the reason is unknown or canApplyPendingNow is true. */
  pendingBlockReason?: string | null;
};

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

function num(v: string): number | null {
  if (!v.trim()) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function int(v: string): number | null {
  if (!v.trim()) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Renders the small badge next to the "Active now" value in the pending diff,
 * so users can tell whether the active value comes from this account's
 * override, the inherited default template, or is genuinely not configured.
 *
 * Pure rendering — accepts the activeSource label produced by the source-aware
 * helper. Returns null for "override" so the most common case stays visually
 * quiet (a tag on every row would be noise); returns visible tags for
 * "inherited" and "not_set" because those are the cases users actually need
 * to disambiguate.
 */
function renderActiveSourceTag(source: PendingFieldActiveSource) {
  if (source === "override") {
    return (
      <span className="rounded-full border border-stone-200 bg-white px-1.5 py-[1px] text-[9px] font-medium uppercase tracking-[0.08em] text-stone-500">
        Override
      </span>
    );
  }
  if (source === "inherited") {
    return (
      <span className="rounded-full border border-sky-200 bg-sky-50 px-1.5 py-[1px] text-[9px] font-medium uppercase tracking-[0.08em] text-sky-700">
        Inherited
      </span>
    );
  }
  return (
    <span className="rounded-full border border-stone-200 bg-stone-50 px-1.5 py-[1px] text-[9px] font-medium uppercase tracking-[0.08em] text-stone-500">
      Not set
    </span>
  );
}

/**
 * Returns a note when the account has no override AND the inherited default
 * active column is null, but the default's pending payload has a value.
 * Signals: "The default will eventually provide this value, but it isn't
 * active yet — that's why the diff shows 'Not set'."
 */
function defaultPendingNote(
  defaultPendingPayload: Record<string, unknown> | null | undefined,
  key: string,
  accountOverrideValue: string,
  defaultActiveValue: string,
): string | null {
  if (!defaultPendingPayload) return null;
  if (accountOverrideValue.trim() !== "") return null;
  if (defaultActiveValue.trim() !== "") return null;
  const v = defaultPendingPayload[key];
  if (v == null) return null;
  return `Default template has ${v} pending — will inherit when default activates.`;
}

function Field({ label, hint, pendingNote, children }: { label: string; hint?: string; pendingNote?: string | null; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-stone-600">{label}</span>
      {children}
      {hint && <span className="text-xs text-stone-400">{hint}</span>}
      {pendingNote && <span className="text-xs font-medium text-amber-600">{pendingNote}</span>}
    </label>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  integer = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  integer?: boolean;
}) {
  return (
    <input
      type="number"
      inputMode={integer ? "numeric" : "decimal"}
      step={integer ? 1 : "any"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm focus:border-stone-950 focus:outline-none"
    />
  );
}

const ACCOUNT_SESSION_END_BEHAVIOR_OPTIONS = [
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

export function AccountRulesForm({
  accountId,
  accountLabel,
  hasExistingRules,
  hasValidConsent,
  initial,
  isLocked,
  lockMessage,
  hasDefaultRules,
  timezone,
  defaultValues,
  pendingPayload,
  pendingEffectiveDate,
  defaultPendingPayload,
  canApplyPendingNow,
  pendingBlockReason,
}: Props) {
  const router = useRouter();
  const [values, setValues] = useState<AccountRulesValues>(initial);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Advanced broker-side contract cap is hidden by default; expand if already enabled.
  const [showAdvancedBrokerCap, setShowAdvancedBrokerCap] = useState(initial.rawBrokerHardLimitEnabled);
  const [showForm, setShowForm] = useState(hasExistingRules);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [localPendingPresets, setLocalPendingPresets] = useState<string[] | null>(() => {
    if (!pendingPayload) return null;
    const j = pendingPayload.sessionPresetsJson;
    if (typeof j === "string") return JSON.parse(j) as string[];
    return null;
  });
  const [localPendingDate, setLocalPendingDate] = useState<string | null>(pendingEffectiveDate ?? null);

  // Warn before unload/refresh when there are unsaved changes.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  function update<K extends keyof AccountRulesValues>(key: K, value: AccountRulesValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
    setSavedAt(null);
  }

  async function sendPatch(body: Record<string, unknown>) {
    const res = await fetch(`/api/accounts/${accountId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as {
      rulesLock?: { applied: boolean; message?: string; effectiveDate?: string };
      error?: string;
    };
    if (!res.ok) throw new Error(data.error ?? "Failed to save.");
    return data;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validateRules({
      maxDailyLoss: effectiveValue(values.maxDailyLoss, defaultValues?.maxDailyLoss),
      riskPerTrade: effectiveValue(values.riskPerTrade, defaultValues?.riskPerTrade),
      maxTradesPerDay: effectiveValue(values.maxTradesPerDay, defaultValues?.maxTradesPerDay),
      stopAfterLosses: effectiveValue(values.stopAfterLosses, defaultValues?.stopAfterLosses),
    });
    if (errs.length > 0) {
      setError(errs[0].message);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const hasPresets = values.sessionPresets.length > 0;
      const data = await sendPatch({
        riskRules: {
          maxDailyLoss: num(values.maxDailyLoss),
          riskPerTrade: num(values.riskPerTrade),
          maxTradesPerDay: int(values.maxTradesPerDay),
          stopAfterLosses: int(values.stopAfterLosses),
          allowedEndHour: int(values.allowedEndHour),
          sessionEndBehavior: values.sessionEndBehavior || null,
          selectedSessionPresets: hasPresets ? values.sessionPresets : (values.sessionIsCustom ? null : []),
          sessionPreset: values.sessionIsCustom ? "custom" : null,
          sessionStartTime: values.sessionIsCustom ? (values.sessionStartTime.trim() || null) : null,
          sessionEndTime: values.sessionIsCustom ? (values.sessionEndTime.trim() || null) : null,
          sessionTimezone: values.sessionIsCustom ? (values.sessionTimezone.trim() || null) : null,
          ruleEditLockBufferMinutes: values.ruleEditLockBufferMinutes ? parseInt(values.ruleEditLockBufferMinutes, 10) || null : null,
          maxContracts: int(values.maxContracts),
          rawBrokerHardLimitEnabled: values.rawBrokerHardLimitEnabled,
        },
        // Stamp consent only on submissions where the user explicitly checked
        // the box. Re-saves of rules on already-consented accounts pass false
        // and leave the existing consent timestamp intact server-side.
        automatedActionsConsentChecked: consentChecked,
      });
      if (data.rulesLock?.applied === false) {
        const pendingPresets = hasPresets ? values.sessionPresets.slice() : (values.sessionIsCustom ? null : []);
        setLocalPendingPresets(pendingPresets);
        setLocalPendingDate(data.rulesLock.effectiveDate ?? null);
        setPendingMessage("Saved as pending — these rules take effect at the next safe window.");
        // Pending save: the DB active fields did NOT change. Roll the form
        // input back to the active baseline so the fields keep showing the
        // currently-active rules. The diff renders active (initial) → pending
        // (server-loaded pendingPayloadJson) correctly because `values` is no
        // longer holding the user's just-submitted edits.
        setValues(initial);
      } else {
        setLocalPendingPresets(null);
        setLocalPendingDate(null);
        setPendingMessage(null);
        setSavedAt(new Date());
      }
      setIsDirty(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setRemoving(true);
    setError(null);
    try {
      const data = await sendPatch({ riskRules: null });
      setIsDirty(false);
      setConfirmingRemove(false);
      if (data.rulesLock?.applied === false && data.rulesLock.message) {
        setPendingMessage(data.rulesLock.message);
      } else {
        setPendingMessage("Account-specific rules removed. This account now uses the default template.");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove.");
    } finally {
      setRemoving(false);
    }
  }

  // No existing rules: show read-only inherited summary + CTA before revealing the form
  if (!showForm) {
    const summaryFields: { label: string; value: string; prefix?: string }[] = [
      { label: "Daily loss limit", value: defaultValues?.maxDailyLoss ?? "", prefix: "$" },
      { label: "Risk per trade", value: defaultValues?.riskPerTrade ?? "", prefix: "$" },
      { label: "Max trades / day", value: defaultValues?.maxTradesPerDay ?? "" },
      { label: "Stop after losses", value: defaultValues?.stopAfterLosses ?? "" },
      { label: "Cutoff time (CME)", value: defaultValues?.allowedEndHour ?? "" },
      { label: MAX_POSITION_SIZE_COPY.label, value: defaultValues?.maxContracts ?? "" },
    ];
    return (
      <div className="grid gap-4">
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-stone-700">
          <p className="font-medium text-stone-800">Inherited from default template</p>
          <p className="mt-0.5">
            {hasDefaultRules
              ? "This account currently inherits the default template. Create an account-specific override to customize rules for this account only."
              : `No default template is set. Saving here will create rules only for ${accountLabel}.`}
          </p>
        </div>

        {hasDefaultRules && defaultValues && (
          <div className="rounded-2xl border border-stone-100 bg-stone-50/50 px-4 py-4">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-stone-400">
              Inherited from default template
            </p>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
              {summaryFields.map(({ label, value, prefix }) => (
                <div key={label}>
                  <dt className="text-xs text-stone-400">{label}</dt>
                  <dd className="mt-0.5 text-sm font-medium text-stone-700">
                    {value ? `${prefix ?? ""}${value}` : <span className="text-stone-300">—</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="inline-flex items-center justify-center self-start rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
        >
          Create account-specific rules
        </button>
      </div>
    );
  }

  const banner = computeAccountRulesBanner(hasExistingRules, isLocked, showForm, lockMessage);

  // Cross-field validation: check the effective values (account override, falling
  // back to inherited default) so we catch invalid combos created by inheritance.
  const validationErrors = validateRules({
    maxDailyLoss: effectiveValue(values.maxDailyLoss, defaultValues?.maxDailyLoss),
    riskPerTrade: effectiveValue(values.riskPerTrade, defaultValues?.riskPerTrade),
    maxTradesPerDay: effectiveValue(values.maxTradesPerDay, defaultValues?.maxTradesPerDay),
    stopAfterLosses: effectiveValue(values.stopAfterLosses, defaultValues?.stopAfterLosses),
  });

  // Build the active → pending diff. The "active" side is split into two
  // inputs — `override` (this account's AccountRiskRules row, the `initial`
  // prop) and `defaultBaseline` (the user's RiskRules mapped via
  // mapDefaultRulesToAccountForm). The pure helper picks override-when-set,
  // inherited-otherwise, and reports the source so each row can be tagged
  // Override / Inherited / Not set in the UI. We never read `values` for
  // this: after a pending save it still holds the user's submitted edit.
  const pendingIsDelete = Boolean(pendingPayload && (pendingPayload as { __delete?: boolean }).__delete);
  const overrideBaseline: PendingDiffBaseline = {
    maxDailyLoss: initial.maxDailyLoss,
    riskPerTrade: initial.riskPerTrade,
    maxTradesPerDay: initial.maxTradesPerDay,
    stopAfterLosses: initial.stopAfterLosses,
    allowedEndHour: initial.allowedEndHour,
    maxContracts: initial.maxContracts,
  };
  const defaultBaseline: PendingDiffBaseline = {
    maxDailyLoss: defaultValues?.maxDailyLoss ?? "",
    riskPerTrade: defaultValues?.riskPerTrade ?? "",
    maxTradesPerDay: defaultValues?.maxTradesPerDay ?? "",
    stopAfterLosses: defaultValues?.stopAfterLosses ?? "",
    allowedEndHour: defaultValues?.allowedEndHour ?? "",
    maxContracts: defaultValues?.maxContracts ?? "",
  };
  const pendingFieldRows = computePendingFieldRowsWithSource({
    override: overrideBaseline,
    defaultBaseline,
    pendingPayload: pendingPayload ?? null,
    pendingIsDelete,
  });
  const showPendingPanel = computeShowPendingPanel({
    pendingFieldRows,
    pendingIsDelete,
    hasPendingPayload: pendingPayload !== null && pendingPayload !== undefined,
    pendingSessionPresets: localPendingPresets,
    activeSessionPresets: initial.sessionPresets,
    isDirty,
  });

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 sm:gap-5">

      {!hasExistingRules && (
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-stone-700">
          <p className="font-medium text-stone-800">Creating account-specific override</p>
          <p className="mt-0.5">
            {hasDefaultRules
              ? `Saving will create rules specific to ${accountLabel} only. The default template will not change.`
              : `No default template is set. Saving here will create rules only for ${accountLabel}.`}
          </p>
        </div>
      )}

      {banner.kind === "first_time" && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-xs text-sky-800">
          {banner.message}
        </div>
      )}

      {banner.kind === "locked" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          {banner.message}
        </div>
      )}

      {/* ── Money limits ──────────────────────────────────────────────────
          Mirrors the default-template form's "Money limits" section so the
          two pages share one mental model. Account size + Daily profit target
          live on the default template only; we surface them as a small inherited
          context block at the top so the section doesn't feel "missing fields". */}
      <div role="group" aria-label="Money limits" className="grid gap-3 rounded-2xl border border-stone-100 bg-stone-50/50 p-3 sm:gap-4 sm:p-5">
        <p className="text-sm font-semibold text-stone-950">Money limits</p>
        {!hasExistingRules && (
          <p className="-mt-1 text-xs text-stone-400">{REVIEW_INHERITED_HINT}</p>
        )}
        {/* Inherited-only fields surfaced so the account form mirrors the
            default template's section structure even though account size and
            daily profit target are configured on the default template only. */}
        {(defaultValues?.maxDailyLoss !== undefined ||
          (defaultValues as { dailyProfitTarget?: string } | undefined)?.dailyProfitTarget !== undefined) && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl border border-stone-100 bg-white px-3 py-2 text-[11px] text-stone-500">
            <div>
              <dt className="text-[10px] uppercase tracking-[0.1em] text-stone-400">Account size</dt>
              <dd className="text-stone-700">
                <span className="rounded-full border border-sky-200 bg-sky-50 px-1.5 py-[1px] text-[9px] font-medium uppercase tracking-[0.08em] text-sky-700">
                  Inherited
                </span>{" "}
                <span className="text-stone-500">configured on default template</span>
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-[0.1em] text-stone-400">Daily profit target</dt>
              <dd className="text-stone-700">
                <span className="rounded-full border border-sky-200 bg-sky-50 px-1.5 py-[1px] text-[9px] font-medium uppercase tracking-[0.08em] text-sky-700">
                  Inherited
                </span>{" "}
                <span className="text-stone-500">configured on default template</span>
              </dd>
            </div>
          </dl>
        )}
        <div className="grid items-start gap-3 sm:grid-cols-2 sm:gap-4">
          <Field label="Daily loss limit ($)">
            <Input value={values.maxDailyLoss} onChange={(v) => update("maxDailyLoss", v)} placeholder="500" />
          </Field>
          <Field label="Risk per trade ($)" hint="Warning only — does not lock the account.">
            <Input value={values.riskPerTrade} onChange={(v) => update("riskPerTrade", v)} placeholder="100" />
          </Field>
        </div>
      </div>

      {/* ── Trading limits ──────────────────────────────────────────────── */}
      <div role="group" aria-label="Trading limits" className="grid gap-3 rounded-2xl border border-stone-100 bg-stone-50/50 p-3 sm:gap-4 sm:p-5">
        <p className="text-sm font-semibold text-stone-950">Trading limits</p>
        <div className="grid items-start gap-3 sm:grid-cols-2 sm:gap-4">
          <Field
            label="Max trades per day"
            pendingNote={defaultPendingNote(defaultPendingPayload, "maxTradesPerDay", initial.maxTradesPerDay, defaultValues?.maxTradesPerDay ?? "")}
          >
            <Input value={values.maxTradesPerDay} onChange={(v) => update("maxTradesPerDay", v)} placeholder="5" integer />
          </Field>
          <Field
            label="Stop after consecutive losses"
            pendingNote={defaultPendingNote(defaultPendingPayload, "stopAfterLosses", initial.stopAfterLosses, defaultValues?.stopAfterLosses ?? "")}
          >
            <Input value={values.stopAfterLosses} onChange={(v) => update("stopAfterLosses", v)} placeholder="3" integer />
          </Field>
          <Field
            label={MAX_POSITION_SIZE_COPY.label}
            hint={MAX_POSITION_SIZE_COPY.hint}
            pendingNote={defaultPendingNote(defaultPendingPayload, "maxContracts", initial.maxContracts, defaultValues?.maxContracts ?? "")}
          >
            <Input value={values.maxContracts} onChange={(v) => update("maxContracts", v)} placeholder="2" integer />
            <MaxPositionSizeConversionTable maxContracts={values.maxContracts} />
            {values.maxContracts.trim() !== "" && !showAdvancedBrokerCap && (
              <button
                type="button"
                className="mt-1 text-xs text-stone-400 underline-offset-2 hover:text-stone-600 hover:underline"
                onClick={() => setShowAdvancedBrokerCap(true)}
              >
                Advanced options
              </button>
            )}
            {values.maxContracts.trim() !== "" && showAdvancedBrokerCap && (
              <div className="mt-1 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs">
                <p className="font-semibold text-amber-900">Advanced broker-side contract cap</p>
                <p className="mt-1 text-amber-800">
                  Enables a broker-side contract cap on your Tradovate account (immediate reject before
                  execution). Tradovate counts all contracts equally — 2&nbsp;MNQ counts as 2 contracts,
                  even though it is well within a 1-standard-equivalent limit. Use only if you want
                  Tradovate to enforce a raw contract count.
                </p>
                <label className="mt-2 flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                    checked={values.rawBrokerHardLimitEnabled}
                    onChange={(e) => update("rawBrokerHardLimitEnabled", e.target.checked)}
                  />
                  <span className="text-amber-900">
                    Enable broker-side contract cap (applies to all contracts equally)
                  </span>
                </label>
              </div>
            )}
          </Field>
        </div>
      </div>

      {/* ── Daily cutoff (CME) ──────────────────────────────────────────────
          Cutoff behavior radios live INSIDE this section to match the default
          template form (where they're nested under "Daily cutoff" rather than
          floating in their own card). */}
      <div role="group" aria-label="Daily cutoff" className="grid gap-3 rounded-2xl border border-stone-100 bg-stone-50/50 p-3 sm:gap-4 sm:p-5">
        <div>
          <p className="text-sm font-semibold text-stone-950">{SESSION_WINDOW_COPY.legend}</p>
          <p className="mt-1 text-xs text-stone-500">
            Override the default daily cutoff for this account. {SESSION_WINDOW_COPY.helperText}
          </p>
        </div>
        <Field label={SESSION_WINDOW_COPY.endLabel} hint={SESSION_WINDOW_COPY.endHint}>
          <CmeHourSelect
            value={values.allowedEndHour}
            onChange={(v) => update("allowedEndHour", v)}
            ariaLabel={SESSION_WINDOW_COPY.endLabel}
          />
        </Field>
        {(() => {
          const e = int(values.allowedEndHour);
          if (e === null) return null;
          const boundary = cmeHourBoundaryNote(e);
          const label = tzLabel(timezone);
          const showLocal = label && timezone && timezone !== SESSION_WINDOW_TIMEZONE;
          const le = showLocal ? cmeHourToLocalHour(e, timezone) : null;
          if (!boundary && le === null) return null;
          return (
            <div className="grid gap-1 text-xs text-stone-500">
              {boundary && <p className="text-stone-600">{boundary}</p>}
              {le !== null && (
                <p className="text-stone-400">
                  {SESSION_WINDOW_COPY.localPreviewPrefix}{" "}
                  {String(le).padStart(2, "0")}:00 {label}
                </p>
              )}
            </div>
          );
        })()}
        <div>
          <p className="text-xs font-medium text-stone-600">{SESSION_WINDOW_COPY.cutoffBehaviorLabel}</p>
          <div className="mt-2 grid gap-2">
            {ACCOUNT_SESSION_END_BEHAVIOR_OPTIONS.map(({ value, label, hint }) => (
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
      </div>

      {/* ── Notifications (inherited) ───────────────────────────────────────
          Default-only field surfaced as a card so the account form mirrors
          the default template's section list. The on-page UX is read-only:
          breach alerts are configured on the default template. */}
      <div role="group" aria-label="Notifications" className="grid gap-3 rounded-2xl border border-stone-100 bg-stone-50/50 p-3 sm:gap-4 sm:p-5">
        <p className="text-sm font-semibold text-stone-950">Notifications</p>
        <div className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-xs text-stone-600">
          <span className="rounded-full border border-sky-200 bg-sky-50 px-1.5 py-[1px] text-[9px] font-medium uppercase tracking-[0.08em] text-sky-700">
            Inherited
          </span>{" "}
          Breach alerts are configured on the default template and apply to every account.
        </div>
      </div>

      <TradingSessionSelector
        values={{
          sessionPresets: values.sessionPresets,
          sessionIsCustom: values.sessionIsCustom,
          sessionStartTime: values.sessionStartTime,
          sessionEndTime: values.sessionEndTime,
          sessionTimezone: values.sessionTimezone,
          ruleEditLockBufferMinutes: values.ruleEditLockBufferMinutes,
        }}
        onChange={(key, val) => update(key as keyof AccountRulesValues, val as AccountRulesValues[keyof AccountRulesValues])}
      />

      {/* Active vs pending guidance — sits ABOVE the pending panel so users
          read it before scanning the diff. Hidden when no pending data. */}
      {showPendingPanel && !pendingIsDelete && (
        <p className="text-[11px] text-stone-500">
          Form fields show active rules. Pending changes are listed below and will apply at the next safe window.
        </p>
      )}

      {/* Pending changes panel — server-driven via pendingPayload prop; survives navigation */}
      {showPendingPanel && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 space-y-3">
          <div>
            <p className="font-medium">Pending changes saved</p>
            <p className="mt-0.5 text-[11px] text-amber-800">
              {canApplyPendingNow
                ? "Ready to apply now — broker connection is not live or account is in a safe window."
                : `Changes will activate automatically at the next safe window${localPendingDate ? ` (${localPendingDate})` : ""}.`}
            </p>
            {canApplyPendingNow ? (
              <ApplyPendingButton url={`/api/accounts/${accountId}/apply-pending`} />
            ) : pendingBlockReason ? (
              <p className="mt-1 text-[11px] text-amber-700">Cannot apply yet: {pendingBlockReason}</p>
            ) : null}
          </div>
          {pendingIsDelete ? (
            <p className="text-[11px] text-amber-800">
              Account-specific rules are scheduled for removal. This account will revert to the default template at the next safe window.
            </p>
          ) : pendingFieldRows.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-amber-100 bg-white">
              <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)] gap-x-3 border-b border-amber-100 bg-amber-50/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-amber-700">
                <span>Rule</span>
                <span>Active now</span>
                <span>Pending next</span>
                <span>Source</span>
              </div>
              {pendingFieldRows.map(({ label, active, pending, activeSource }) => (
                <div
                  key={label}
                  className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)] items-baseline gap-x-3 border-t border-amber-50 px-3 py-1.5 first:border-t-0 text-[12px] text-amber-900"
                >
                  <span className="font-medium">{label}</span>
                  <span className="text-amber-800">{active}</span>
                  <span className="font-semibold text-amber-900">{pending}</span>
                  <span>{renderActiveSourceTag(activeSource)}</span>
                </div>
              ))}
              {pendingFieldRows.some((r) => r.activeSource === "not_set") && (
                <p className="border-t border-amber-50 bg-amber-50/40 px-3 py-1.5 text-[10px] italic text-amber-700">
                  &quot;Not set&quot; means neither the account override nor the default template has a value configured for this rule.
                </p>
              )}
            </div>
          ) : null}
          {/* Session diff: "active now" reads from `initial` (the DB active baseline),
              never from `values` (which holds the user's edited input post-save). */}
          {localPendingPresets !== null &&
            [...localPendingPresets].sort().join(",") !== [...initial.sessionPresets].sort().join(",") && (
            <div className={`grid gap-1${pendingFieldRows.length > 0 ? " border-t border-amber-100 pt-2" : ""}`}>
              <p className="text-[11px] text-amber-800">
                <span className="font-medium">Trading session — active now: </span>
                {initial.sessionPresets.length > 0
                  ? SESSION_PRESETS.filter((p) => initial.sessionPresets.includes(p.id))
                      .map((p) => `${p.label} (${fmt12h(p.sessionStartTime)}–${fmt12h(p.sessionEndTime)} ET)`)
                      .join(", ")
                  : initial.sessionIsCustom
                  ? "Custom session"
                  : "None"}
              </p>
              <p className="text-[11px] text-amber-800">
                <span className="font-medium">Trading session — pending next: </span>
                {localPendingPresets.length > 0
                  ? SESSION_PRESETS.filter((p) => localPendingPresets.includes(p.id))
                      .map((p) => `${p.label} (${fmt12h(p.sessionStartTime)}–${fmt12h(p.sessionEndTime)} ET)`)
                      .join(", ")
                  : "None (presets cleared)"}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Submit row */}
      <div className="grid gap-3 border-t border-stone-100 pt-4 sm:pt-6">
        <p className="text-[11px] text-stone-500">
          Rules are saved in Guardrail. Daily loss can trigger broker risk settings on breach. Profit targets are monitored in Guardrail.
        </p>

        {/* Automated-actions consent — required before broker writes can fire.
            Shown whenever consent is missing or its version is outdated. */}
        {!hasValidConsent && (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-stone-300 accent-stone-950"
            />
            <span>
              {AUTOMATED_ACTIONS_CONSENT_TEXT}
            </span>
          </label>
        )}

        {/* Cross-field validation errors — block save when present */}
        {validationErrors.length > 0 && (
          <ul className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">
            {validationErrors.map((e) => (
              <li key={`${e.field}:${e.message}`}>{e.message}</li>
            ))}
          </ul>
        )}

        {/* Primary save row */}
        <div className="flex flex-wrap items-center gap-3">
          {(() => {
            const saveBtn = computeAccountSaveButtonState({
              isDirty,
              saving,
              removing,
              hasExistingRules,
              hasValidConsent,
              consentChecked,
              savedAt,
              pendingMessage,
              hasValidationErrors: validationErrors.length > 0,
            });
            return (
              <button
                type="submit"
                disabled={saveBtn.disabled}
                className="inline-flex items-center justify-center whitespace-nowrap rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
              >
                {saveBtn.label}
              </button>
            );
          })()}
          {isDirty && !saving && (
            <span className="text-xs text-amber-600">Unsaved changes</span>
          )}
          {!isDirty && !saving && hasExistingRules && !savedAt && !error && (
            <span className="text-xs text-stone-400">No changes to save.</span>
          )}
          {savedAt && !pendingMessage && !isDirty && (
            <span className="text-xs text-emerald-700">
              Saved in Guardrail.
            </span>
          )}
          {pendingMessage && (
            <span className="text-xs text-amber-700">
              Saved as pending — these rules will activate at the next safe window.
            </span>
          )}
          {error && <span className="text-xs text-red-700">{error}</span>}
        </div>

        {/* Remove override — only for accounts with existing rules */}
        {hasExistingRules && (
          <div className="border-t border-stone-100 pt-3">
            {confirmingRemove ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <p className="text-sm font-medium text-red-900">Remove account-specific rules for {accountLabel}?</p>
                <p className="mt-1 text-xs text-red-800">
                  This account will return to using the default template. Other accounts are not affected.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleRemove}
                    disabled={removing}
                    className="inline-flex items-center justify-center rounded-full bg-red-700 px-4 py-2 text-xs font-medium text-white transition hover:bg-red-800 disabled:opacity-50"
                  >
                    {removing ? "Removing…" : "Remove override"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingRemove(false)}
                    disabled={removing}
                    className="inline-flex items-center justify-center rounded-full border border-stone-200 px-4 py-2 text-xs font-medium text-stone-700 transition hover:border-stone-400 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmingRemove(true)}
                  disabled={saving || removing}
                  className="text-xs text-stone-400 underline-offset-2 hover:text-red-600 hover:underline disabled:opacity-50"
                >
                  Remove account-specific rules
                </button>
                <Link
                  href={`/accounts/${accountId}/edit`}
                  className="text-xs text-stone-400 underline-offset-2 hover:text-stone-700 hover:underline"
                >
                  Broker connection settings ↗
                </Link>
              </div>
            )}
          </div>
        )}

        {!hasExistingRules && (
          <Link
            href={`/accounts/${accountId}/edit`}
            className="text-xs text-stone-400 underline-offset-2 hover:text-stone-700 hover:underline"
          >
            Broker connection settings ↗
          </Link>
        )}
      </div>
    </form>
  );
}
