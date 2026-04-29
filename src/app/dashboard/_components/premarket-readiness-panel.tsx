import Link from "next/link";

import type { PremarketReadiness } from "@/lib/guardian";

type PremarketReadinessPanelProps = {
  readiness: PremarketReadiness;
};

function getToneStyles(tone: PremarketReadiness["tone"]) {
  switch (tone) {
    case "ready":
      return {
        shell: "border-emerald-200 bg-emerald-50/80",
        chip: "bg-emerald-600 text-white",
      };
    case "setup":
      return {
        shell: "border-blue-200 bg-blue-50/80",
        chip: "bg-blue-600 text-white",
      };
    case "warning":
      return {
        shell: "border-amber-200 bg-amber-50/80",
        chip: "bg-amber-500 text-white",
      };
    default:
      return {
        shell: "border-red-200 bg-red-50/80",
        chip: "bg-red-600 text-white",
      };
  }
}

export function PremarketReadinessPanel({
  readiness,
}: PremarketReadinessPanelProps) {
  const styles = getToneStyles(readiness.tone);

  return (
    <section className={`rounded-[1.6rem] border px-5 py-5 ${styles.shell}`}>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <span
            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${styles.chip}`}
          >
            {readiness.status}
          </span>
          <p className="mt-3 text-xl font-semibold tracking-[-0.03em] text-stone-950">
            {readiness.headline}
          </p>
          <p className="mt-1 text-sm text-stone-700">{readiness.detail}</p>
          {readiness.upcomingEvent ? (
            <div className="mt-3 rounded-2xl border border-emerald-200/70 bg-white/60 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-emerald-700">
                {readiness.upcomingEvent.eyebrow}
              </p>
              <p className="mt-2 text-base font-medium text-stone-950">{readiness.upcomingEvent.stateLabel}</p>
              <p className="mt-1 text-sm text-stone-600">{readiness.upcomingEvent.title}</p>
              <p className="mt-1 text-sm text-stone-500">{readiness.upcomingEvent.time}</p>
            </div>
          ) : readiness.upcomingEventNote ? (
            <p className="mt-3 text-sm text-stone-700">{readiness.upcomingEventNote}</p>
          ) : null}
        </div>

        <Link
          href={readiness.actionHref}
          className="inline-flex shrink-0 rounded-full bg-stone-950 px-4 py-2 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
        >
          {readiness.actionLabel}
        </Link>
      </div>
    </section>
  );
}
