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
  balance: number | null;
  riskRules: {
    maxDailyLoss: number | null;
    riskPerTrade: number | null;
    maxTradesPerDay: number | null;
    stopAfterLosses: number | null;
    allowedStartHour: number | null;
    allowedEndHour: number | null;
    propFirmAccountSize: number | null;
    propFirmPhase: string | null;
    propFirmDailyLossLimit: number | null;
    propFirmMaxDrawdown: number | null;
    propFirmEODDrawdown: number | null;
    propFirmTrailingDrawdown: boolean;
    propFirmDrawdownRemaining: number | null;
    propFirmProfitTarget: number | null;
    propFirmMinTradingDays: number | null;
  } | null;
};

type Props =
  | { mode: "create"; lockedPlatform?: string; hideRules?: boolean; hideEventRouting?: boolean }
  | { mode: "edit"; accountId: string; initialData: AccountFormInitialData; lockedPlatform?: string; hideRules?: boolean; hideEventRouting?: boolean };

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
  const lockedPlatform = props.lockedPlatform ?? null;
  const hideRules = props.hideRules ?? false;
  const hideEventRouting = props.hideEventRouting ?? false;

  const [form, setForm] = useState({
    label: init?.label ?? "",
    platform: lockedPlatform ?? init?.platform ?? "tradovate",
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
    propFirmAccountSize: init?.riskRules?.propFirmAccountSize?.toString() ?? "",
    propFirmPhase: init?.riskRules?.propFirmPhase ?? "",
    propFirmDailyLossLimit: init?.riskRules?.propFirmDailyLossLimit?.toString() ?? "",
    propFirmMaxDrawdown: init?.riskRules?.propFirmMaxDrawdown?.toString() ?? "",
    propFirmEODDrawdown: init?.riskRules?.propFirmEODDrawdown?.toString() ?? "",
    propFirmTrailingDrawdown: init?.riskRules?.propFirmTrailingDrawdown ?? false,
    propFirmDrawdownRemaining: init?.riskRules?.propFirmDrawdownRemaining?.toString() ?? "",
    propFirmProfitTarget: init?.riskRules?.propFirmProfitTarget?.toString() ?? "",
    propFirmMinTradingDays: init?.riskRules?.propFirmMinTradingDays?.toString() ?? "",
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
        propFirmAccountSize: parseNumberOrNull(form.propFirmAccountSize),
        propFirmPhase: form.propFirmPhase || null,
        propFirmDailyLossLimit: parseNumberOrNull(form.propFirmDailyLossLimit),
        propFirmMaxDrawdown: parseNumberOrNull(form.propFirmMaxDrawdown),
        propFirmEODDrawdown: parseNumberOrNull(form.propFirmEODDrawdown),
        propFirmTrailingDrawdown: form.propFirmTrailingDrawdown,
        propFirmDrawdownRemaining: parseNumberOrNull(form.propFirmDrawdownRemaining),
        propFirmProfitTarget: parseNumberOrNull(form.propFirmProfitTarget),
        propFirmMinTradingDays: parseNumberOrNull(form.propFirmMinTradingDays),
      },
    };
  }

  const liveBalance = props.mode === "edit" ? (props.initialData.balance ?? null) : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.label.trim()) {
      setError("Account label is required.");
      return;
    }
    if (form.platform === "tradovate" && !form.externalAccountId.trim()) {
      setError(
        "Tradovate account ID is required — find it in Tradovate → Account → Account Settings.",
      );
      return;
    }
    // Block saving daily loss limit > balance for personal accounts
    if (form.accountType === "personal" && liveBalance != null) {
      const parsedMaxDailyLoss = parseNumberOrNull(form.maxDailyLoss);
      if (parsedMaxDailyLoss != null && parsedMaxDailyLoss > liveBalance) {
        setError(
          `Daily loss limit ($${parsedMaxDailyLoss}) exceeds account balance ($${liveBalance.toFixed(2)}). Lower the limit or add more capital.`,
        );
        return;
      }
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
        const data = (await res.json()) as { error?: string; account?: { id: string } };
        if (!res.ok) throw new Error(data.error ?? "Failed to create account.");
        // Redirect to the edit page so the user immediately sees the readiness panel.
        router.push(data.account?.id ? `/accounts/${data.account.id}/edit` : "/accounts");
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

  const isTradovate = form.platform === "tradovate";
  const accountIdMissing = isTradovate && !form.externalAccountId.trim();
  const isPropFirmAccount =
    form.propFirm.trim() !== "" ||
    form.accountType === "evaluation" ||
    form.accountType === "funded";
  const parsedMaxDailyLoss = parseNumberOrNull(form.maxDailyLoss);
  const showBalanceWarning =
    form.accountType === "personal" &&
    liveBalance != null &&
    parsedMaxDailyLoss != null &&
    parsedMaxDailyLoss > liveBalance;
  const allRulesEmpty =
    !form.maxDailyLoss.trim() &&
    !form.riskPerTrade.trim() &&
    !form.maxTradesPerDay.trim() &&
    !form.stopAfterLosses.trim() &&
    !form.allowedStartHour.trim() &&
    !form.allowedEndHour.trim();

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

          {lockedPlatform ? null : (
            <Field label="Platform">
              <select
                value={form.platform}
                onChange={(e) => set("platform", e.target.value)}
                className={INPUT_CLASS}
              >
                <option value="tradovate">Tradovate</option>
                <option value="tradingview">TradingView</option>
              </select>
            </Field>
          )}

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

          {isPropFirmAccount && (
            <Field label="Prop firm">
              <input
                value={form.propFirm}
                onChange={(e) => set("propFirm", e.target.value)}
                placeholder="e.g. Apex, TopStep"
                className={INPUT_CLASS}
              />
            </Field>
          )}

          <div className="grid gap-1.5 sm:col-span-2">
            <span className={LABEL_CLASS}>
              {isTradovate ? (
                <>
                  Tradovate account ID{" "}
                  <span className="font-normal normal-case tracking-normal text-red-500">
                    required
                  </span>
                </>
              ) : (
                "External account ID"
              )}
            </span>
            <input
              value={form.externalAccountId}
              onChange={(e) => set("externalAccountId", e.target.value)}
              placeholder={isTradovate ? "Numeric ID, e.g. 12345" : "Broker-side account number"}
              className={INPUT_CLASS}
            />
            {isTradovate && (
              <p
                className={`rounded-lg px-3 py-2 text-xs ${
                  accountIdMissing
                    ? "border border-amber-200 bg-amber-50 text-amber-700"
                    : "text-stone-500"
                }`}
              >
                {accountIdMissing
                  ? "Required for webhook routing. Find it in Tradovate → Account → Account Settings. It is a numeric ID (e.g. 12345)."
                  : "This ID must exactly match the account ID Tradovate sends in webhook payloads."}
              </p>
            )}
          </div>

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

      {!hideRules && (
        <div>
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.22em] text-stone-400">
            Protection rules
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
              {showBalanceWarning && (
                <p className="text-xs text-amber-700">
                  Exceeds balance (${liveBalance!.toFixed(2)}). Saving will be blocked.
                </p>
              )}
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

            <Field label="Allowed from (CME hour 0–23)">
              <input
                inputMode="numeric"
                value={form.allowedStartHour}
                onChange={(e) => set("allowedStartHour", e.target.value)}
                placeholder="e.g. 9"
                className={INPUT_CLASS}
              />
            </Field>

            <Field label="Allowed until (CME hour 0–23)">
              <input
                inputMode="numeric"
                value={form.allowedEndHour}
                onChange={(e) => set("allowedEndHour", e.target.value)}
                placeholder="e.g. 16"
                className={INPUT_CLASS}
              />
            </Field>
          </div>

          {allRulesEmpty && (
            <p className="mt-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 text-xs text-stone-500">
              No rules set — Guardrail will receive and log events but cannot intervene. Add at
              least one limit to enable protection.
            </p>
          )}
        </div>
      )}

      {isPropFirmAccount && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.22em] text-stone-400">
            Prop firm profile
          </p>
          <p className="mb-4 text-xs text-stone-500">
            The effective daily loss budget is the tightest of your protection rules and the prop firm limits below.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Account size ($)">
              <input
                inputMode="decimal"
                value={form.propFirmAccountSize}
                onChange={(e) => set("propFirmAccountSize", e.target.value)}
                placeholder="e.g. 100000"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Account phase">
              <select
                value={form.propFirmPhase}
                onChange={(e) => set("propFirmPhase", e.target.value)}
                className={INPUT_CLASS}
              >
                <option value="">— Select phase —</option>
                <option value="evaluation">Evaluation / Challenge</option>
                <option value="funded">Funded</option>
                <option value="pa">PA (Performance Account)</option>
                <option value="sim">Simulation / Demo</option>
              </select>
            </Field>
            <Field label="Daily loss limit ($)">
              <input
                inputMode="decimal"
                value={form.propFirmDailyLossLimit}
                onChange={(e) => set("propFirmDailyLossLimit", e.target.value)}
                placeholder="e.g. 500"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Profit target ($)">
              <input
                inputMode="decimal"
                value={form.propFirmProfitTarget}
                onChange={(e) => set("propFirmProfitTarget", e.target.value)}
                placeholder="e.g. 3000"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Max drawdown ($)">
              <input
                inputMode="decimal"
                value={form.propFirmMaxDrawdown}
                onChange={(e) => set("propFirmMaxDrawdown", e.target.value)}
                placeholder="e.g. 2000"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="EOD drawdown ($)">
              <input
                inputMode="decimal"
                value={form.propFirmEODDrawdown}
                onChange={(e) => set("propFirmEODDrawdown", e.target.value)}
                placeholder="e.g. 1500"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Drawdown remaining ($)">
              <input
                inputMode="decimal"
                value={form.propFirmDrawdownRemaining}
                onChange={(e) => set("propFirmDrawdownRemaining", e.target.value)}
                placeholder="e.g. 1750"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Min trading days">
              <input
                inputMode="numeric"
                value={form.propFirmMinTradingDays}
                onChange={(e) => set("propFirmMinTradingDays", e.target.value)}
                placeholder="e.g. 5"
                className={INPUT_CLASS}
              />
            </Field>
            <div className="sm:col-span-2">
              <label className="flex items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={form.propFirmTrailingDrawdown}
                  onChange={(e) => set("propFirmTrailingDrawdown", e.target.checked)}
                  className="h-4 w-4 rounded border-stone-300 accent-stone-950"
                />
                <span className="font-medium text-stone-700">Trailing drawdown</span>
                <span className="text-xs text-stone-400">
                  (drawdown threshold moves with your high-water mark)
                </span>
              </label>
            </div>
          </div>
        </div>
      )}

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
          className="inline-flex items-center justify-center whitespace-nowrap rounded-full bg-stone-950 px-6 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500"
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

      {isTradovate && !hideEventRouting && (
        <details className="group rounded-2xl border border-stone-200 bg-stone-50 px-5 py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
            Tradovate event routing setup
            <span className="font-normal normal-case tracking-normal text-stone-400 transition-transform group-open:rotate-45">+</span>
          </summary>
          <ol className="mt-5 grid gap-5">
            <li className="flex gap-3 text-sm text-stone-700">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-stone-200 text-xs font-semibold text-stone-600">
                1
              </span>
              <span>
                Enter your <strong>Tradovate account ID</strong> in the field above. Open the
                Tradovate desktop app → <em>Account</em> → <em>Account Settings</em>. The ID is
                the numeric value shown at the top (e.g. 12345).
              </span>
            </li>
            <li className="flex gap-3 text-sm text-stone-700">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-stone-200 text-xs font-semibold text-stone-600">
                2
              </span>
              <span className="grid gap-1.5">
                <span>
                  Configure Tradovate to send events to this endpoint:
                </span>
                <code className="block rounded-lg bg-stone-100 px-3 py-1.5 text-xs font-mono text-stone-800">
                  https://your-app-url/api/tradovate/webhook
                </code>
              </span>
            </li>
            <li className="flex gap-3 text-sm text-stone-700">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-stone-200 text-xs font-semibold text-stone-600">
                3
              </span>
              <span className="grid gap-1.5">
                <span>
                  Include this header on every request:
                </span>
                <code className="block rounded-lg bg-stone-100 px-3 py-1.5 text-xs font-mono text-stone-800">
                  x-tradovate-secret: [your-webhook-secret]
                </code>
                <span className="text-xs text-stone-500">
                  Use the webhook secret configured on this server. Ask your administrator for
                  the correct value.
                </span>
              </span>
            </li>
            <li className="flex gap-3 text-sm text-stone-700">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-stone-200 text-xs font-semibold text-stone-600">
                4
              </span>
              <span>
                Save this account, then place a test trade. The{" "}
                <strong>connection readiness</strong> panel on this page will update to confirm the
                first event was received.
              </span>
            </li>
          </ol>
        </details>
      )}
    </form>
  );
}
