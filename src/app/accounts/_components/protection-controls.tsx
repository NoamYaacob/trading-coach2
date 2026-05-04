"use client";

import { useState } from "react";

type ProtectionStatus =
  | "protected"
  | "monitor_only"
  | "ignored"
  | "archived"
  | "pending_decision";

const STATUS_LABEL: Record<ProtectionStatus, string> = {
  protected: "Protected",
  monitor_only: "Monitor only",
  ignored: "Ignored",
  archived: "Archived",
  pending_decision: "Pending",
};

const STATUS_BADGE: Record<ProtectionStatus, string> = {
  protected: "bg-emerald-100 text-emerald-700",
  monitor_only: "bg-sky-100 text-sky-700",
  ignored: "bg-stone-100 text-stone-500",
  archived: "bg-stone-200 text-stone-500",
  pending_decision: "bg-amber-100 text-amber-700",
};

const PROTECTION_RANK: Record<ProtectionStatus, number> = {
  protected: 4,
  monitor_only: 3,
  pending_decision: 2,
  ignored: 1,
  archived: 0,
};

type Props = {
  accountId: string;
  currentStatus: ProtectionStatus;
  pendingStatus?: ProtectionStatus | null;
  pendingEffectiveDate?: string | null;
  /** When the user is locked out by the daily cutoff. */
  isLocked: boolean;
  /** Mode: full = all controls; compact = just the chip + a single 'Manage' link */
  variant?: "full" | "compact";
};

const ALL_OPTIONS: ProtectionStatus[] = ["protected", "monitor_only", "ignored", "archived"];

export function ProtectionControls({
  accountId,
  currentStatus,
  pendingStatus,
  pendingEffectiveDate,
  isLocked,
  variant = "full",
}: Props) {
  const [status, setStatus] = useState<ProtectionStatus>(currentStatus);
  const [pending, setPending] = useState<{
    status: ProtectionStatus;
    effectiveDate: string;
  } | null>(
    pendingStatus && pendingEffectiveDate
      ? { status: pendingStatus, effectiveDate: pendingEffectiveDate }
      : null,
  );
  const [submitting, setSubmitting] = useState<ProtectionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function changeTo(next: ProtectionStatus) {
    setError(null);
    setInfo(null);
    setSubmitting(next);
    try {
      const res = await fetch(`/api/accounts/${accountId}/protection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protectionStatus: next }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        applied?: boolean;
        status?: ProtectionStatus;
        pendingStatus?: ProtectionStatus;
        effectiveDate?: string;
        message?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.message ?? data.error ?? "Could not update protection.");
        return;
      }
      if (data.applied) {
        setStatus(next);
        setPending(null);
      } else if (data.pendingStatus && data.effectiveDate) {
        setPending({ status: data.pendingStatus, effectiveDate: data.effectiveDate });
        setInfo(
          data.message ??
            "Protection is locked for today. Changes will apply from the next trading day.",
        );
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(null);
    }
  }

  // Decide which buttons to show. Always allow choices except the current one.
  const choices = ALL_OPTIONS.filter((o) => o !== status);

  if (variant === "compact") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${STATUS_BADGE[status]}`}
        >
          {STATUS_LABEL[status]}
        </span>
        {pending && (
          <span className="text-[11px] text-amber-700">
            → {STATUS_LABEL[pending.status]} on {pending.effectiveDate}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
          Protection
        </span>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${STATUS_BADGE[status]}`}
        >
          {STATUS_LABEL[status]}
        </span>
        {isLocked && (
          <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-medium text-amber-700">
            Locked for today
          </span>
        )}
        {pending && (
          <span className="text-[11px] text-amber-700">
            → {STATUS_LABEL[pending.status]} on {pending.effectiveDate}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {choices.map((next) => {
          const isReducing = PROTECTION_RANK[next] < PROTECTION_RANK[status];
          const wouldBeBlocked = isLocked && isReducing;
          const label =
            next === "protected"
              ? "Protect"
              : next === "monitor_only"
                ? "Monitor only"
                : next === "ignored"
                  ? "Ignore"
                  : "Archive";
          return (
            <button
              key={next}
              type="button"
              onClick={() => changeTo(next)}
              disabled={submitting != null}
              title={
                wouldBeBlocked
                  ? "Reductions in protection apply from the next trading day."
                  : undefined
              }
              className={`rounded-full border px-3 py-1 text-[11px] font-medium transition disabled:opacity-50 ${
                wouldBeBlocked
                  ? "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300"
                  : "border-stone-200 bg-white text-stone-700 hover:border-stone-400 hover:text-stone-950"
              }`}
            >
              {submitting === next ? "Saving…" : label}
              {wouldBeBlocked && <span className="ml-1 text-[9px]">(next day)</span>}
            </button>
          );
        })}
      </div>

      {info && <p className="text-[11px] text-amber-700">{info}</p>}
      {error && <p className="text-[11px] text-red-700">{error}</p>}

      {isLocked && (
        <p className="text-[11px] text-stone-500">
          You can change account protection before the trading session starts. After the
          cutoff, reductions apply from the next trading day.
        </p>
      )}
    </div>
  );
}
