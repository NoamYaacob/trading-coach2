/**
 * Shared Tailwind class strings for pill/oval action buttons.
 *
 * All tiers include `inline-flex items-center justify-center whitespace-nowrap`
 * so text stays vertically centered in both <button> and <a>/<Link> elements.
 *
 * Tiers:
 *   PILL_ROW_*    — compact inline table/card row actions (text-[11px], px-2.5 py-1)
 *   PILL_CARD_*   — mobile card action buttons (h-9 px-4, touch-friendly)
 *   PILL_*        — standard form CTAs (text-sm, px-5 py-2.5)
 *   PILL_DIALOG_* — dialog confirm/cancel buttons (h-10 px-6)
 */

const BASE = "inline-flex items-center justify-center whitespace-nowrap rounded-full transition";

// ─── Compact row actions (desktop table rows) ─────────────────────────────────

export const PILL_ROW_PRIMARY =
  `${BASE} bg-[var(--gr-ink)] px-2.5 py-1 text-[11px] font-medium text-[var(--gr-bg)] hover:opacity-85`;

export const PILL_ROW_SECONDARY =
  `${BASE} border border-[var(--gr-border)] px-2.5 py-1 text-[11px] font-medium text-[var(--gr-text-mid)] hover:border-[var(--gr-text-mute)] hover:text-[var(--gr-ink)]`;

// ─── Mobile card action buttons (touch-friendly, medium size) ─────────────────

export const PILL_CARD_PRIMARY =
  `${BASE} h-9 bg-[var(--gr-ink)] px-4 text-xs font-medium text-[var(--gr-bg)] hover:opacity-85`;

export const PILL_CARD_SECONDARY =
  `${BASE} h-9 border border-[var(--gr-border)] px-4 text-xs font-medium text-[var(--gr-text-mid)] hover:border-[var(--gr-text-mute)] hover:text-[var(--gr-ink)]`;

// ─── Standard form CTAs ───────────────────────────────────────────────────────

export const PILL_PRIMARY =
  `${BASE} bg-[var(--gr-ink)] px-5 py-2.5 text-sm font-medium text-[var(--gr-bg)] hover:opacity-85`;

export const PILL_SECONDARY =
  `${BASE} border border-[var(--gr-border)] px-5 py-2.5 text-sm font-medium text-[var(--gr-text-mid)] hover:border-[var(--gr-text-mute)] hover:text-[var(--gr-ink)]`;

// ─── Dialog buttons ───────────────────────────────────────────────────────────

export const PILL_DIALOG_PRIMARY =
  `${BASE} h-10 bg-[var(--gr-ink)] px-6 text-sm font-medium text-white hover:opacity-85`;

export const PILL_DIALOG_SECONDARY =
  `${BASE} h-10 border border-[var(--gr-border)] bg-white px-6 text-sm font-medium text-[var(--gr-text-mid)] hover:bg-[var(--gr-bg-elev)]`;
