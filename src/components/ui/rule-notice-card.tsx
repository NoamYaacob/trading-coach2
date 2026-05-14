import type { RuleResult } from "@/lib/rule-engine";

type NoticeStyles = {
  shell: string;
  label: string;
  message: string;
  action: string;
  badge: string;
};

function getNoticeStyles(severity: RuleResult["severity"]): NoticeStyles {
  switch (severity) {
    case "critical":
    case "high":
      return {
        shell: "border-red-200 bg-red-50",
        label: "text-red-500",
        message: "text-red-900",
        action: "text-red-700",
        badge: "bg-red-100 text-red-800",
      };
    case "medium":
      return {
        shell: "border-amber-200 bg-amber-50",
        label: "text-amber-500",
        message: "text-amber-900",
        action: "text-amber-700",
        badge: "bg-amber-100 text-amber-800",
      };
    default:
      return {
        shell: "border-stone-200 bg-stone-50",
        label: "text-stone-500",
        message: "text-stone-800",
        action: "text-stone-600",
        badge: "bg-stone-100 text-stone-700",
      };
  }
}

const statusLabels: Record<RuleResult["status"], string> = {
  ok: "OK",
  warning: "Warning",
  blocked: "Blocked",
  triggered: "Triggered",
};

type RuleNoticeCardProps = {
  notice: Pick<
    RuleResult,
    "ruleId" | "severity" | "status" | "message" | "recommendedAction"
  >;
};

export function RuleNoticeCard({ notice }: RuleNoticeCardProps) {
  const styles = getNoticeStyles(notice.severity);

  return (
    <div className={`rounded-2xl border px-4 py-3 ${styles.shell}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium leading-snug ${styles.message}`}>
            {notice.message}
          </p>
          {notice.recommendedAction ? (
            <p className={`mt-1 text-sm ${styles.action}`}>
              {notice.recommendedAction}
            </p>
          ) : null}
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${styles.badge}`}
        >
          {statusLabels[notice.status]}
        </span>
      </div>
    </div>
  );
}

type RuleNoticeListProps = {
  notices: Array<
    Pick<
      RuleResult,
      "ruleId" | "severity" | "status" | "message" | "recommendedAction"
    >
  >;
  className?: string;
};

/**
 * Renders a compact stack of rule violation notices.
 * Returns null when the list is empty so callers can render conditionally without checking.
 */
export function RuleNoticeList({ notices, className }: RuleNoticeListProps) {
  if (notices.length === 0) {
    return null;
  }

  return (
    <div className={`grid gap-2 ${className ?? ""}`}>
      {notices.map((notice) => (
        <RuleNoticeCard key={notice.ruleId} notice={notice} />
      ))}
    </div>
  );
}
