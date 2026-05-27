import type { ReactNode } from "react";

type SectionCardProps = {
  title?: string;
  description?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  /** Reduces mobile padding and heading size — use inside collapsed/secondary sections. */
  compact?: boolean;
};

export function SectionCard({ title, description, children, actions, compact }: SectionCardProps) {
  const hasHeader = title || description || actions;
  return (
    <section
      className={`rounded-[14px] border shadow-sm ${compact ? "p-3 sm:p-5" : "p-5 sm:p-6"}`}
      style={{ borderColor: 'var(--gr-border)', background: 'var(--gr-surface)' }}
    >
      {hasHeader && (
        <div className={`flex items-start justify-between gap-4 ${compact ? "mb-3 sm:mb-5" : "mb-5"}`}>
          <div className={actions ? "min-w-0" : undefined}>
            {title && <h2 className={`font-semibold tracking-[-0.03em] ${compact ? "text-base sm:text-xl" : "text-xl"}`} style={{ color: 'var(--gr-ink)' }}>{title}</h2>}
            {description ? <p className={`mt-2 ${compact ? "text-xs leading-5 sm:text-sm sm:leading-6" : "text-sm leading-6"}`} style={{ color: 'var(--gr-text-mid)' }}>{description}</p> : null}
          </div>
          {actions ? <div className="shrink-0 pt-0.5">{actions}</div> : null}
        </div>
      )}
      {children}
    </section>
  );
}
