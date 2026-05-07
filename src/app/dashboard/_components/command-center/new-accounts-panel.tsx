"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { PendingDiscoveredAccount } from "./types";

type Props = {
  accounts: PendingDiscoveredAccount[];
};

export function NewAccountsPanel({ accounts }: Props) {
  if (accounts.length === 0) return null;

  const firstPlatformLabel = accounts[0]!.platformLabel;
  const platformName = accounts.every((a) => a.platformLabel === firstPlatformLabel)
    ? firstPlatformLabel
    : "broker";

  return (
    <section
      aria-label="New broker account detected"
      className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 sm:p-5"
    >
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-800">
          {accounts.length === 1 ? "New broker account detected" : "New broker accounts detected"}
        </p>
        <p className="mt-1 text-sm text-amber-900">
          {accounts.length === 1
            ? `We found a new ${platformName} account on your connected broker login.`
            : `We found ${accounts.length} new ${platformName} accounts on your connected broker logins.`}
        </p>
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

function buildMetaParts(account: PendingDiscoveredAccount): string[] {
  const parts: string[] = [];
  parts.push(account.platformLabel);
  if (account.envLabel) parts.push(account.envLabel);
  const firmDisplay = account.suggestedPropFirm ?? account.propFirm;
  parts.push(firmDisplay?.trim() ? firmDisplay.trim() : "Unassigned");
  if (account.accountTypeLabel) parts.push(account.accountTypeLabel);
  if (account.externalAccountId) parts.push(`ID ${account.externalAccountId}`);
  return parts;
}

// ── Classification constants ──────────────────────────────────────────────────

type FirmChoice = "MyFundedFutures" | "Apex Trader Funding" | "Topstep" | "personal" | "other";

const FIRM_PILLS: { value: FirmChoice; label: string }[] = [
  { value: "MyFundedFutures", label: "MyFundedFutures" },
  { value: "Apex Trader Funding", label: "Apex" },
  { value: "Topstep", label: "Topstep" },
  { value: "personal", label: "Personal" },
  { value: "other", label: "Other…" },
];

type AccountTypeChoice = "evaluation" | "funded" | "personal" | "demo";

const ACCOUNT_TYPE_PILLS: { value: AccountTypeChoice; label: string }[] = [
  { value: "evaluation", label: "Evaluation" },
  { value: "funded", label: "Funded" },
  { value: "personal", label: "Personal" },
  { value: "demo", label: "Demo" },
];

const KNOWN_PILL_FIRMS: FirmChoice[] = ["MyFundedFutures", "Apex Trader Funding", "Topstep"];

function getDefaultFirmChoice(account: PendingDiscoveredAccount): FirmChoice {
  if (account.suggestedPropFirm) {
    return KNOWN_PILL_FIRMS.includes(account.suggestedPropFirm as FirmChoice)
      ? (account.suggestedPropFirm as FirmChoice)
      : "other";
  }
  return "personal";
}

function getDefaultOtherText(account: PendingDiscoveredAccount): string {
  if (account.suggestedPropFirm && !KNOWN_PILL_FIRMS.includes(account.suggestedPropFirm as FirmChoice)) {
    return account.suggestedPropFirm;
  }
  return "";
}

function getDefaultTypeChoice(account: PendingDiscoveredAccount): AccountTypeChoice {
  const t = account.suggestedAccountType;
  if (t === "evaluation" || t === "funded" || t === "personal" || t === "demo") return t;
  return "evaluation";
}

// ── Row modes ─────────────────────────────────────────────────────────────────

type RowMode = "idle" | "classifying" | "busy_add" | "busy_ignore";

// ── PendingAccountRow ─────────────────────────────────────────────────────────

function PendingAccountRow({ account }: { account: PendingDiscoveredAccount }) {
  const router = useRouter();
  const [mode, setMode] = useState<RowMode>("idle");
  const [error, setError] = useState<string | null>(null);

  const [firmChoice, setFirmChoice] = useState<FirmChoice>(() => getDefaultFirmChoice(account));
  const [otherText, setOtherText] = useState(() => getDefaultOtherText(account));
  const [typeChoice, setTypeChoice] = useState<AccountTypeChoice>(() => getDefaultTypeChoice(account));

  const busy = mode === "busy_add" || mode === "busy_ignore";

  async function callProtectionApi(protectionStatus: "protected" | "ignored") {
    const busyMode: RowMode = protectionStatus === "protected" ? "busy_add" : "busy_ignore";
    setMode(busyMode);
    setError(null);

    let propFirm: string | null = null;
    let accountType: string = "personal";
    if (protectionStatus === "protected") {
      if (firmChoice === "personal") {
        propFirm = null;
        accountType = "personal";
      } else if (firmChoice === "other") {
        propFirm = otherText.trim() || null;
        accountType = typeChoice;
      } else {
        propFirm = firmChoice;
        accountType = typeChoice;
      }
    }

    try {
      const res = await fetch(`/api/accounts/${account.id}/protection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protectionStatus, propFirm, accountType }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok || !data.ok) {
        setError(data.message ?? data.error ?? "Could not update account.");
        setMode("classifying");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setMode("classifying");
    }
  }

  const metaParts = buildMetaParts(account);

  return (
    <div className="rounded-xl border border-amber-200 bg-white px-4 py-3">
      {/* Account label + meta */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-stone-950">{account.label}</p>
          <p className="mt-0.5 truncate text-[11px] text-stone-500">{metaParts.join(" · ")}</p>
        </div>

        {mode === "idle" && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setMode("classifying")}
              className="inline-flex h-8 items-center rounded-full bg-stone-950 px-3.5 text-xs font-medium text-white transition hover:bg-stone-800"
            >
              Add to Guardrail
            </button>
            <button
              type="button"
              onClick={() => callProtectionApi("ignored")}
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

      {/* Classification step */}
      {(mode === "classifying" || mode === "busy_add") && (
        <div className="mt-3 border-t border-amber-100 pt-3">
          {/* Firm selector */}
          <p className="mb-1.5 text-[11px] font-medium text-stone-500">Which firm is this for?</p>
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

          {/* Account type selector (hidden for personal) */}
          {firmChoice !== "personal" && (
            <>
              <p className="mb-1.5 mt-3 text-[11px] font-medium text-stone-500">Account type</p>
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
            </>
          )}

          {/* Confirm / Cancel */}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => callProtectionApi("protected")}
              className="inline-flex h-8 items-center rounded-full bg-stone-950 px-3.5 text-xs font-medium text-white transition hover:bg-stone-800 disabled:pointer-events-none disabled:opacity-60"
            >
              {mode === "busy_add" ? "Adding…" : "Confirm — Add to Guardrail"}
            </button>
            {mode !== "busy_add" && (
              <button
                type="button"
                onClick={() => { setMode("idle"); setError(null); }}
                className="inline-flex h-8 items-center rounded-full border border-stone-200 px-3.5 text-xs font-medium text-stone-600 transition hover:border-stone-400 hover:text-stone-950"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
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
