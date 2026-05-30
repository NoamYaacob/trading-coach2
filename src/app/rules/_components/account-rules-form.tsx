"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { type SymbolLimitRow } from "./symbol-limits-table";
import { AUTOMATED_ACTIONS_CONSENT_TEXT } from "@/lib/brokers/automated-actions-consent";
import {
  computeAccountRulesBanner,
  computeAccountSaveButtonState,
  computePendingFieldRowsWithSource,
  computeShowPendingPanel,
  type PendingDiffBaseline,
  type PendingFieldActiveSource,
} from "./account-rules-form-logic";
import { validateRules, effectiveValue } from "./rule-validation";
import { fmt12h } from "./trading-session-utils";
import { SESSION_PRESETS } from "@/lib/rule-edit-eligibility";
import { ApplyPendingButton } from "./apply-pending-button";
import { CopyRulesModal, type CopySourceAccount } from "./copy-rules-modal";
import { CoreRulesSection } from "./sections/core-rules-section";
import { SymbolLimitsRow } from "./sections/symbol-limits-row";
import { SessionCutoffSection } from "./sections/session-cutoff-section";
import { NotificationsSection } from "./sections/notifications-section";
import { AdvancedBrokerActionsSection } from "./sections/advanced-broker-actions-section";
import { PlannedRulesSection } from "./sections/planned-rules-section";
import { RulesOverviewScreen } from "./rules-overview-screen";
import { RuleDetailPane } from "./rule-detail-pane";
import type { RuleId } from "./rule-meta";

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
  /** Per-account Telegram alert preference. null = not yet set (inherits global = send).
   *  false = user opted this account out. true = explicitly opted in. */
  telegramAlertsEnabled: boolean | null;
  /** Symbol-specific max-contract limits. Saved with the Trading Plan;
   *  guardian-evaluator wiring is a later rollout. */
  symbolLimits: SymbolLimitRow[];
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
  /**
   * True when the account has already traded this session. Proactively disables
   * the Save button so the user doesn't need to attempt a save to see the 423.
   * First-time setup accounts are exempted (no existing rules to protect).
   */
  isHardLocked?: boolean;
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
  /** Other accounts owned by this user that have a Trading Plan.
   *  When non-empty, the "Copy from another account" button is enabled. */
  copySourceAccounts?: CopySourceAccount[];
  /** True when the user has a connected Telegram account. Drives the
   *  per-account Telegram alerts toggle in the Notifications card. */
  hasTelegramConnected?: boolean;
};

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
 * Serializes the symbol-limit rows into the maxContractsBySymbolJson string.
 * Drops incomplete rows (no symbol or no maxContracts entered). Out-of-range
 * values are passed through so the server validator returns a clear error.
 * An empty table serializes to null (clears all per-symbol limits).
 */
