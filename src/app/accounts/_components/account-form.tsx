"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type AccountFormInitialData = {
  label: string;
  platform: string;
  propFirm: string | null;
  accountType: string;
  externalAccountId: string | null;
  currency: string;
  isActive: boolean;
  riskRules: {
    maxDailyLoss: number | null;
    riskPerTrade: number | null;
    maxTradesPerDay: number | null;
    stopAfterLosses: number | null;
    allowedStartHour: number | null;
    allowedEndHour: number | null;
  } | null;
};

type Props =
  | { mode: "create" }
  | { mode: "edit"; accountId: string; initialData: AccountFormInitialData };

function parseNumberOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

const INPUT_CLASS =
  "h-9 w-full rounded-xl border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-200";
const LABEL_CLASS = "text-xs font-semibold uppercase tracking-[0.16em] text-stone-500";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className={LABEL_CLASS}>{label}</span>
      {children}
    </label>
  );
}

export function AccountForm(props: Props) {
  const router = useRouter();
  const isEdit = props.mode === "edit";
  const init = isEdit ? props.initialData : null;

  const [form, setForm] = useState({
    label: init?.label ?? "",
    platform: init?.platform ?? "tradovate",
    propFirm: init?.propFirm ?? "",
    accountType: init?.accountType ?? "personal",
    externalAccountId: init?.externalAccountId ?? "",
    currency: init?.currency ?? "USD",
    isActive: init?.isActive ?? true,
    maxDailyLoss: init?.riskRules?.maxDailyLoss?.toString() ?? "",
    riskPerTrade: init?.riskRules?.riskPerTrade?.toString() ?? "",
    maxTradesPerDay: init?.riskRules?.maxTradesPerDay?.toString() ?? "",
    stopAfterLosses: init?.riskRules?.stopAfterLosses?.toString() ?? "",
    allowedStartHour: init?.riskRules?.allowedStartHour?.toString() ?? "",
    allowedEndHour: init?.riskRules?.allowedEndHour?.toString() ?? "",
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function set(key: keyof typeof form, value: string | boolean) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function buildBody() {
    return {
      label: form.label,
      platform: form.platform,
      propFirm: form.propFirm || null,
      accountType: form.accountType,
      externalAccountId: form.externalAccountId || null,
      currency: form.currency || "USD",
      isActive: form.isActive,
      riskRules: {
        maxDailyLoss: parseNumberOrNull(form.maxDailyLoss),
        riskPerTrade: parseNumberOrNull(form.riskPerTrade),
        maxTradesPerDay: parseNumberOrNull(form.maxTradesPerDay),
        stopAfterLosses: parseNumberOrNull(form.stopAfterLosses),
        allowedStartHour: parseNumberOrNull(form.allowedStartHour),
        allowedEndHour: parseNumberOrNull(form.allowedEndHour),
      },
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.label.trim()) {
      setError("Account label is required.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    setFeedback(null);

    try {
      if (props.mode === "create") {
        const res = await fetch("/api/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildBody()),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Failed to create account.");
        router.push("/accounts");
      } else {
        const res = await fetch(`/api/accounts/${props.accountId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildBody()),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Failed to save account.");
        setFeedback("Account saved.");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-8">
      <div>
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.22em] text-stone-400">
          Account details
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Account label">
            <input
              value={form.label}
              onChange={(e) => set("label", e.target.value)}
              placeholder="e.g. Apex Funded – Main"
              className={INPUT_CLASS}
            />
          </Field>

          <Field label="Platform">
            <select
              value={form.platform}
              onChange={(e) => set("platform", e.target.value)}
              className={INPUT_CLASS}
            >
              <option value="tradovate">Tradovate</option>
              <option value="tradingview">TradingView</option>
              <option value="manual">Manual</option>
            </select>
          </Field>

          <Field label="Prop firm">
            <input
              value={form.propFirm}
              onChange={(e) => set("propFirm", e.target.value)}
              placeholder="e.g. Apex, TopStep"
              className={INPUT_CLASS}
            />
          </Field>

          <Field label="Account type">
            <select
              value={form.accountType}
              onChange={(e) => set("accountType", e.target.value)}
              className={INPUT_CLASS}
            >
              <option value="evaluation">Evaluation</option>
              <option value="funded">Funded</option>
              <option value="personal">Personal</option>
              <option value="demo">Demo</option>
            </select>
          </Field>

          <Field label="External account ID">
            <input
              value={form.externalAccountId}
              onChange={(e) => set("externalAccountId", e.target.value)}
              placeholder="Broker-side account number"
              className={INPUT_CLASS}
            />
          </Field>

          <Field label="Currency">
            <input
              value={form.currency}
              onChange={(e) => set("currency", e.target.value)}
              placeholder="USD"
              className={INPUT_CLASS}
            />
          </Field>

          {isEdit && (
            <Field label="Status">
              <button
                type="button"
                onClick={() => set("isActive", !form.isActive)}
                className={`inline-flex w-fit rounded-full px-4 py-2 text-sm font-medium transition ${
                  form.isActive
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : "bg-stone-200 text-stone-700 hover:bg-stone-300"
                }`}
              >
                {form.isActive ? "Active" : "Inactive"}
              </button>
            </Field>
          )}
        </div>
      </div>

      <div>
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.22em] text-stone-400">
          Guardian rules
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Max daily loss">
            <input
              inputMode="decimal"
              value={form.maxDailyLoss}
              onChange={(e) => set("maxDailyLoss", e.target.value)}
              placeholder="e.g. 500"
              className={INPUT_CLASS}
            />
          </Field>

          <Field label="Risk per trade">
            <input
              inputMode="decimal"
              value={form.riskPerTrade}
              onChange={(e) => set("riskPerTrade", e.target.value)}
              placeholder="e.g. 100"
              className={INPUT_CLASS}
            />
          </Field>

          <Field label="Max trades per day">
            <input
              inputMode="numeric"
              value={form.maxTradesPerDay}
              onChange={(e) => set("maxTradesPerDay", e.target.value)}
              placeholder="e.g. 5"
              className={INPUT_CLASS}
            />
          </Field>

          <Field label="Stop after consecutive losses">
            <input
              inputMode="numeric"
              value={form.stopAfterLosses}
              onChange={(e) => set("stopAfterLosses", e.target.value)}
              placeholder="e.g. 3"
              className={INPUT_CLASS}
            />
          </Field>

          <Field label="Allowed from (UTC hour 0–23)">
            <input
              inputMode="numeric"
              value={form.allowedStartHour}
              onChange={(e) => set("allowedStartHour", e.target.value)}
              placeholder="e.g. 9"
              className={INPUT_CLASS}
            />
          </Field>

          <Field label="Allowed until (UTC hour 0–23)">
            <input
              inputMode="numeric"
              value={form.allowedEndHour}
              onChange={(e) => set("allowedEndHour", e.target.value)}
              placeholder="e.g. 16"
              className={INPUT_CLASS}
            />
          </Field>
        </div>
      </div>

      {(error ?? feedback) ? (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            error
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {error ?? feedback}
        </div>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex rounded-full bg-stone-950 px-6 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400"
        >
          {isSubmitting
            ? isEdit
              ? "Saving..."
              : "Creating..."
            : isEdit
              ? "Save account"
              : "Create account"}
        </button>
      </div>
    </form>
  );
}
