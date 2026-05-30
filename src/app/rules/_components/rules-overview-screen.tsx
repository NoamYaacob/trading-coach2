"use client";

/**
 * Rules overview screen — the default view of the Trading Plan editor.
 *
 * Shows all real Guardrail rules as clickable cards, grouped by category
 * (Capital / Discipline / Sizing / Schedule / Alerts / Enforcement).
 * Clicking a card switches the AccountRulesForm into editor mode for that
 * specific rule via the onSelectRule callback.
 *
 * Phase E (Guardrail design pass): filter chips per group, richer card anatomy
 * matching the GR design spec, enforcement key footnote.
 *
 * Data policy: only real form values from the DB are displayed.
 * Balance / P&L are omitted (not available on this page — no fabricated telemetry).
 */
import { useState } from "react";
import { GrEnforcementChip } from "@/components/ui/gr/gr-enforcement-chip";
import { GrChip } from "@/components/ui/gr/gr-chip";
import {
  RULE_GROUPS,
  rulesInGroup,
  ruleDisplayValue,
  type OverviewValues,
  type RuleId,
  type RuleMeta,
} from "./rule-meta";

export type InlineSaveResult = {
  ok: boolean;
  locked?: boolean;
  pending?: boolean;
  message?: string;
};

type Props = {
  values: OverviewValues;
  onSelectRule: (id: RuleId) => void;
  /** When true (locked session), cards stay clickable for read-only view,
   *  but the editor will refuse mutations downstream. */
  disabled?: boolean;
  pendingNotes?: Partial<Record<RuleId, string | null>>;
  /** Persists a single core-rule value inline. When provided, the five core
   *  rules (daily loss, risk per trade, max trades, tilt, max contracts) edit
   *  in place on the card instead of opening the detail pane. */
  onSaveInline?: (key: string, rawValue: string) => Promise<InlineSaveResult>;
  /** Message shown on a locked card when trading already started today. */
  inlineLockMessage?: string | null;
};

/**
 * The five core rules that edit inline on their overview card. Maps each rule
 * id to its AccountRulesValues key, input kind, and a plain-language help line.
 * Other rules (per-symbol, session cutoff, notifications, advanced) still open
 * the detail pane.
 */
const INLINE_RULES: Record<
  string,
  {
    valueKey: "maxDailyLoss" | "riskPerTrade" | "maxTradesPerDay" | "stopAfterLosses" | "maxContracts";
    kind: "money" | "count";
    help: string;
  }
> = {
  "daily-loss": {
    valueKey: "maxDailyLoss",
    kind: "money",
    help: "Guardrail locks the account the moment today's P&L crosses this loss. On supported Tradovate connections with full access, it can also be written to Tradovate's own risk settings so the broker enforces it.",
  },
  "risk-per-trade": {
    valueKey: "riskPerTrade",
    kind: "money",
    help: "A warning only — Guardrail flags trades risking more than this, but does not lock the account.",
  },
  "max-trades-per-day": {
    valueKey: "maxTradesPerDay",
    kind: "count",
    help: "Guardrail locks the account after this many completed round-trips in one trading day. Resets at the next session.",
  },
  "tilt-protection": {
    valueKey: "stopAfterLosses",
    kind: "count",
    help: "Locks the account after this many losses in a row. A winning trade resets the streak. Protects against revenge trading.",
  },
  "max-contracts": {
    valueKey: "maxContracts",
    kind: "count",
    help: "Guardrail locks the account if an open position exceeds this contract count, measured in standard-equivalent contracts.",
  },
};

function rawValueForRule(id: RuleId, values: OverviewValues): string {
  const cfg = INLINE_RULES[id];
  if (!cfg) return "";
  switch (cfg.valueKey) {
    case "maxDailyLoss": return values.maxDailyLoss;
    case "riskPerTrade": return values.riskPerTrade;
    case "maxTradesPerDay": return values.maxTradesPerDay;
    case "stopAfterLosses": return values.stopAfterLosses;
    case "maxContracts": return values.maxContracts;
  }
}