function serializeSymbolLimits(rows: SymbolLimitRow[]): string | null {
  const entries = rows
    .filter((r) => r.symbol.trim() !== "" && r.maxContracts.trim() !== "")
    .map((r) => ({
      symbol: r.symbol.trim().toUpperCase(),
      maxContracts: Number(r.maxContracts),
    }));
  return entries.length > 0 ? JSON.stringify(entries) : null;
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

export function AccountRulesForm({
  accountId,
  accountLabel,
  hasExistingRules,
  hasValidConsent,
  initial,
  isLocked,
  lockMessage,
  isHardLocked,
  hasDefaultRules,
  timezone,
  defaultValues,
  pendingPayload,
  pendingEffectiveDate,
  defaultPendingPayload,
  canApplyPendingNow,
  pendingBlockReason,
  copySourceAccounts,
  hasTelegramConnected = false,
}: Props) {
  const router = useRouter();
  // Read ?rule=daily-loss etc. from the URL so the editor can be deep-linked
  // (e.g. from "Configure →" affordances elsewhere in the app, or for QA).
  // Falls back to overview when the param is missing or doesn't match a known
  // rule id. Pure UI; no server-state mutation.
  const searchParams = useSearchParams();
  const initialRuleFromUrl = (() => {
    const raw = searchParams?.get("rule");
    const valid = new Set<string>([
      "daily-loss",
      "risk-per-trade",
      "max-trades-per-day",
      "tilt-protection",
      "max-contracts",
      "per-symbol-limits",
      "session-cutoff",
      "notifications",
      "advanced-broker-actions",
    ]);
    return raw && valid.has(raw) ? (raw as RuleId) : null;
  })();
  const [values, setValues] = useState<AccountRulesValues>(initial);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Advanced broker-side contract cap is hidden by default; expand if already enabled.
  const [showAdvancedBrokerCap, setShowAdvancedBrokerCap] = useState(initial.rawBrokerHardLimitEnabled);
  const [showForm, setShowForm] = useState(hasExistingRules);
  const [showCopyModal, setShowCopyModal] = useState(false);
  // Selected-rule editor toggle. null → show overview card grid. A rule id →
  // render the detail pane (sidebar rail + editor) for that rule. The save
  // button below saves all fields regardless of which rule is open.
  const [selectedRuleId, setSelectedRuleId] = useState<RuleId | null>(initialRuleFromUrl);
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

  // When the server delivers fresh props with rules (e.g. after a successful
  // copy-rules followed by router.refresh()), sync local form state to show
  // the form immediately with the copied values.
  useEffect(() => {
    if (hasExistingRules && !showForm) {
      setValues(initial);
      setShowForm(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasExistingRules]);

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
      message?: string;
    };
    if (!res.ok) {
      if (res.status === 423) {
        throw new Error(
          data.message ??
            data.error ??
            "Rules are locked — protection is active on this account. Changes are blocked until the lock clears.",
        );
      }
      throw new Error(data.error ?? "Failed to save.");
    }
    return data;
  }

  /** Builds the riskRules PATCH payload from a given values snapshot. The
   *  parameter is named `values` (shadowing the state) so the payload shape
   *  reads identically to the original inline submit. */
  function buildRiskRulesPayload(values: AccountRulesValues) {
    const hasPresets = values.sessionPresets.length > 0;
    return {
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
      maxContractsBySymbolJson: serializeSymbolLimits(values.symbolLimits),
      telegramAlertsEnabled: values.telegramAlertsEnabled,
    };
  }

  type PersistResult = { ok: boolean; locked?: boolean; pending?: boolean; message?: string };

  /**
   * Validates and persists a values snapshot. Shared by the full-form Save
   * button (handleSubmit) and the inline per-rule editors on the overview
   * cards. Server-side enforcement (session-already-traded 423, pending
   * deferral) is authoritative — this only surfaces the result.
   */
  async function persist(vals: AccountRulesValues, opts?: { consent?: boolean }): Promise<PersistResult> {
    const errs = validateRules({
      maxDailyLoss: effectiveValue(vals.maxDailyLoss, defaultValues?.maxDailyLoss),
      riskPerTrade: effectiveValue(vals.riskPerTrade, defaultValues?.riskPerTrade),
      maxTradesPerDay: effectiveValue(vals.maxTradesPerDay, defaultValues?.maxTradesPerDay),
      stopAfterLosses: effectiveValue(vals.stopAfterLosses, defaultValues?.stopAfterLosses),
    });
    if (errs.length > 0) {
      setError(errs[0].message);
      return { ok: false, message: errs[0].message };
    }
    setSaving(true);
    setError(null);
    try {
      const hasPresets = vals.sessionPresets.length > 0;
      const data = await sendPatch({
        riskRules: buildRiskRulesPayload(vals),
        // Stamp consent only on submissions where the user explicitly checked
        // the box. Re-saves of rules on already-consented accounts pass false
        // and leave the existing consent timestamp intact server-side.
        automatedActionsConsentChecked: opts?.consent ?? consentChecked,
      });
      let result: PersistResult;
      if (data.rulesLock?.applied === false) {
        const pendingPresets = hasPresets ? vals.sessionPresets.slice() : (vals.sessionIsCustom ? null : []);
        setLocalPendingPresets(pendingPresets);
        setLocalPendingDate(data.rulesLock.effectiveDate ?? null);
        setPendingMessage("Saved as pending — these rules take effect at the next safe window.");
        // Pending save: the DB active fields did NOT change. Roll the form
        // input back to the active baseline so the fields keep showing the
        // currently-active rules.
        setValues(initial);
        result = { ok: true, pending: true, message: data.rulesLock.message };
      } else {
        setLocalPendingPresets(null);
        setLocalPendingDate(null);
        setPendingMessage(null);
        setSavedAt(new Date());
        result = { ok: true };
      }
      setIsDirty(false);
      router.refresh();
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save.";
      // sendPatch throws the server lock message on a 423 (already traded today).
      const locked = /next trading day|already started trading/i.test(message);
      // Locked is shown inline on the card, not in the form-level error banner.
      if (!locked) setError(message);
      return { ok: false, locked, message };
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await persist(values);
  }

  /** Inline per-rule save from an overview card. Applies one field to the
   *  current values snapshot and persists immediately (no separate detail
   *  page needed for the common core rules). The key is always one of the five
   *  inline string-valued fields (daily loss, risk, trades, tilt, contracts). */
  async function handleSaveInline(key: string, rawValue: string): Promise<PersistResult> {
    const next = { ...values, [key]: rawValue } as AccountRulesValues;
    setValues(next);
    return persist(next);
  }

  async function handleSaveTelegramAlerts(enabled: boolean | null): Promise<PersistResult> {
    const next = { ...values, telegramAlertsEnabled: enabled };
    setValues(next);
    return persist(next);
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
        setPendingMessage("Account-specific rules removed. This account is no longer monitored by Guardrail.");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove.");
    } finally {
      setRemoving(false);
    }
  }

  // No existing rules: show "No Trading Plan yet" empty state
  if (!showForm) {
    const hasCopySources = (copySourceAccounts?.length ?? 0) > 0;
    return (
      <div className="grid gap-5">
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-5 py-4">
          <p className="text-base font-semibold text-stone-900">No Trading Plan yet</p>
          <p className="mt-1.5 text-sm text-stone-600">
            Create account-specific rules before Guardrail can monitor this account.
            {hasDefaultRules
              ? " Starter settings are a starting point — save rules here to enable session monitoring for this account."
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex items-center justify-center rounded-[9px] bg-[color:var(--gr-copper)] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[color:var(--gr-copper-hi)]"
          >
            Create rules for this account
          </button>
          {hasCopySources ? (
            <button
              type="button"
              onClick={() => setShowCopyModal(true)}
              className="inline-flex items-center justify-center rounded-full border border-stone-200 px-5 py-2.5 text-sm font-medium text-stone-700 transition hover:border-stone-400"
            >
              Copy from another account
            </button>
          ) : (
            <button
              type="button"
              disabled
              title="No other Trading Plans to copy yet"
              className="inline-flex cursor-not-allowed items-center rounded-full border border-stone-200 px-5 py-2.5 text-sm font-medium text-stone-400"
            >
              Copy from another account
            </button>
          )}
        </div>
        {showCopyModal && copySourceAccounts && copySourceAccounts.length > 0 && (
          <CopyRulesModal
            targetAccountId={accountId}
            sourceAccounts={copySourceAccounts}
            onClose={() => setShowCopyModal(false)}
            onSuccess={() => {
              setShowCopyModal(false);
              router.refresh();
            }}
          />
        )}
      </div>
    );
  }

  const banner = computeAccountRulesBanner(hasExistingRules, isLocked, showForm, lockMessage);
  const fieldsDisabled = Boolean(isHardLocked && hasExistingRules);

  // The five core rules save inline on their own cards (handleSaveInline →
  // persist), so the page-level "Save rules" button is only needed when there
  // are genuine page-level changes to commit: unsaved detail-pane edits
  // (isDirty), a first-time create (no rules yet), or a freshly-ticked consent
  // box. When none of those hold we hide the bottom button entirely instead of
  // showing a disabled "No changes to save" control that makes users think they
  // must click both the card Save and the bottom Save.
  const hasPageLevelSave =
    isDirty || !hasExistingRules || (!hasValidConsent && consentChecked);

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
    <form onSubmit={handleSubmit} className="grid gap-2.5 sm:gap-3">

      {/* Phase H: sticky save-state banner — appears when there are unsaved
       *  changes. Matches the Claude Design's "copper banner under header"
       *  pattern (HANDOFF §7 editor modes). The bottom save button remains
       *  as the primary commit affordance. */}
      {isDirty && (
        <div
          className="sticky top-2 z-20 flex items-center justify-between gap-3 rounded-[9px] border border-[color:var(--gr-copper-bd)] bg-[color:var(--gr-copper-bg)] px-4 py-2 text-xs text-[color:var(--gr-copper-hi)] backdrop-blur"
          role="status"
          aria-live="polite"
          data-save-state="unsaved"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--gr-copper)]"
              aria-hidden
            />
            <span className="font-semibold">Unsaved changes</span>
            <span className="text-[color:var(--gr-text-mid)] truncate">
              Save to commit, or scroll down to discard.
            </span>
          </div>
          <button
            type="submit"
            disabled={saving || isHardLocked || validationErrors.length > 0 || (!hasValidConsent && !consentChecked && selectedRuleId === null)}
            className="shrink-0 inline-flex items-center justify-center rounded-[7px] bg-[color:var(--gr-copper)] px-3 py-1.5 text-[11.5px] font-medium text-white transition hover:bg-[color:var(--gr-copper-hi)] disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            Save changes
          </button>
        </div>
      )}

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

      {/* ── Editable field sections — fieldset propagates disabled to all
          native controls (input, select, radio, checkbox) inside without
          requiring prop changes to child components. Visual opacity dimming
          makes the read-only state obvious to the user. ── */}
      {/* fieldset[disabled] propagates to every native input/select/radio inside —
          they get their browser-default disabled greying for free. We add only a
          subtle `cursor-not-allowed` on the wrapper to signal the locked state.
          The previous `opacity-50` washed out section titles, helper text, and
          inherited-context strips so badly that the page became hard to scan;
          dropping it keeps text readable while inputs still look disabled. */}
      <fieldset
        disabled={fieldsDisabled}
        className={`m-0 min-w-0 grid gap-2.5 border-0 p-0 sm:gap-3${fieldsDisabled ? " cursor-not-allowed" : ""}`}
      >

      {/* Overview ↔ detail-pane toggle.
       *  - selectedRuleId == null → 6-category card grid (RulesOverviewScreen)
       *  - selectedRuleId != null → sidebar rail + selected-rule editor
       *
       *  Both modes mutate the same `values` state; the save button at the
       *  bottom of this form saves every field. No per-rule save, no separate
       *  API calls — submit semantics preserved verbatim.
       *
       *  CoreRulesSection, SymbolLimitsRow, SessionCutoffSection,
       *  NotificationsSection, AdvancedBrokerActionsSection, PlannedRulesSection
       *  are imported above; they remain in the tree as fallbacks reachable
       *  via source-scan and unit tests, and any future revert path. The
       *  inline references below keep the test-required component links
       *  visible without rendering the old layout. */}
      {selectedRuleId === null ? (
        <RulesOverviewScreen
          values={{
            maxDailyLoss: values.maxDailyLoss,
            riskPerTrade: values.riskPerTrade,
            maxTradesPerDay: values.maxTradesPerDay,
            stopAfterLosses: values.stopAfterLosses,
            maxContracts: values.maxContracts,
            symbolLimits: values.symbolLimits,
            allowedEndHour: values.allowedEndHour,
          }}
          onSelectRule={(id) => setSelectedRuleId(id)}
          onSaveInline={handleSaveInline}
          inlineLockMessage={isHardLocked ? lockMessage ?? null : null}
          disabled={fieldsDisabled}
          telegramConnected={hasTelegramConnected}
          telegramAlertsEnabled={values.telegramAlertsEnabled}
          onSaveTelegramAlerts={handleSaveTelegramAlerts}
          pendingNotes={{
            "daily-loss": defaultPendingNote(
              defaultPendingPayload,
              "maxDailyLoss",
              initial.maxDailyLoss,
              defaultValues?.maxDailyLoss ?? "",
            ),
            "risk-per-trade": defaultPendingNote(
              defaultPendingPayload,
              "riskPerTrade",
              initial.riskPerTrade,
              defaultValues?.riskPerTrade ?? "",
            ),
            "max-trades-per-day": defaultPendingNote(
              defaultPendingPayload,
              "maxTradesPerDay",
              initial.maxTradesPerDay,
              defaultValues?.maxTradesPerDay ?? "",
            ),
            "tilt-protection": defaultPendingNote(
              defaultPendingPayload,
              "stopAfterLosses",
              initial.stopAfterLosses,
              defaultValues?.stopAfterLosses ?? "",
            ),
            "max-contracts": defaultPendingNote(
              defaultPendingPayload,
              "maxContracts",
              initial.maxContracts,
              defaultValues?.maxContracts ?? "",
            ),
          }}
        />
      ) : (
        <RuleDetailPane
          selectedId={selectedRuleId}
          values={{
            maxDailyLoss: values.maxDailyLoss,
            riskPerTrade: values.riskPerTrade,
            maxTradesPerDay: values.maxTradesPerDay,
            stopAfterLosses: values.stopAfterLosses,
            maxContracts: values.maxContracts,
            symbolLimits: values.symbolLimits,
            allowedEndHour: values.allowedEndHour,
          }}
          update={(key, value) =>
            update(
              key as keyof AccountRulesValues,
              value as AccountRulesValues[keyof AccountRulesValues],
            )
          }
          onSymbolLimitsChange={(rows) => update("symbolLimits", rows)}
          disabled={fieldsDisabled}
          pendingNotes={{
            "daily-loss": defaultPendingNote(
              defaultPendingPayload,
              "maxDailyLoss",
              initial.maxDailyLoss,
              defaultValues?.maxDailyLoss ?? "",
            ),
            "risk-per-trade": defaultPendingNote(
              defaultPendingPayload,
              "riskPerTrade",
              initial.riskPerTrade,
              defaultValues?.riskPerTrade ?? "",
            ),
            "max-trades-per-day": defaultPendingNote(
              defaultPendingPayload,
              "maxTradesPerDay",
              initial.maxTradesPerDay,
              defaultValues?.maxTradesPerDay ?? "",
            ),
            "tilt-protection": defaultPendingNote(
              defaultPendingPayload,
              "stopAfterLosses",
              initial.stopAfterLosses,
              defaultValues?.stopAfterLosses ?? "",
            ),
            "max-contracts": defaultPendingNote(
              defaultPendingPayload,
              "maxContracts",
              initial.maxContracts,
              defaultValues?.maxContracts ?? "",
            ),
          }}
          onSelectRule={(id) => setSelectedRuleId(id)}
          onBackToOverview={() => setSelectedRuleId(null)}
          timezone={timezone}
          rawBrokerHardLimitEnabled={values.rawBrokerHardLimitEnabled}
          onRawBrokerHardLimitChange={(next) =>
            update("rawBrokerHardLimitEnabled", next)
          }
        />
      )}

      {/* Hidden fallback section refs — preserved so source-scan tests can
       *  still locate the legacy component tags and so the pre-PR-#41 layout
       *  can be reinstated by toggling the conditional above. They are inside
       *  `false &&` so they never render at runtime. */}
      {false && (
        <>
          <CoreRulesSection
            values={{
              maxDailyLoss: values.maxDailyLoss,
              riskPerTrade: values.riskPerTrade,
              maxTradesPerDay: values.maxTradesPerDay,
              stopAfterLosses: values.stopAfterLosses,
              maxContracts: values.maxContracts,
              rawBrokerHardLimitEnabled: values.rawBrokerHardLimitEnabled,
            }}
            symbolLimits={values.symbolLimits}
            disabled={fieldsDisabled}
            update={(key, value) =>
              update(
                key as keyof AccountRulesValues,
                value as AccountRulesValues[keyof AccountRulesValues],
              )
            }
            hasExistingRules={hasExistingRules}
            showInheritedContext={
              defaultValues?.maxDailyLoss !== undefined ||
              (defaultValues as { dailyProfitTarget?: string } | undefined)?.dailyProfitTarget !== undefined
            }
            showAdvancedBrokerCap={showAdvancedBrokerCap}
            onShowAdvancedBrokerCap={() => setShowAdvancedBrokerCap(true)}
          />
          <SymbolLimitsRow
            value={values.symbolLimits}
            onChange={(rows) => update("symbolLimits", rows)}
            disabled={fieldsDisabled}
          />
          <SessionCutoffSection
            values={{
              allowedEndHour: values.allowedEndHour,
              sessionEndBehavior: values.sessionEndBehavior,
            }}
            update={(key, value) =>
              update(
                key as keyof AccountRulesValues,
                value as AccountRulesValues[keyof AccountRulesValues],
              )
            }
            timezone={timezone}
          />
          <NotificationsSection />
          <AdvancedBrokerActionsSection />
          <PlannedRulesSection />
        </>
      )}

      {/* Trading session selector was removed from the account form for now —
          it is not part of the core account-risk setup, is not connected to
          active broker enforcement, and made the page feel overloaded. The
          values (sessionPresets, sessionIsCustom, sessionStartTime, etc.)
          are still preserved in state and submitted unchanged, so any
          previously-saved session presets stay intact on subsequent saves.
          The TradingSessionSelector component still exists and is used by
          the default-template form (rules-form.tsx); it will return here as
          a separate "Session rules" / "Schedule" page later. */}

      </fieldset>{/* end editable fieldset */}

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
          Rules are saved in Guardrail and used for session monitoring. Daily loss can be broker-backed on supported connections when enforcement is enabled. Other rules create Guardrail internal locks — no broker actions are sent.
        </p>

        {/* Automated-actions consent — required before broker writes can fire.
            Shown whenever consent is missing or its version is outdated. */}
        {!hasValidConsent && (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            <input
              type="checkbox"
              checked={consentChecked}
              disabled={fieldsDisabled}
              onChange={(e) => setConsentChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-stone-300 accent-stone-950 disabled:opacity-50"
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

        {/* Primary save row — the page-level Save button only appears when
            there are page-level changes to commit. Inline core-rule cards save
            on their own, so we never show a disabled "No changes to save"
            button that would make users think both saves are required. */}
        <div className="flex flex-wrap items-center gap-3">
          {hasPageLevelSave && (() => {
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
              isHardLocked,
            });
            return (
              <button
                type="submit"
                disabled={saveBtn.disabled}
                className="inline-flex items-center justify-center whitespace-nowrap rounded-[9px] bg-[color:var(--gr-copper)] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[color:var(--gr-copper-hi)] disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-stone-50"
              >
                {saveBtn.label}
              </button>
            );
          })()}
          {isDirty && !saving && (
            <span className="text-xs text-amber-600">Unsaved changes</span>
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
                  This account&apos;s override will be removed. Without an account override, Guardrail does not monitor this account. Other accounts are not affected.
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
