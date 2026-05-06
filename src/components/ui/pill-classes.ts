/**
 * Shared Tailwind class strings for pill/oval action buttons.
 *
 * All tiers include `inline-flex items-center justify-center whitespace-nowrap`
 * so text stays vertically centered in both <button> and <a>/<Link> elements.
 *
 * Tiers:
 *   PILL_ROW_*    — compact inline table/card row actions (text-[11px], px-2.5 py-1)
 *   PILL_*        — standard form CTAs (text-sm, px-5 py-2.5)
 *   PILL_DIALOG_* — dialog confirm/cancel buttons (h-10 px-6)
 */

const BASE = "inline-flex items-center justify-center whitespace-nowrap rounded-full transition";

// ─── Compact row actions ──────────────────────────────────────────────────────

export const PILL_ROW_PRIMARY =
  `${BASE} bg-stone-950 px-2.5 py-1 text-[11px] font-medium text-stone-50 hover:bg-stone-800`;

export const PILL_ROW_SECONDARY =
  `${BASE} border border-stone-200 px-2.5 py-1 text-[11px] font-medium text-stone-700 hover:border-stone-400 hover:text-stone-950`;

// ─── Standard form CTAs ───────────────────────────────────────────────────────

export const PILL_PRIMARY =
  `${BASE} bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 hover:bg-stone-800`;

export const PILL_SECONDARY =
  `${BASE} border border-stone-200 px-5 py-2.5 text-sm font-medium text-stone-700 hover:border-stone-400 hover:text-stone-950`;

// ─── Dialog buttons ───────────────────────────────────────────────────────────

export const PILL_DIALOG_PRIMARY =
  `${BASE} h-10 bg-stone-950 px-6 text-sm font-medium text-white hover:bg-stone-800`;

export const PILL_DIALOG_SECONDARY =
  `${BASE} h-10 border border-stone-200 bg-white px-6 text-sm font-medium text-stone-700 hover:bg-stone-50`;
