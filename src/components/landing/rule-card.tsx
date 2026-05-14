import type { RuleBadge } from "@/lib/marketing-data";

const RULE_BADGE_CONFIG: Record<
  RuleBadge,
  { label: string; dot: string; text: string; bg: string }
> = {
  active: {
    label: "Active",
    dot: "bg-emerald-500",
    text: "text-emerald-700",
    bg: "bg-emerald-50",
  },
  partial: {
    label: "Partial",
    dot: "bg-amber-400",
    text: "text-amber-700",
    bg: "bg-amber-50",
  },
  "coming-soon": {
    label: "Coming soon",
    dot: "bg-stone-300",
    text: "text-stone-500",
    bg: "bg-stone-50",
  },
};

export function RuleCard({
  name,
  description,
  badge,
}: {
  name: string;
  description: string;
  badge: RuleBadge;
}) {
  const cfg = RULE_BADGE_CONFIG[badge];
  return (
    <div className="rounded-[1.75rem] border border-stone-200 bg-white/90 px-3 py-3 shadow-[0_4px_14px_-4px_rgba(28,25,23,0.06)] sm:px-5 sm:py-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-2">
        <p className="text-sm font-semibold leading-5 text-stone-950">{name}</p>
        <span
          className={`inline-flex w-fit shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] sm:gap-1.5 sm:px-2.5 sm:text-[10px] sm:tracking-[0.16em] ${cfg.bg} ${cfg.text}`}
        >
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${cfg.dot}`} aria-hidden />
          {cfg.label}
        </span>
      </div>
      <p className="mt-1.5 text-xs leading-4 text-stone-500 sm:mt-2 sm:text-sm sm:leading-5">
        {description}
      </p>
    </div>
  );
}

export function RuleCardLegend() {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-stone-400">
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
        Active
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />
        Monitoring only
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-stone-300" aria-hidden />
        Coming soon
      </span>
    </div>
  );
}
