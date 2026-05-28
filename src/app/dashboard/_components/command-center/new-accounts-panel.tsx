"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  buildMetaParts,
  buildPanelHeading,
  resolveConfirmOutcome,
  PREVIEW_CONFIRM_MESSAGE,
  PREVIEW_CONFIRM_HINT,
  getDefaultFirmChoice,
  getDefaultOtherText,
  getDefaultTypeChoice,
  type FirmChoice,
  type AccountTypeChoice,
} from "./new-accounts-panel-logic";
import type { PendingDiscoveredAccount } from "./types";

type Props = {
  accounts: PendingDiscoveredAccount[];
};

export function NewAccountsPanel({ accounts }: Props) {
  if (accounts.length === 0) return null;

  // Use the inherited firm name in the header when every account
  // belongs to the same unambiguously inferred firm.
  const firstFirm = accounts[0]!.inheritedPropFirm ?? accounts[0]!.suggestedPropFirm;
  const allSameFirm =
    firstFirm != null &&
    accounts.every(
      (a) => (a.inheritedPropFirm ?? a.suggestedPropFirm) === firstFirm,
    );
  const firmLabel = allSameFirm ? firstFirm : null;

  const firstPlatformLabel = accounts[0]!.platformLabel;
  const platformName = accounts.every((a) => a.platformLabel === firstPlatformLabel)
    ? firstPlatformLabel
    : "broker";

  const heading = buildPanelHeading(firmLabel, accounts.length);

  const subheading =
    accounts.length === 1
      ? `Guardrail found a new ${platformName} account on your connected broker login. Review it before adding protection.`
      : `Guardrail found ${accounts.length} new ${platformName} accounts on your connected broker logins. Review them before adding protection.`;

  return (
    <section
      aria-label={heading}
      className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 sm:p-5"
    >
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-800">
          {heading}
        </p>
        <p className="mt-1 text-sm text-amber-900">{subheading}</p>
      </header>
      <ul className="mt-4 grid gap-2">
        {accounts.map((a) => (
          <li key={a.id}>
            <PendingAccountRow account={a} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Classification constants ──────────────────────────────────────────────────

const FIRM_PILLS: { value: FirmChoice; label: string }[] = [
  { value: "MyFundedFutures", label: "MyFundedFutures" },
  { value: "Apex Trader Funding", label: "Apex" },
  { value: "Topstep", label: "Topstep" },
  { value: "personal", label: "Personal" },
  { value: "other", label: "Other…" },
];

const ACCOUNT_TYPE_PILLS: { value: AccountTypeChoice; label: string }[] = [
  { value: "evaluation", label: "Evaluation" },
  { value: "funded", label: "Funded" },
  { value: "personal", label: "Live / Personal" },
  { value: "demo", label: "Demo" },
];

// ── Row mode ─────────────────────────────────────────────────────────────────

type RowMode = "idle" | "reviewing" | "busy_add" | "busy_ignore" | "dismissed";
type RulesChoice = "default" | "copy_from" | "account_specific";

// ── Rules card buttons ────────────────────────────────────────────────────────

function RulesCards({
  choice,
  disabled,
  onChange,
}: {
  choice: RulesChoice;
  disabled: boolean;
  onChange: (v: RulesChoice) => void;
}) {
  return (
    <div className="grid gap-2">
      {(
        [
          {
            value: "default" as RulesChoice,
            label: "Use Default trading plan",
            detail: "Use your default rules for this account.",
          },
          {
            value: "copy_from" as RulesChoice,
            label: "Copy from existing account",
            detail: "Start from another account's saved rules.",
          },
          {
            value: "account_specific" as RulesChoice,
            label: "Set rules from scratch",
            detail: "Configure custom limits for this account.",
          },
        ] as const
      ).map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          className={[
            "rounded-xl border px-3 py-2.5 text-left transition disabled:pointer-events-none disabled:opacity-60",
            choice === opt.value
              ? "border-stone-800 bg-stone-950 text-white"
              : "border-stone-200 hover:border-stone-400 hover:bg-stone-50",
          ].join(" ")}
        >
          <p className={`text-xs font-semibold ${choice === opt.value ? "text-white" : "text-stone-800"}`}>
            {opt.label}
          </p>
          <p className={`mt-0.5 text-[11px] ${choice === opt.value ? "text-stone-300" : "text-stone-500"}`}>
            {opt.detail}
          </p>
        </button>
      ))}
    </div>
  );
}

// ── PendingAccountRow ─────────────────────────────────────────────────────────

function PendingAccountRow({ account }: { account: PendingDiscoveredAccount }) {
  const router = useRouter();

  const [mode, setMode] = useState<RowMode>("idle");
  const [error, setError] = useState<string | null>(null);
  const [rulesChoice, setRulesChoice] = useState<RulesChoice>("default");

  const [firmChoice, setFirmChoice] = useState<FirmChoice>(() =>
    getDefaultFirmChoice(account.inheritedPropFirm, account.suggestedPropFirm),
  );
  const [otherText, setOtherText] = useState(() =>
    getDefaultOtherText(account.inheritedPropFirm, account.suggestedPropFirm),
  );
  const [typeChoice, setTypeChoice] = useState<AccountTypeChoice>(() =>
    getDefaultTypeChoice(account.inheritedAccountType, account.suggestedAccountType),
  );
  const [showManualPicker, setShowManualPicker] = useState(false);

  const firmIsInferred = !!account.inheritedPropFirm;
  const busy = mode === "busy_add" || mode === "busy_ignore";

  async function handleConfirmAdd() {
    const outcome = resolveConfirmOutcome(account.isPreview, firmChoice, otherText, typeChoice);
    if (outcome.kind === "preview_blocked") {
      setError(PREVIEW_CONFIRM_MESSAGE);
      return;
    }
    setMode("busy_add");
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${account.id}/protection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protectionStatus: "protected",
          propFirm: outcome.propFirm,
          accountType: outcome.accountType,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok || !data.ok) {
        setError(data.message ?? data.error ?? "Could not add account.");
        setMode("reviewing");
        return;
      }
      if (rulesChoice === "account_specific" || rulesChoice === "copy_from") {
        router.push(`/rules?scope=account&id=${account.id}`);
      } else {
        router.refresh();
      }
    } catch {
      setError("Network error. Please try again.");
      setMode("reviewing");
    }
  }

  async function handleIgnore() {
    // Preview accounts have no DB row — silently dismiss without calling the API.
    if (account.isPreview) {
      setMode("dismissed");
      return;
    }
    setMode("busy_ignore");
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${account.id}/protection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protectionStatus: "ignored" }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok || !data.ok) {
        setError(data.message ?? data.error ?? "Could not update account.");
        setMode("idle");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setMode("idle");
    }
  }

  function handleCancel() {
    setMode("idle");
    setError(null);
    setShowManualPicker(false);
  }

  if (mode === "dismissed") return null;

  const metaParts = buildMetaParts(account);
  // Show the manual picker when firm is ambiguous OR after user clicks "Change…"
  const showPicker = !firmIsInferred || showManualPicker;

  return (
    <div className="rounded-xl border border-amber-200 bg-white px-4 py-3">
      {/* Account label + meta */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-stone-950">{account.label}</p>
            {account.isPreview && (
              <span className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                Demo preview
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-[11px] text-stone-500">{metaParts.join(" · ")}</p>
        </div>

        {mode === "idle" && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setMode("reviewing")}
              className="inline-flex h-8 items-center rounded-full bg-stone-950 px-3.5 text-xs font-medium text-white transition hover:bg-stone-800"
            >
              Review setup
            </button>
            <button
              type="button"
              onClick={handleIgnore}
              className="inline-flex h-8 items-center rounded-full border border-stone-200 px-3.5 text-xs font-medium text-stone-600 transition hover:border-stone-400 hover:text-stone-950"
            >
              Ignore for now
            </button>
          </div>
        )}

        {mode === "busy_ignore" && (
          <p className="shrink-0 text-xs text-stone-400">Saving…</p>
        )}
      </div>

      {/* Setup step */}
      {(mode === "reviewing" || mode === "busy_add") && (
        <div className="mt-3 border-t border-amber-100 pt-3">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
            Review account setup
          </p>

          {/* ── Firm: locked display (inferred) or picker (ambiguous / after "Change firm…") ── */}
          {!showPicker ? (
            <div className="mb-3">
              <p className="mb-1 text-[11px] font-medium text-stone-500">Firm</p>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-stone-800">
                  {firmChoice === "other"
                    ? otherText.trim() || "Unknown"
                    : firmChoice}
                </span>
                {!busy && (
                  <button
                    type="button"
                    onClick={() => setShowManualPicker(true)}
                    className="text-[11px] text-stone-400 underline underline-offset-2 hover:text-stone-600"
                  >
                    Change firm…
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="mb-3">
              <p className="mb-1.5 text-[11px] font-medium text-stone-500">
                Which firm is this for?
              </p>
              <div className="flex flex-wrap gap-1.5">
                {FIRM_PILLS.map((pill) => (
                  <button
                    key={pill.value}
                    type="button"
                    disabled={busy}
                    onClick={() => setFirmChoice(pill.value)}
                    className={[
                      "inline-flex h-7 items-center rounded-full px-3 text-[11px] font-medium transition disabled:pointer-events-none disabled:opacity-60",
                      firmChoice === pill.value
                        ? "bg-stone-950 text-white"
                        : "border border-stone-200 text-stone-600 hover:border-stone-400 hover:text-stone-950",
                    ].join(" ")}
                  >
                    {pill.label}
                  </button>
                ))}
              </div>
              {firmChoice === "other" && (
                <input
                  type="text"
                  placeholder="Firm name…"
                  value={otherText}
                  disabled={busy}
                  onChange={(e) => setOtherText(e.target.value)}
                  className="mt-2 h-8 w-full rounded-lg border border-stone-200 px-3 text-xs text-stone-950 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none disabled:opacity-60"
                />
              )}
            </div>
          )}

          {/* ── Account type: always shown unless personal ── */}
          {firmChoice !== "personal" && (
            <div className="mb-3">
              <p className="mb-1.5 text-[11px] font-medium text-stone-500">Account type</p>
              <div className="flex flex-wrap gap-1.5">
                {ACCOUNT_TYPE_PILLS.map((pill) => (
                  <button
                    key={pill.value}
                    type="button"
                    disabled={busy}
                    onClick={() => setTypeChoice(pill.value)}
                    className={[
                      "inline-flex h-7 items-center rounded-full px-3 text-[11px] font-medium transition disabled:pointer-events-none disabled:opacity-60",
                      typeChoice === pill.value
                        ? "bg-stone-950 text-white"
                        : "border border-stone-200 text-stone-600 hover:border-stone-400 hover:text-stone-950",
                    ].join(" ")}
                  >
                    {pill.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Rules ── */}
          <p className="mb-2.5 text-[11px] font-medium text-stone-500">
            How should Guardrail protect this account?
          </p>
          <RulesCards choice={rulesChoice} disabled={busy} onChange={setRulesChoice} />

          {/* ── Confirm / Cancel ── */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={handleConfirmAdd}
              className="inline-flex h-8 items-center rounded-full bg-stone-950 px-3.5 text-xs font-medium text-white transition hover:bg-stone-800 disabled:pointer-events-none disabled:opacity-60"
            >
              {mode === "busy_add" ? "Adding…" : "Add this account to Guardrail"}
            </button>
            {mode !== "busy_add" && (
              <button
                type="button"
                onClick={handleCancel}
                className="inline-flex h-8 items-center rounded-full border border-stone-200 px-3.5 text-xs font-medium text-stone-600 transition hover:border-stone-400 hover:text-stone-950"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {error && account.isPreview && (
        <div className="mt-2">
          <p className="text-[11px] text-stone-600">{error}</p>
          <p className="mt-0.5 text-[11px] text-stone-400">{PREVIEW_CONFIRM_HINT}</p>
        </div>
      )}
      {error && !account.isPreview && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-red-700">
          <span>{error}</span>
          <Link
            href={`/accounts/${account.id}/setup`}
            className="underline-offset-2 hover:underline"
          >
            Open setup
          </Link>
        </p>
      )}
    </div>
  );
}
