"use client";

import { useRef, useState } from "react";
import Link from "next/link";

import { RemoveAccountButton } from "./remove-account-button";
import { EditAccountNameForm } from "./edit-account-name-button";
import { deriveAccountDisplayLabel, deriveAccountPrimaryLabel } from "@/lib/account-display";
import type { BrokerAccountRow } from "./broker-connections-section";

// Subtle, left-aligned rows used for the secondary actions inside the
// "More" menu (a link for View trades, a button for Edit account name).
const MENU_ITEM =
  "flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-stone-700 transition hover:bg-stone-50";

const ACCOUNT_TYPE_DISPLAY: Record<string, string> = {
  evaluation: "Evaluation",
  funded: "Funded",
  personal: "Personal",
  demo: "Demo",
};

/**
 * Short "firm · type" descriptor under an account's friendly name, e.g.
 * "MyFundedFutures · Evaluation". Returns null when neither is known.
 */
function accountTypeDescriptor(acct: {
  propFirm: string | null;
  accountType: string | null;
}): string | null {
  const parts: string[] = [];
  const firm = acct.propFirm?.trim();
  if (firm) parts.push(firm);
  if (acct.accountType) parts.push(ACCOUNT_TYPE_DISPLAY[acct.accountType] ?? acct.accountType);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * One row inside a connection's expanded "Show accounts" list. Shows the best
 * user-facing name (custom displayName or exact broker label), firm/type
 * descriptor, and an Active status pill.
 *
 * Actions are intentionally NOT a row of equal pill buttons. "Manage rules" is
 * the single prominent primary (filled) action; the rest (Edit account name,
 * View trades, and the destructive Remove from Guardrail) live in a compact,
 * subtle "More ▾" text menu so the row reads cleanly and the destructive action
 * is de-emphasised but still reachable.
 *
 * This is a client component so the rename editor can open as a clean inline
 * form BELOW the row (full card width) instead of cramped inside the narrow
 * "More" popover, where the input previously overflowed the menu/card bounds.
 * Behaviour is unchanged: Remove still uses the guarded archive flow via
 * RemoveAccountButton; rename still PATCHes only { displayName } via
 * EditAccountNameForm — UI only.
 */
export function LinkedAccountRow({ acct }: { acct: BrokerAccountRow }) {
  const descriptor = accountTypeDescriptor(acct);
  const primaryName = deriveAccountPrimaryLabel(acct);
  // When the user hasn't set a personal name, the primary label is the raw
  // broker-provided account label (e.g. "MFFUEVRPD133936251"). Hint that it can
  // be renamed so it doesn't read as a fixed, cryptic id.
  const hasCustomName = (acct.displayName?.trim().length ?? 0) > 0;

  const [editing, setEditing] = useState(false);
  const menuRef = useRef<HTMLDetailsElement>(null);

  function openEditor() {
    // Close the native "More" menu, then reveal the inline editor below the row.
    menuRef.current?.removeAttribute("open");
    setEditing(true);
  }

  return (
    <div className="rounded-lg border border-stone-100 bg-white px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid min-w-0 gap-1 text-sm">
          <p className="truncate font-medium text-stone-800" title={primaryName}>{primaryName}</p>
          {!hasCustomName && (
            <p className="text-[11px] text-stone-400">Broker label from Tradovate · you can rename it</p>
          )}
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
            {descriptor && <span>{descriptor}</span>}
            <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-emerald-700">
              Active
            </span>
          </div>
          {acct.pendingProtectionStatus === "archived" && (
            <p className="text-xs text-amber-700">
              Removal scheduled — takes effect at the next trading session reset
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Primary action — the only filled button, the most visible thing on the row. */}
          <Link
            href={`/rules?scope=account&id=${acct.id}`}
            className="inline-flex items-center rounded-full bg-stone-900 px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-stone-700"
          >
            Manage rules
          </Link>
          {/* Secondary actions — compact, subtle text "More ▾" menu (native
              details/summary: keyboard-accessible, no extra JS framework). */}
          <details ref={menuRef} className="group/more relative">
            <summary
              className="flex cursor-pointer list-none items-center gap-1 rounded-full border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600 transition hover:border-stone-300 hover:bg-stone-50 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
              aria-label="More account actions"
              title="More account actions"
            >
              More
              <span aria-hidden="true" className="text-[9px] leading-none transition-transform group-open/more:rotate-180">▾</span>
            </summary>
            <div className="absolute right-0 z-10 mt-1 w-44 rounded-lg border border-stone-200 bg-white p-1 shadow-lg">
              <button type="button" onClick={openEditor} className={MENU_ITEM}>
                Edit account name
              </button>
              <Link href={`/trades?accountId=${acct.id}`} className={MENU_ITEM}>
                View trades
              </Link>
              {/* Destructive action — visually separated and styled red inside the menu. */}
              <div className="my-1 border-t border-stone-100" />
              <RemoveAccountButton accountId={acct.id} redirectTo="/settings" variant="menuItem" />
            </div>
          </details>
        </div>
      </div>

      {/* Inline rename editor — opens BELOW the row, full width within the card,
          so the input and its Cancel / Save controls never overflow the compact
          "More" popover or float outside the card border. */}
      {editing && (
        <div className="mt-2.5 border-t border-stone-100 pt-2.5">
          <EditAccountNameForm
            accountId={acct.id}
            currentName={acct.displayName}
            placeholder={deriveAccountDisplayLabel(acct)}
            onClose={() => setEditing(false)}
          />
        </div>
      )}
    </div>
  );
}