/**
 * Inline-editable core-rule card. View → Edit (in place) → Save / Cancel, with
 * a "?" help disclosure and a blocked state when trading already started today.
 * No separate detail page needed for these common rules.
 */
function InlineRuleCard({
  rule,
  display,
  rawValue,
  kind,
  help,
  disabled,
  lockMessage,
  pendingNote,
  onSave,
}: {
  rule: RuleMeta;
  display: string;
  rawValue: string;
  kind: "money" | "count";
  help: string;
  disabled?: boolean;
  lockMessage?: string | null;
  pendingNote?: string | null;
  onSave: (rawValue: string) => Promise<InlineSaveResult>;
}) {
  const [editing, setEditing] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [draft, setDraft] = useState(rawValue);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "locked" | "error" | "pending"; text: string } | null>(null);
  const isEmpty = display.trim() === "";

  function startEdit() {
    setDraft(rawValue);
    setFeedback(null);
    setEditing(true);
  }
  function cancel() {
    setEditing(false);
    setDraft(rawValue);
    setFeedback(null);
  }
  async function save() {
    setSaving(true);
    setFeedback(null);
    const res = await onSave(draft);
    setSaving(false);
    if (res.ok) {
      setEditing(false);
      if (res.pending) {
        setFeedback({ kind: "pending", text: res.message ?? "Saved as pending — applies at the next safe window." });
      }
    } else if (res.locked) {
      setFeedback({
        kind: "locked",
        text:
          res.message ??
          "You already started trading this account today. To protect your rules, changes will be available next trading day.",
      });
    } else {
      setFeedback({ kind: "error", text: res.message ?? "Could not save. Please try again." });
    }
  }

  return (
    <div
      data-rule-id={rule.id}
      data-inline-editable="true"
      className="group relative flex flex-col rounded-[14px] border border-[color:var(--gr-border-hi)] bg-[color:var(--gr-surface-warm)] p-5 text-left"
    >
      {/* Header row — group eyebrow (left), enforcement chip + help (right).
          The "?" help button lives here in the top-right, next to the status
          pill, so it never floats in the middle of the card. */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.10em] text-[color:var(--gr-text-mute)]">
          {rule.group}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <GrEnforcementChip variant={rule.status} />
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            aria-label={`Help for ${rule.label}`}
            aria-expanded={showHelp}
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold transition ${
              showHelp
                ? "border-amber-400 bg-amber-50 text-amber-700"
                : "border-stone-300 bg-white text-stone-400 hover:border-stone-400 hover:text-stone-600"
            }`}
          >
            ?
          </button>
        </div>
      </div>

      {/* Rule title */}
      <h3 className="mt-2.5 text-[14px] font-semibold leading-snug tracking-[-0.005em] text-[color:var(--gr-ink)]">
        {rule.label}
      </h3>
      <p className="mt-0.5 text-[11.5px] leading-[1.4] text-[color:var(--gr-text-mute)]">
        {rule.helper}
      </p>
      {showHelp && (
        <p className="mt-2 rounded-lg border border-amber-200/70 bg-amber-50/60 px-2.5 py-2 text-[11px] leading-snug text-amber-900">
          {help}
        </p>
      )}

      {/* Value / inline editor — the value itself is the edit affordance.
          In view mode the whole value row is a button (value + pencil); a
          click anywhere on it enters edit mode. No separate bottom Edit
          button. While editing, Save / Cancel sit directly under the input. */}
      <div className="mt-4 flex-1">
        {editing ? (
          <div className="grid gap-2">
            <div className="flex items-center gap-1.5">
              {kind === "money" && (
                <span className="text-base font-semibold text-[color:var(--gr-text-mid)]">$</span>
              )}
              <input
                type="number"
                inputMode={kind === "money" ? "decimal" : "numeric"}
                step={kind === "money" ? "any" : 1}
                min={kind === "count" ? 1 : undefined}
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); void save(); }
                  if (e.key === "Escape") { e.preventDefault(); cancel(); }
                }}
                className="w-full min-w-0 rounded-lg border border-[color:var(--gr-copper)] bg-white px-2.5 py-1.5 text-lg font-semibold tabular-nums text-[color:var(--gr-ink)] focus:outline-none focus:ring-2 focus:ring-[color:var(--gr-copper-bg)]"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="rounded-lg bg-[color:var(--gr-copper)] px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-[color:var(--gr-copper-hi)] disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={cancel}
                disabled={saving}
                className="rounded-lg border border-stone-200 px-2.5 py-1 text-[11px] font-medium text-stone-600 transition hover:border-stone-400 disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : disabled ? (
          /* Locked — value is read-only, no edit affordance. */
          <span
            className={
              isEmpty
                ? "text-sm italic text-[color:var(--gr-text-mute)]/60"
                : "text-2xl font-semibold tabular-nums leading-none tracking-[-0.015em] text-[color:var(--gr-ink)]"
            }
          >
            {isEmpty ? "Not set" : display}
          </span>
        ) : (
          /* The value row is the click target. Clicking the number or the
             pencil enters edit mode. Hover reveals a light border/background
             to signal editability. */
          <button
            type="button"
            onClick={startEdit}
            aria-label={`Edit ${rule.label}`}
            className="-mx-2 flex w-full items-center justify-between gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left transition hover:border-[color:var(--gr-border-hi)] hover:bg-[color:var(--gr-bg-elev)] focus:outline-none focus-visible:border-[color:var(--gr-copper)] focus-visible:ring-2 focus-visible:ring-[color:var(--gr-copper-bg)]"
          >
            <span
              className={
                isEmpty
                  ? "text-sm italic text-[color:var(--gr-text-mute)]/60"
                  : "text-2xl font-semibold tabular-nums leading-none tracking-[-0.015em] text-[color:var(--gr-ink)]"
              }
            >
              {isEmpty ? "Set value" : display}
            </span>
            <span
              aria-hidden
              title="Edit"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-400 opacity-60 transition group-hover:opacity-100 group-hover:text-[color:var(--gr-copper)] group-hover:border-[color:var(--gr-copper-bd)]"
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M11.5 2.5a1.4 1.4 0 0 1 2 2L5 13l-3 .8.8-3 8.7-8.3Z" />
              </svg>
            </span>
          </button>
        )}
      </div>

      {/* Footer — status indicator only (no Edit button). */}
      <div className="mt-4 flex items-center gap-2 border-t border-[color:var(--gr-border-sub)] pt-2.5">
        {disabled ? (
          <span
            title={lockMessage ?? undefined}
            className="rounded-full border border-stone-200 bg-stone-100 px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.08em] text-stone-500"
          >
            Locked
          </span>
        ) : isEmpty ? (
          <span className="text-[10.5px] text-[color:var(--gr-text-mute)]">Not configured</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10.5px] text-[color:var(--gr-text-mid)]">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--gr-copper)]" aria-hidden />
            Configured
          </span>
        )}
      </div>

      {feedback && (
        <p
          className={`mt-2 border-t pt-2 text-[10.5px] font-medium ${
            feedback.kind === "locked"
              ? "border-amber-100 text-amber-700"
              : feedback.kind === "pending"
                ? "border-sky-100 text-sky-700"
                : "border-red-100 text-red-600"
          }`}
        >
          {feedback.text}
        </p>
      )}
      {pendingNote && !feedback && (
        <p className="mt-2 border-t border-amber-100 pt-2 text-[10px] font-medium text-amber-700">
          {pendingNote}
        </p>
      )}
    </div>
  );
}

/** Count of user-configurable rules with a value entered (excludes static-display rules). */
function countSetRules(values: OverviewValues): number {
  let n = 0;
  if (values.maxDailyLoss.trim()) n++;
  if (values.riskPerTrade.trim()) n++;
  if (values.maxTradesPerDay.trim()) n++;
  if (values.stopAfterLosses.trim()) n++;
  if (values.maxContracts.trim()) n++;
  if (values.allowedEndHour.trim()) n++;
  if (values.symbolLimits.some((r) => r.symbol.trim() && r.maxContracts.trim())) n++;
  return n;
}

function RuleCard({
  rule,
  display,
  onSelect,
  disabled,
  pendingNote,
}: {
  rule: RuleMeta;
  display: string;
  onSelect: () => void;
  disabled?: boolean;
  pendingNote?: string | null;
}) {
  const isEmpty = display.trim() === "";
  const isViewOnly = !rule.editable;

  return (
    <button
      type="button"
      onClick={onSelect}
      data-rule-id={rule.id}
      aria-label={`Open editor for ${rule.label}`}
      className={`group relative flex flex-col rounded-[14px] border bg-[color:var(--gr-surface-warm)] p-5 text-left transition-[border-color,box-shadow,background,transform] duration-150 focus:outline-none focus-visible:border-[color:var(--gr-copper)] focus-visible:shadow-[0_0_0_4px_var(--gr-copper-bg)] ${
        disabled
          ? "cursor-pointer border-[color:var(--gr-border-hi)]"
          : "border-[color:var(--gr-border-hi)] hover:-translate-y-px hover:border-[color:var(--gr-copper)] hover:bg-[color:var(--gr-bg-elev)] hover:shadow-[0_0_0_4px_var(--gr-copper-bg)]"
      }`}
    >
      {/* Group eyebrow + enforcement chip */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.10em] text-[color:var(--gr-text-mute)]">
          {rule.group}
        </span>
        <GrEnforcementChip variant={rule.status} />
      </div>

      {/* Rule title */}
      <h3 className="mt-2.5 text-[14px] font-semibold leading-snug tracking-[-0.005em] text-[color:var(--gr-ink)]">
        {rule.label}
      </h3>

      {/* Sub-text */}
      <p className="mt-0.5 text-[11.5px] leading-[1.4] text-[color:var(--gr-text-mute)]">
        {rule.helper}
      </p>

      {/* Value — prominent display, tabular mono numerals */}
      <div className="mt-4 flex-1">
        <span
          className={
            isEmpty
              ? "text-sm italic text-[color:var(--gr-text-mute)]/60"
              : isViewOnly
              ? "text-[13px] font-medium text-[color:var(--gr-text-mid)]"
              : "text-2xl font-semibold tabular-nums leading-none tracking-[-0.015em] text-[color:var(--gr-ink)]"
          }
        >
          {isEmpty ? "Not set" : display}
        </span>
      </div>

      {/* Footer row — state indicator + action affordance */}
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-[color:var(--gr-border-sub)] pt-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          {disabled ? (
            <span className="rounded-full border border-stone-200 bg-stone-100 px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.08em] text-stone-500">
              Locked
            </span>
          ) : pendingNote ? (
            <span className="inline-flex items-center gap-1 text-[10.5px] text-amber-700">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden />
              From template
            </span>
          ) : isEmpty ? (
            <span className="text-[10.5px] text-[color:var(--gr-text-mute)]">
              Not configured
            </span>
          ) : rule.status === "saved-eval-soon" ? (
            <span className="inline-flex items-center gap-1 text-[10.5px] text-[color:var(--gr-saved)]">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-stone-400" aria-hidden />
              Saved
            </span>
          ) : rule.status === "planned-broker" || rule.status === "not-active" ? (
            <span className="inline-flex items-center gap-1 text-[10.5px] text-[color:var(--gr-plan)]">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full border border-dashed border-stone-400" aria-hidden />
              Planned
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10.5px] text-[color:var(--gr-text-mid)]">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--gr-copper)]" aria-hidden />
              Configured
            </span>
          )}
        </div>
        {rule.editable && !disabled && (
          <span className="shrink-0 text-[10.5px] font-semibold text-[color:var(--gr-copper)] opacity-0 transition group-hover:opacity-100">
            Configure →
          </span>
        )}
        {isViewOnly && (
          <span className="shrink-0 rounded-full border border-[color:var(--gr-border)] bg-[color:var(--gr-bg-elev)] px-1.5 py-px text-[10.5px] font-medium text-[color:var(--gr-plan)]">
            View
          </span>
        )}
      </div>

      {pendingNote && (
        <p className="mt-2 border-t border-amber-100 pt-2 text-[10px] font-medium text-amber-700">
          {pendingNote}
        </p>
      )}
    </button>
  );
}

export function RulesOverviewScreen({
  values,
  onSelectRule,
  disabled,
  pendingNotes,
  onSaveInline,
  inlineLockMessage,
}: Props) {
  const configured = countSetRules(values);

  /** Renders the inline-editable card for the 5 core rules, else the
   *  navigate-to-detail card. */
  function renderRuleCard(r: RuleMeta) {
    const inlineCfg = INLINE_RULES[r.id];
    if (inlineCfg && onSaveInline) {
      return (
        <InlineRuleCard
          key={r.id}
          rule={r}
          display={ruleDisplayValue(r.id, values)}
          rawValue={rawValueForRule(r.id, values)}
          kind={inlineCfg.kind}
          help={inlineCfg.help}
          disabled={disabled}
          lockMessage={inlineLockMessage}
          pendingNote={pendingNotes?.[r.id] ?? null}
          onSave={(rawValue) => onSaveInline(inlineCfg.valueKey, rawValue)}
        />
      );
    }
    return (
      <RuleCard
        key={r.id}
        rule={r}
        display={ruleDisplayValue(r.id, values)}
        onSelect={() => onSelectRule(r.id)}
        disabled={disabled}
        pendingNote={pendingNotes?.[r.id] ?? null}
      />
    );
  }
  const hasPending = pendingNotes && Object.values(pendingNotes).some((v) => v != null);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  const activeGroups = RULE_GROUPS.filter((g) => rulesInGroup(g).length > 0);
  const visibleGroups = activeGroup
    ? RULE_GROUPS.filter((g) => g === activeGroup)
    : RULE_GROUPS;

  return (
    <div className="grid gap-3" role="group" aria-label="Rules overview">

      {/* Phase J: editorial hero — sets workspace tone */}
      <header className="grid gap-1.5 pb-2">
        <h1
          className="text-[26px] leading-[1.1] tracking-[-0.02em] text-[color:var(--gr-ink)] max-w-2xl"
          style={{ fontFamily: "'Instrument Serif', 'Tiempos', Georgia, ui-serif, serif", fontWeight: 400 }}
        >
          Your <span className="relative inline-block">
            guardrails
            <span aria-hidden className="absolute inset-x-[-2px] bottom-[2px] -z-10 h-[10px] rounded-[5px] bg-[color:var(--gr-copper-bg)]" />
          </span>, watching every tick.
        </h1>
        <p className="max-w-lg text-[12px] leading-[1.5] text-[color:var(--gr-text-mid)]">
          Daily Loss is the only broker-backed rule. The rest run as app-level locks or monitors in Guardrail.
        </p>
      </header>

      {/* Phase I / Phase K: command-center status strip.
       * Only real data (Rules set, Session, Pending) — no fake balance/P&L not available here. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Rules set chip */}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--gr-border)] bg-[color:var(--gr-surface)] px-2.5 py-1 text-[11px]">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--gr-copper)]" aria-hidden />
          <span className="font-medium text-[color:var(--gr-text-mute)] uppercase tracking-[0.08em] text-[10px]">Rules set</span>
          <span className="font-semibold tabular-nums text-[color:var(--gr-ink)]">{configured} / 7</span>
        </span>
        {/* Session chip */}
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
          disabled
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : "border-[color:var(--gr-border)] bg-[color:var(--gr-surface)] text-[color:var(--gr-ink)]"
        }`}>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${disabled ? "bg-amber-400" : "bg-emerald-400"}`} aria-hidden />
          <span className="font-medium text-[color:var(--gr-text-mute)] uppercase tracking-[0.08em] text-[10px]">Session</span>
          <span className="font-semibold">{disabled ? "Locked" : "Open"}</span>
        </span>
        {/* Pending chip */}
        {hasPending && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] text-amber-800">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden />
            <span className="font-medium uppercase tracking-[0.08em] text-[10px]">Pending</span>
            <span className="font-semibold">Yes</span>
          </span>
        )}
        {!hasPending && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--gr-border)] bg-[color:var(--gr-surface)] px-2.5 py-1 text-[11px]">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-stone-300" aria-hidden />
            <span className="font-medium text-[color:var(--gr-text-mute)] uppercase tracking-[0.08em] text-[10px]">Pending</span>
            <span className="font-semibold text-[color:var(--gr-text-mid)]">None</span>
          </span>
        )}
      </div>

      {/* Group filter chips — G2 GrChip primitives */}
      <div className="flex flex-wrap items-center gap-1.5">
        <GrChip
          active={activeGroup === null}
          onClick={() => setActiveGroup(null)}
          aria-pressed={activeGroup === null}
        >
          All rules
          <span className="ml-1 tabular-nums opacity-70 text-[10.5px]">
            {RULE_GROUPS.reduce((n, g) => n + rulesInGroup(g).length, 0)}
          </span>
        </GrChip>
        {activeGroups.map((g) => {
          const count = rulesInGroup(g).length;
          return (
            <GrChip
              key={g}
              active={activeGroup === g}
              onClick={() => setActiveGroup(activeGroup === g ? null : g)}
              aria-pressed={activeGroup === g}
            >
              {g}
              <span className="ml-1 tabular-nums opacity-70 text-[10.5px]">{count}</span>
            </GrChip>
          );
        })}
      </div>

      {/* Rule cards — flat grid when showing all; grouped when a filter is active */}
      {activeGroup === null ? (
        /* All-rules flat grid: no section headers, matches Claude Design GrOverview */
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {RULE_GROUPS.flatMap((group) =>
            rulesInGroup(group).map((r) => renderRuleCard(r)),
          )}
        </div>
      ) : (
        /* Filtered view: single group header + that group's cards */
        visibleGroups.map((group) => {
          const rules = rulesInGroup(group);
          if (rules.length === 0) return null;
          return (
            <section key={group} className="grid gap-2.5">
              <div className="flex items-baseline justify-between">
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-amber-700">
                  {group}
                </p>
                <p className="text-[10px] text-stone-400">
                  {rules.length} {rules.length === 1 ? "rule" : "rules"}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {rules.map((r) => renderRuleCard(r))}
              </div>
            </section>
          );
        })
      )}

      {/* Enforcement key — explains badge meaning at the bottom of the overview */}
      <div className="rounded-xl border border-stone-100 bg-stone-50/60 px-4 py-3.5">
        <p className="mb-2.5 text-[9.5px] font-bold uppercase tracking-[0.16em] text-stone-400">
          About enforcement labels
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          {[
            { dot: "bg-emerald-500", label: "Broker-backed — enforced by the broker" },
            { dot: "bg-indigo-500", label: "App lock — blocks orders in Guardrail" },
            { dot: "bg-amber-500", label: "Monitor — tracks and notifies, never blocks" },
            { dot: "bg-stone-400", label: "Saved — stored, evaluation coming" },
            { dot: "border border-dashed border-stone-400", label: "Planned — not active yet" },
          ].map((item) => (
            <span
              key={item.label}
              className="inline-flex items-center gap-1.5 text-[10.5px] text-stone-500"
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.dot}`} />
              {item.label}
            </span>
          ))}
        </div>
      </div>

    </div>
  );
}
