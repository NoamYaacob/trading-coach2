import Link from "next/link";
import type { ReactNode } from "react";

type Variant = "neutral" | "warning" | "locked" | "info" | "pending";

type NextActionBannerProps = {
  message: ReactNode;
  cta?: { label: string; href: string };
  variant?: Variant;
};

const variantStyles: Record<Variant, string> = {
  neutral: "border-stone-200 bg-stone-50 text-stone-700",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  locked:  "border-red-200 bg-red-50 text-red-800",
  info:    "border-sky-200 bg-sky-50 text-sky-800",
  pending: "border-stone-200 bg-stone-50 text-stone-500",
};

export function NextActionBanner({ message, cta, variant = "neutral" }: NextActionBannerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-sm ${variantStyles[variant]}`}
    >
      <span className="min-w-0">{message}</span>
      {cta && (
        <Link
          href={cta.href}
          className="shrink-0 text-xs font-semibold underline-offset-2 hover:underline"
        >
          {cta.label} →
        </Link>
      )}
    </div>
  );
}
