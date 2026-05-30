import Link from "next/link";

/**
 * Plan & Billing — user-facing plan status and CTA.
 *
 * Honest by design: there is no Stripe billing portal wired up yet, so the CTA
 * routes to /pricing ("View plans") rather than pretending a billing portal
 * exists. When a real portal lands, swap the link target and label.
 */

type Plan = "TRIALING" | "ACTIVE" | "INACTIVE" | "CANCELED";

function planLabel(status: Plan, trialEndsAt: Date | null): { label: string; tone: "trial" | "active" | "inactive" } {
  if (status === "ACTIVE") return { label: "Active subscription", tone: "active" };
  if (status === "TRIALING") {
    if (trialEndsAt && trialEndsAt > new Date()) {
      const days = Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / 86_400_000));
      return {
        label: days > 0 ? `Trial active — ${days} day${days === 1 ? "" : "s"} left` : "Trial active",
        tone: "trial",
      };
    }
    return { label: "Trial active", tone: "trial" };
  }
  if (status === "CANCELED") return { label: "Canceled", tone: "inactive" };
  return { label: "No active plan", tone: "inactive" };
}

export function PlanBilling({
  subscriptionStatus,
  trialEndsAt,
}: {
  subscriptionStatus: Plan;
  trialEndsAt: Date | null;
}) {
  const { label, tone } = planLabel(subscriptionStatus, trialEndsAt);
  const dotColor =
    tone === "active" ? "bg-emerald-500" : tone === "trial" ? "bg-sky-500" : "bg-stone-300";

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3" style={{ borderColor: "var(--gr-border-sub)", background: "var(--gr-bg-elev)" }}>
        <div className="flex items-center gap-3">
          <span className={`h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
          <div className="text-sm">
            <p className="font-medium" style={{ color: "var(--gr-text-mute)" }}>Current plan</p>
            <p style={{ color: "var(--gr-ink)" }}>{label}</p>
          </div>
        </div>
        <Link
          href="/pricing"
          className="inline-flex h-9 items-center rounded-full px-5 text-sm font-medium text-white transition hover:opacity-90"
          style={{ background: "var(--gr-ink)" }}
        >
          View plans
        </Link>
      </div>
      <p className="text-xs leading-5" style={{ color: "var(--gr-text-mute)" }}>
        Compare plans and pricing on the plans page. Self-service billing management is coming soon.
      </p>
    </div>
  );
}
